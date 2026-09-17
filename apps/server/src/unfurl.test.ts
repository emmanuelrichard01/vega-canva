import { describe, it, expect } from 'vitest';
import { guardedLookup, isBlockedHostname, isPublicAddress, parseV6 } from './netGuard';
import { checkFetchableUrl, FetchRefused, type SafeFetchResult } from './safeFetch';
import { decodeEntities, parseHtmlMeta, sniffCharset, sniffImage, textFromEmbedHtml } from './unfurlParse';
import { createUnfurler, UnfurlError } from './unfurl';

describe('isPublicAddress', () => {
  it('refuses every private, loopback and link-local IPv4 range', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '224.0.0.1', '255.255.255.255', '198.18.0.1']) {
      expect(isPublicAddress(ip)).toBe(false);
    }
  });

  it('allows public IPv4, including the edges of private ranges', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.255.255', '172.32.0.1', '11.0.0.1', '192.169.0.1']) {
      expect(isPublicAddress(ip)).toBe(true);
    }
  });

  it('refuses IPv6 loopback, unspecified, unique-local, link-local and multicast', () => {
    for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fe80::1%eth0', 'ff02::1', '2001:db8::1', '[::1]']) {
      expect(isPublicAddress(ip)).toBe(false);
    }
  });

  it('sees through every way of hiding an IPv4 address in IPv6', () => {
    expect(isPublicAddress('::ffff:127.0.0.1')).toBe(false);
    expect(isPublicAddress('::ffff:7f00:1')).toBe(false);
    expect(isPublicAddress('::ffff:169.254.169.254')).toBe(false);
    expect(isPublicAddress('::127.0.0.1')).toBe(false);
    expect(isPublicAddress('64:ff9b::10.0.0.1')).toBe(false);
    expect(isPublicAddress('2002:c0a8:0101::1')).toBe(false); // 6to4 of 192.168.1.1
    expect(isPublicAddress('::ffff:8.8.8.8')).toBe(true);
  });

  it('allows public IPv6', () => {
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
    expect(isPublicAddress('2a00:1450:4001:80b::200e')).toBe(true);
  });

  it('refuses things that are not addresses', () => {
    expect(isPublicAddress('example.com')).toBe(false);
    expect(isPublicAddress('999.1.1.1')).toBe(false);
  });

  it('parses IPv6 notation exactly', () => {
    expect(parseV6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseV6('1:2:3:4:5:6:7:8')?.[15]).toBe(8);
    expect(parseV6('1::2::3')).toBeNull();
    expect(parseV6('1:2:3:4:5:6:7:8:9')).toBeNull();
  });
});

describe('checkFetchableUrl', () => {
  const refused = (url: string) => {
    try {
      checkFetchableUrl(url);
      return false;
    } catch (err) {
      return err instanceof FetchRefused;
    }
  };

  it('refuses other schemes, credentials, odd ports and private hosts', () => {
    for (const url of [
      'file:///etc/passwd',
      'ftp://example.com/',
      'gopher://example.com/',
      'https://user:pass@example.com/',
      'http://example.com:6379/',
      'http://127.0.0.1/',
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://169.254.169.254/latest/meta-data/',
      'http://localhost/',
      'http://printer.local/',
      'http://metadata.google.internal/',
      'http://intranet/',
      'not a url',
    ]) {
      expect(refused(url)).toBe(true);
    }
  });

  it('accepts ordinary pages', () => {
    expect(refused('https://example.com/a?b=c')).toBe(false);
    expect(refused('http://example.com:80/')).toBe(false);
    expect(refused('https://8.8.8.8/')).toBe(false);
  });

  it('knows which names are never public', () => {
    expect(isBlockedHostname('LOCALHOST.')).toBe(true);
    expect(isBlockedHostname('api.localhost')).toBe(true);
    expect(isBlockedHostname('github.com')).toBe(false);
  });
});

describe('guardedLookup', () => {
  const run = (addresses: Array<{ address: string; family: number }>, all: boolean) =>
    new Promise<{ err: unknown; value: unknown }>((resolve) => {
      const lookup = guardedLookup((_h, _o, cb) => cb(null, addresses));
      lookup('example.com', { all }, (err, value) => resolve({ err, value }));
    });

  it('passes public answers through in both callback shapes', async () => {
    const one = await run([{ address: '93.184.216.34', family: 4 }], false);
    expect(one.err).toBeNull();
    expect(one.value).toBe('93.184.216.34');
    const all = await run([{ address: '93.184.216.34', family: 4 }], true);
    expect(all.value).toEqual([{ address: '93.184.216.34', family: 4 }]);
  });

  it('refuses the whole answer when any address is private', async () => {
    const mixed = await run([{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }], true);
    expect((mixed.err as Error).name).toBe('BlockedAddressError');
  });
});

describe('parseHtmlMeta', () => {
  const page = `<!doctype html><html><head>
    <meta charset="utf-8">
    <title>Plain &amp; simple</title>
    <meta name="description" content="The fallback description">
    <meta property="og:title" content="Ship it &#8212; faster">
    <meta property='og:image' content='/cover.png'>
    <meta property="og:image:width" content="1200">
    <meta property="og:site_name" content="Acme">
    <meta name="theme-color" content="#0a84ff">
    <meta name="theme-color" content="javascript:alert(1)">
    <link rel="icon" href="/favicon-32.png" sizes="32x32">
    <link rel="apple-touch-icon" href="https://cdn.acme.test/touch.png" sizes="180x180">
    <link rel="icon" href="/logo.svg" type="image/svg+xml">
    <script>var meta = '<meta property="og:title" content="nope">';</script>
  </head><body><meta property="og:description" content="in the body"></body></html>`;

  it('prefers Open Graph per field and falls back per field', () => {
    const meta = parseHtmlMeta(page, 'https://acme.test/blog/post');
    expect(meta.title).toBe('Ship it — faster');
    expect(meta.description).toBe('The fallback description');
    expect(meta.siteName).toBe('Acme');
    expect(meta.imageWidth).toBe(1200);
    expect(meta.themeColor).toBe('#0a84ff');
  });

  it('resolves relative URLs against the page and drops SVG icons', () => {
    const meta = parseHtmlMeta(page, 'https://acme.test/blog/post');
    expect(meta.image).toBe('https://acme.test/cover.png');
    expect(meta.icons.map((i) => i.href)).toEqual(['https://cdn.acme.test/touch.png', 'https://acme.test/favicon-32.png']);
  });

  it('respects <base href>, and refuses javascript: images', () => {
    const meta = parseHtmlMeta('<head><base href="https://static.test/x/"><meta property="og:image" content="a.jpg"><meta name="twitter:image" content="javascript:alert(1)"></head>', 'https://site.test/');
    expect(meta.image).toBe('https://static.test/x/a.jpg');
    const bad = parseHtmlMeta('<head><meta property="og:image" content="javascript:alert(1)"></head>', 'https://site.test/');
    expect(bad.image).toBeUndefined();
  });

  it('uses <title> when there is no og:title, and caps long text', () => {
    const meta = parseHtmlMeta(`<head><title>  A   title\n here </title><meta name="description" content="${'word '.repeat(200)}"></head>`, 'https://x.test/');
    expect(meta.title).toBe('A title here');
    expect(meta.description!.length).toBeLessThanOrEqual(320);
    expect(meta.description!.endsWith('…')).toBe(true);
  });

  it('decodes entities', () => {
    expect(decodeEntities('&lt;b&gt; &#x27;q&#39; &hellip; &bogus;')).toBe(`<b> 'q' … &bogus;`);
  });

  it('reads the charset from the header or the page', () => {
    expect(sniffCharset('text/html; charset=ISO-8859-1', Buffer.from(''))).toBe('iso-8859-1');
    expect(sniffCharset('text/html', Buffer.from('<meta charset="windows-1252">'))).toBe('windows-1252');
    expect(sniffCharset('text/html', Buffer.from('<p>'))).toBe('utf-8');
  });

  it("pulls a post's words out of oEmbed html", () => {
    expect(textFromEmbedHtml('<blockquote><p lang="en">Hello<br>world &amp; you</p>&mdash; Someone</blockquote>')).toBe('Hello world & you');
  });
});

describe('sniffImage', () => {
  it('reads PNG and GIF sizes from their headers', () => {
    const png = Buffer.alloc(32);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
    png.writeUInt32BE(1200, 16);
    png.writeUInt32BE(630, 20);
    expect(sniffImage(png)).toEqual({ mime: 'image/png', ext: '.png', width: 1200, height: 630 });

    const gif = Buffer.from('GIF89a\x10\x00\x20\x00', 'latin1');
    expect(sniffImage(gif)).toMatchObject({ ext: '.gif', width: 16, height: 32 });
  });

  it('finds a JPEG frame size past its other segments', () => {
    const jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, // APP0, length 4
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x76, 0x04, 0xb0, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(sniffImage(jpeg)).toMatchObject({ ext: '.jpg', width: 1200, height: 630 });
  });

  it('refuses markup that claims to be a picture', () => {
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(sniffImage(Buffer.from('<!doctype html><html>'))).toBeNull();
  });
});

describe('createUnfurler', () => {
  const png = (w: number, h: number) => {
    const b = Buffer.alloc(32);
    Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(b);
    b.writeUInt32BE(w, 16);
    b.writeUInt32BE(h, 20);
    return b;
  };
  const ok = (url: string, body: Buffer | string, contentType = 'text/html; charset=utf-8', status = 200): SafeFetchResult => ({
    url,
    status,
    contentType,
    body: typeof body === 'string' ? Buffer.from(body) : body,
    truncated: false,
  });

  it('builds a preview, keeps the picture and the best icon, and caches it', async () => {
    const fetched: string[] = [];
    const stored: string[] = [];
    const unfurler = createUnfurler({
      fetch: async (url) => {
        fetched.push(url);
        if (url === 'https://acme.test/post') {
          return ok(url, '<head><title>Post</title><meta property="og:image" content="/big.png"><link rel="icon" href="/fav.png"></head>');
        }
        if (url === 'https://acme.test/big.png') return ok(url, png(1200, 630), 'image/png');
        if (url === 'https://acme.test/fav.png') return ok(url, png(32, 32), 'image/png');
        return ok(url, 'not found', 'text/plain', 404);
      },
      store: async (_room, _bytes, image) => {
        stored.push(image.ext);
        return `https://api.test/media/${stored.length}${image.ext}`;
      },
    });

    const preview = await unfurler.unfurl('room-1', 'https://acme.test/post');
    expect(preview).toMatchObject({ title: 'Post', image: 'https://api.test/media/1.png', imageWidth: 1200, favicon: 'https://api.test/media/2.png' });
    expect(stored).toEqual(['.png', '.png']);

    const before = fetched.length;
    await unfurler.unfurl('room-1', 'https://acme.test/post');
    expect(fetched.length).toBe(before);
  });

  it('turns away a tracking pixel as a preview picture', async () => {
    const unfurler = createUnfurler({
      fetch: async (url) =>
        url.endsWith('/px.png') ? ok(url, png(1, 1), 'image/png') : url.endsWith('/p') ? ok(url, '<head><title>T</title><meta property="og:image" content="/px.png"></head>') : ok(url, '', 'text/plain', 404),
      store: async () => 'https://api.test/m.png',
    });
    const preview = await unfurler.unfurl('r', 'https://acme.test/p');
    expect(preview.image).toBeUndefined();
  });

  it('says a missing page is missing, and gives a robot-shy page a plain card', async () => {
    const missing = createUnfurler({ fetch: async (url) => ok(url, 'nope', 'text/html', 404), store: async () => null });
    let error: unknown;
    try {
      await missing.unfurl('r', 'https://acme.test/gone');
    } catch (err) {
      error = err;
    }
    expect(error instanceof UnfurlError).toBe(true);
    expect((error as Error).message).toBe('That page does not exist');

    const shy = createUnfurler({ fetch: async (url) => ok(url, 'denied', 'text/html', 403), store: async () => null });
    expect((await shy.unfurl('r', 'https://www.acme.test/x')).title).toBe('acme.test');
  });

  it('uses oEmbed for providers whose pages are poor sources', async () => {
    const fetched: string[] = [];
    const unfurler = createUnfurler({
      fetch: async (url) => {
        fetched.push(url);
        if (url.startsWith('https://www.youtube.com/oembed')) {
          return ok(url, JSON.stringify({ title: 'A talk', author_name: 'Channel', provider_name: 'YouTube', thumbnail_url: 'https://i.ytimg.com/vi/abc123xyz/hqdefault.jpg' }), 'application/json');
        }
        return ok(url, '', 'text/plain', 404);
      },
      store: async () => null,
    });
    const preview = await unfurler.unfurl('r', 'https://www.youtube.com/watch?v=abc123xyz');
    expect(preview).toMatchObject({ title: 'A talk', author: 'Channel', siteName: 'YouTube' });
    expect(fetched.includes('https://www.youtube.com/watch?v=abc123xyz')).toBe(false);
    expect(fetched.includes('https://i.ytimg.com/vi/abc123xyz/maxresdefault.jpg')).toBe(true);
  });

  it('shares one fetch between simultaneous requests', async () => {
    let calls = 0;
    const unfurler = createUnfurler({
      fetch: async (url) => {
        if (url === 'https://acme.test/') calls++;
        return ok(url, '<head><title>Home</title></head>');
      },
      store: async () => null,
    });
    await Promise.all([unfurler.unfurl('r', 'https://acme.test/'), unfurler.unfurl('r', 'https://acme.test/')]);
    expect(calls).toBe(1);
  });
});

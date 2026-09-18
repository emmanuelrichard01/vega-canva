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

  it('offers every picture the page declares, best first and without repeats', () => {
    const meta = parseHtmlMeta(
      `<head>
        <meta property="og:image" content="https://cdn.test/og.png">
        <meta name="twitter:image" content="https://cdn.test/tw.png">
        <meta name="twitter:image:src" content="https://cdn.test/og.png">
        <link rel="image_src" href="/legacy.png">
        <meta name="msapplication-TileImage" content="/tile.png">
      </head>`,
      'https://site.test/a'
    );
    expect(meta.images).toEqual([
      'https://cdn.test/og.png',
      'https://cdn.test/tw.png',
      'https://site.test/legacy.png',
      'https://site.test/tile.png',
    ]);
    expect(meta.image).toBe(meta.images[0]);
  });

  it('reads structured data when the page has no Open Graph, and never over it', () => {
    const ld = `<script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebSite', publisher: { name: 'Acme Press' } },
        {
          '@type': 'NewsArticle',
          headline: 'A headline from structured data',
          description: 'The summary the page only told a search engine.',
          image: ['https://cdn.test/ld.jpg'],
          author: { '@type': 'Person', name: 'Ada Lovelace' },
        },
      ],
    })}</script>`;
    const bare = parseHtmlMeta(`<head><title>Tab title</title></head><body>${ld}</body>`, 'https://site.test/a');
    expect(bare.description).toBe('The summary the page only told a search engine.');
    expect(bare.author).toBe('Ada Lovelace');
    expect(bare.siteName).toBe('Acme Press');
    expect(bare.images).toContain('https://cdn.test/ld.jpg');
    // `<title>` is still the page's own statement of its name, so it wins.
    expect(bare.title).toBe('Tab title');

    const stated = parseHtmlMeta(`<head><meta property="og:description" content="What the page says for sharing"></head>${ld}`, 'https://site.test/a');
    expect(stated.description).toBe('What the page says for sharing');
  });

  it('skips a malformed ld+json block rather than the ones after it', () => {
    const meta = parseHtmlMeta(
      `<head></head><body>
        <script type="application/ld+json">{ "broken": , }</script>
        <script type="application/ld+json">{"@type":"Article","name":"The good one"}</script>
      </body>`,
      'https://site.test/a'
    );
    expect(meta.title).toBe('The good one');
  });

  it('finds the tags when they sit outside a head that closed too early', () => {
    const meta = parseHtmlMeta(
      '<html><head><title>Shell</title></head><body><div><meta property="og:title" content="Injected later"></div></body></html>',
      'https://site.test/a'
    );
    expect(meta.title).toBe('Injected later');
  });

  it('notes the page’s own oEmbed endpoint', () => {
    const meta = parseHtmlMeta('<head><link rel="alternate" type="application/json+oembed" href="/wp-json/oembed/1.0/embed?url=x"></head>', 'https://site.test/a');
    expect(meta.oembed).toBe('https://site.test/wp-json/oembed/1.0/embed?url=x');
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

    const { preview } = await unfurler.unfurl('room-1', 'https://acme.test/post');
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
    const { preview } = await unfurler.unfurl('r', 'https://acme.test/p');
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
    expect((await shy.unfurl('r', 'https://www.acme.test/x')).preview.title).toBe('acme.test');
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
    const { preview } = await unfurler.unfurl('r', 'https://www.youtube.com/watch?v=abc123xyz');
    expect(preview).toMatchObject({ title: 'A talk', author: 'Channel', siteName: 'YouTube' });
    expect(fetched.includes('https://www.youtube.com/watch?v=abc123xyz')).toBe(false);
    expect(fetched.includes('https://i.ytimg.com/vi/abc123xyz/maxresdefault.jpg')).toBe(true);
  });

  it('answers with the words while a slow picture is still coming, then with the picture', async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const unfurler = createUnfurler({
      graceMs: 10,
      fetch: async (url) => {
        if (url.endsWith('/slow.png')) {
          await held;
          return ok(url, png(1200, 630), 'image/png');
        }
        if (url.endsWith('/article')) {
          return ok(url, '<head><title>An article</title><meta property="og:description" content="Worth reading"><meta property="og:image" content="/slow.png"></head>');
        }
        return ok(url, '', 'text/plain', 404);
      },
      store: async () => 'https://api.test/stored.png',
    });

    const first = await unfurler.unfurl('r', 'https://acme.test/article');
    expect(first.pending).toBe(true);
    expect(first.preview).toMatchObject({ title: 'An article', description: 'Worth reading' });
    expect(first.preview.image).toBeUndefined();

    release();
    const second = await unfurler.unfurl('r', 'https://acme.test/article');
    expect(second.pending).toBe(false);
    expect(second.preview.image).toBe('https://api.test/stored.png');
  });

  it('falls back to the next picture when the first one will not load', async () => {
    const unfurler = createUnfurler({
      fetch: async (url) => {
        if (url.endsWith('/a')) {
          return ok(url, '<head><meta property="og:image" content="/gone.png"><meta name="twitter:image" content="/spare.png"><title>T</title></head>');
        }
        if (url.endsWith('/spare.png')) return ok(url, png(800, 600), 'image/png');
        return ok(url, 'no', 'text/plain', 403);
      },
      store: async () => 'https://api.test/spare.png',
    });
    const { preview } = await unfurler.unfurl('r', 'https://acme.test/a');
    expect(preview.image).toBe('https://api.test/spare.png');
  });

  it('asks for the icons the page named, and guesses only when they fail', async () => {
    const asked: string[] = [];
    const unfurler = createUnfurler({
      fetch: async (url) => {
        asked.push(url);
        if (url.endsWith('/a')) return ok(url, '<head><title>T</title><link rel="icon" href="/named.png"></link></head>');
        if (url.endsWith('/named.png')) return ok(url, png(64, 64), 'image/png');
        return ok(url, '', 'text/plain', 404);
      },
      store: async () => 'https://api.test/icon.png',
    });
    const { preview } = await unfurler.unfurl('r', 'https://acme.test/a');
    expect(preview.favicon).toBe('https://api.test/icon.png');
    expect(asked.some((u) => u.endsWith('/favicon.ico'))).toBe(false);
  });

  it('reads a page once for every room that links it', async () => {
    let pages = 0;
    const unfurler = createUnfurler({
      fetch: async (url) => {
        if (url.endsWith('/shared')) {
          pages++;
          return ok(url, '<head><title>Shared</title></head>');
        }
        return ok(url, '', 'text/plain', 404);
      },
      store: async () => null,
    });
    await unfurler.unfurl('room-a', 'https://acme.test/shared');
    await unfurler.unfurl('room-b', 'https://acme.test/shared');
    expect(pages).toBe(1);
  });

  it('remembers a refusal briefly rather than chasing it again', async () => {
    let attempts = 0;
    const unfurler = createUnfurler({
      fetch: async (url) => {
        attempts++;
        return ok(url, 'gone', 'text/html', 404);
      },
      store: async () => null,
    });
    await expect(unfurler.unfurl('r', 'https://acme.test/gone')).rejects.toBeInstanceOf(UnfurlError);
    await expect(unfurler.unfurl('r', 'https://acme.test/gone')).rejects.toBeInstanceOf(UnfurlError);
    expect(attempts).toBe(1);
  });

  it('asks again as a browser when a page turns the bot away, and uses what it gets', async () => {
    const agents: string[] = [];
    const unfurler = createUnfurler({
      fetch: async (url, options) => {
        agents.push(options?.userAgent ?? 'default');
        // A bot-managed edge: anything that is not a browser gets a 403.
        if (!options?.userAgent?.includes('Chrome')) return ok(url, 'blocked', 'text/html', 403);
        return ok(url, '<head><title>The real page</title><meta property="og:description" content="Words"></head>');
      },
      store: async () => null,
    });

    const { preview } = await unfurler.unfurl('r', 'https://walled.test/article');
    expect(preview.title).toBe('The real page');
    expect(preview.description).toBe('Words');
    // The honest string is always tried first; the browser one is the retry.
    expect(agents[0]).toBe('default');
    expect(agents[1]).toContain('Chrome');
  });

  it('keeps the plain card when a page refuses the browser too', async () => {
    const unfurler = createUnfurler({
      fetch: async (url) => ok(url, 'blocked', 'text/html', 403),
      store: async () => null,
    });
    const { preview } = await unfurler.unfurl('r', 'https://walled.test/article');
    expect(preview.title).toBe('walled.test');
  });

  it('does not retry an honest 404', async () => {
    let calls = 0;
    const unfurler = createUnfurler({
      fetch: async (url) => {
        calls++;
        return ok(url, 'gone', 'text/html', 404);
      },
      store: async () => null,
    });
    await expect(unfurler.unfurl('r', 'https://acme.test/gone')).rejects.toBeInstanceOf(UnfurlError);
    expect(calls).toBe(1);
  });

  it('sends the page as the referer when fetching its picture', async () => {
    let imageReferer: string | undefined;
    const unfurler = createUnfurler({
      fetch: async (url, options) => {
        if (url.endsWith('/a')) {
          return ok(url, '<head><title>T</title><meta property="og:image" content="/shot.png"></head>');
        }
        if (url.endsWith('/shot.png')) {
          imageReferer = options?.referer;
          return ok(url, png(1200, 630), 'image/png');
        }
        return ok(url, '', 'text/plain', 404);
      },
      store: async () => 'https://api.test/shot.png',
    });

    await unfurler.unfurl('r', 'https://acme.test/a');
    expect(imageReferer).toBe('https://acme.test/a');
  });

  it('fetches a site icon once however many of its pages are linked', async () => {
    const iconCalls: string[] = [];
    const unfurler = createUnfurler({
      fetch: async (url) => {
        if (url.endsWith('/icon.png')) {
          iconCalls.push(url);
          return ok(url, png(64, 64), 'image/png');
        }
        if (url.endsWith('.ico') || url.endsWith('apple-touch-icon.png')) {
          return ok(url, '', 'text/plain', 404);
        }
        return ok(url, '<head><title>T</title><link rel="icon" href="/icon.png"></head>');
      },
      store: async () => 'https://api.test/icon.png',
    });

    const one = await unfurler.unfurl('r', 'https://acme.test/first');
    const two = await unfurler.unfurl('r', 'https://acme.test/second');
    expect(one.preview.favicon).toBe('https://api.test/icon.png');
    expect(two.preview.favicon).toBe('https://api.test/icon.png');
    expect(iconCalls).toHaveLength(1);
  });

  it('peeks at a finished preview without fetching, so a repeat costs no budget', async () => {
    let calls = 0;
    const unfurler = createUnfurler({
      fetch: async (url) => {
        calls++;
        if (url.endsWith('/a')) return ok(url, '<head><title>Known</title></head>');
        return ok(url, '', 'text/plain', 404);
      },
      store: async () => null,
    });

    // Nothing known yet: a peek must not fetch, and must not invent an answer.
    expect(unfurler.peek('r', 'https://acme.test/a')).toBeNull();
    expect(calls).toBe(0);

    const { pending } = await unfurler.unfurl('r', 'https://acme.test/a');
    expect(pending).toBe(false);
    const spent = calls;

    const known = unfurler.peek('r', 'https://acme.test/a');
    expect(known?.title).toBe('Known');
    // The whole point: the repeat did no work at all.
    expect(calls).toBe(spent);
  });

  it('keeps one room\'s preview out of another\'s peek', async () => {
    // The stored pictures are room media, so the cache is per room and the
    // peek has to be too — otherwise a room could serve a neighbour's card.
    const unfurler = createUnfurler({
      fetch: async (url) => ok(url, '<head><title>Shared</title></head>'),
      store: async () => null,
    });
    await unfurler.unfurl('room-a', 'https://acme.test/x');
    expect(unfurler.peek('room-a', 'https://acme.test/x')).not.toBeNull();
    expect(unfurler.peek('room-b', 'https://acme.test/x')).toBeNull();
  });

  it('does not peek at a preview whose picture is still coming', async () => {
    /**
     * A pending preview is not in the finished cache, so the collecting
     * request is a miss and is charged — which is right, because that request
     * is the one still doing the work. Serving it from a peek would hand back
     * the picture-less card for the rest of the TTL.
     */
    let release: (() => void) | null = null;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const unfurler = createUnfurler({
      graceMs: 0,
      fetch: async (url) => {
        if (url.endsWith('/shot.png')) {
          await held;
          return ok(url, png(1200, 630), 'image/png');
        }
        return ok(url, '<head><title>T</title><meta property="og:image" content="/shot.png"></head>');
      },
      store: async () => 'https://api.test/shot.png',
    });

    const first = await unfurler.unfurl('r', 'https://acme.test/a');
    expect(first.pending).toBe(true);
    expect(unfurler.peek('r', 'https://acme.test/a')).toBeNull();

    release!();
    /*
     * Waited for rather than assumed. With no grace the call above returns
     * without waiting on the picture, so the finished card reaches the cache a
     * few microtasks later — asserting straight after the release reads the
     * cache before `dress` has written to it, which is a racing test rather
     * than a real failure.
     */
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(unfurler.peek('r', 'https://acme.test/a')?.image).toBe('https://api.test/shot.png');
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

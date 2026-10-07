/**
 * Reading a page's preview out of its HTML, and a picture's size out of its bytes.
 *
 * Pure, so the tests can hold real markup. No DOM and no HTML library: a
 * preview needs a handful of `<meta>` and `<link>` tags and a `<title>`, all in
 * the head, and a tolerant scan over the first few hundred kilobytes finds them
 * in the pages people actually paste — including the ones whose markup a
 * strict parser would give up on.
 */

export interface PageMeta {
  title?: string;
  description?: string;
  siteName?: string;
  /** The best picture candidate — the first of `images`, kept for readability at call sites. */
  image?: string;
  /**
   * Every picture the page offers, best first.
   *
   * A single `image` was the reason so many cards arrived without one. A page's
   * `og:image` is frequently the one URL that fails: a CDN that refuses
   * hotlinking, a signed URL that has expired, a path that 404s on the variant
   * the crawler asks for. When that happened the card gave up, even though the
   * same page also declared a `twitter:image`, a `link rel="image_src"` and a
   * JSON-LD `image` that all worked. They are all here now, in the order a
   * chat app would trust them, and the first one that actually arrives wins.
   */
  images: string[];
  imageWidth?: number;
  imageHeight?: number;
  imageAlt?: string;
  icons: Array<{ href: string; size: number; rel: string }>;
  themeColor?: string;
  author?: string;
  type?: string;
  canonical?: string;
  /**
   * The page's own oEmbed endpoint, from `<link rel="alternate"
   * type="application/json+oembed">`.
   *
   * This is the documented way a site says "ask me directly rather than
   * scraping me", and it is how WordPress, SoundCloud, Flickr, Figma, Reddit
   * and most CMS-backed sites would prefer to be previewed. Following it is
   * both more accurate and cheaper than parsing whatever the page rendered.
   */
  oembed?: string;
}

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©', reg: '®', trade: '™', middot: '·',
  bull: '•', laquo: '«', raquo: '»', eacute: 'é', egrave: 'è', aacute: 'á', agrave: 'à', ouml: 'ö',
  uuml: 'ü', auml: 'ä', szlig: 'ß', ccedil: 'ç', ntilde: 'ñ', times: '×', euro: '€', pound: '£',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}

/**
 * C0 and C1 controls and DEL.
 *
 * By number rather than as a regex character class: a class spelled with the
 * raw characters puts control bytes in the source file, which git then
 * treats as binary.
 */
export function isControl(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}

/** Collapse whitespace, strip stray tags, and cap the length a card can use. */
export function cleanText(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  const decoded = decodeEntities(value.replace(/<[^>]*>/g, ' '));
  // Control characters out, by code point (see `isControl`).
  const text = Array.from(decoded, (ch) => (isControl(ch.codePointAt(0)!) ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** The attributes of one tag, lower-cased names, values decoded. */
export function readAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  // Skip the tag name itself.
  const inner = tag.replace(/^<\s*[a-z0-9]+/i, '').replace(/\/?>$/, '');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(inner))) {
    const name = match[1].toLowerCase();
    if (name in attrs) continue;
    attrs[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
}

function resolve(href: string | undefined, base: string): string | undefined {
  if (!href) return undefined;
  try {
    const url = new URL(href.trim(), base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

const positive = (v: string | undefined) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
};

const HEX_OR_RGB = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i;

/** What a page says about itself in `application/ld+json`, reduced to a card's fields. */
export interface JsonLdMeta {
  title?: string;
  description?: string;
  image?: string;
  author?: string;
  siteName?: string;
}

/** The plain string inside a JSON-LD value, which may be a string, a node, or a list of either. */
function ldText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = ldText(item);
      if (found) return found;
    }
    return undefined;
  }
  if (value && typeof value === 'object') {
    const node = value as Record<string, unknown>;
    // `{ "@value": … }` for language-tagged text, `{ "name": … }` for a Person
    // or Organization used where a string was expected, `{ "url": … }` for an
    // ImageObject. All three are common and all three mean "the string here".
    return ldText(node['@value'] ?? node.name ?? node.url ?? node.contentUrl);
  }
  return undefined;
}

/**
 * The card a page describes in structured data.
 *
 * ## Why this is worth reading at all
 *
 * Open Graph is a convention; JSON-LD is what a page emits because Google asks
 * for it. So there is a large class of pages — recipes, news behind a CMS,
 * product pages, documentation built by a static generator — that carry a
 * perfectly good headline, summary and picture in `ld+json` and *nothing* in
 * `og:*`. Those were the links that arrived as a bare domain with no
 * description, which is the complaint this exists to answer.
 *
 * It is a fallback, never an override: a page that took the trouble to write
 * an `og:description` meant that one for exactly this purpose.
 *
 * ## Tolerant on purpose
 *
 * Real `ld+json` blocks are frequently invalid — a trailing comma, an unescaped
 * newline inside a string, HTML comment wrappers left over from a template. A
 * block that will not parse is skipped and the next one is tried; there is
 * usually more than one, and the useful one is rarely the first.
 */
export function parseJsonLd(html: string): JsonLdMeta {
  const out: JsonLdMeta = {};
  const blocks = html.match(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi) ?? [];

  const visit = (node: unknown, depth: number): void => {
    if (!node || depth > 6) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    if (Array.isArray(n['@graph'])) for (const item of n['@graph']) visit(item, depth + 1);

    out.title ??= cleanText(ldText(n.headline ?? n.name ?? n.title), 200);
    out.description ??= cleanText(ldText(n.description ?? n.abstract ?? n.articleBody), 320);
    out.author ??= cleanText(ldText(n.author ?? n.creator), 80);
    out.siteName ??= cleanText(ldText((n.publisher as Record<string, unknown>)?.name ?? n.publisher), 80);
    if (!out.image) {
      const image = ldText(n.image ?? n.thumbnailUrl ?? n.logo);
      if (image && /^(https?:)?\/\//i.test(image.trim())) out.image = image.trim();
    }
  };

  for (const block of blocks) {
    const body = block.replace(/^<script\b[^>]*>/i, '').replace(/<\/script\s*>$/i, '');
    // Templates sometimes wrap the payload in a CDATA section or an HTML comment.
    const json = body.replace(/^\s*(<!--|\/\*\s*<!\[CDATA\[\s*\*\/)/, '').replace(/(-->|\/\*\s*\]\]>\s*\*\/)\s*$/, '').trim();
    if (!json) continue;
    try {
      visit(JSON.parse(json), 0);
    } catch {
      /* An invalid block is not a reason to abandon the valid one after it. */
    }
    if (out.title && out.description && out.image) break;
  }
  return out;
}

/**
 * The preview a page describes for itself.
 *
 * Open Graph first, then Twitter's cards, then plain HTML, per field — a page
 * with an `og:title` and no `og:description` still has a `<meta
 * name="description">` worth using. Everything relative is resolved against
 * the page's final URL (after redirects), which is the only base that is right.
 */
export function parseHtmlMeta(html: string, pageUrl: string): PageMeta {
  const headEnd = html.search(/<\/head\s*>|<body[\s>]/i);
  /**
   * The head — unless the interesting tags are not in it.
   *
   * Plenty of real pages close `<head>` before their framework has injected the
   * Open Graph tags, or never open one, and a scan that stopped at `</head>`
   * read a document that had a description and reported none. So the cut is
   * made, and then checked: if there is no `og:`/`twitter:` tag inside it but
   * there is one further down, the whole document is scanned instead. Bounded,
   * because `body` is where the megabyte of markup lives.
   */
  const cut = headEnd > 0 ? html.slice(0, headEnd) : '';
  const whole = html.slice(0, 400_000);
  const social = /<meta\b[^>]*\b(?:property|name)\s*=\s*["']?(?:og|twitter):/i;
  const head = cut && (social.test(cut) || !social.test(whole)) ? cut : whole;
  const withoutScripts = head.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '').replace(/<!--[\s\S]*?-->/g, '');

  const base = (() => {
    const tag = withoutScripts.match(/<base\b[^>]*>/i);
    return resolve(tag ? readAttributes(tag[0]).href : undefined, pageUrl) ?? pageUrl;
  })();

  const props = new Map<string, string>();
  for (const tag of withoutScripts.match(/<meta\b[^>]*>/gi) ?? []) {
    const a = readAttributes(tag);
    const key = (a.property ?? a.name ?? a.itemprop ?? '').toLowerCase().trim();
    if (!key || a.content === undefined) continue;
    if (!props.has(key)) props.set(key, a.content);
  }
  const first = (...keys: string[]) => {
    for (const key of keys) {
      const v = props.get(key);
      if (v && v.trim()) return v;
    }
    return undefined;
  };

  const icons: PageMeta['icons'] = [];
  let canonical: string | undefined;
  let oembed: string | undefined;
  let imageSrc: string | undefined;
  for (const tag of withoutScripts.match(/<link\b[^>]*>/gi) ?? []) {
    const a = readAttributes(tag);
    const rel = (a.rel ?? '').toLowerCase();
    const rels = rel.split(/\s+/);
    if (rels.includes('canonical')) canonical = resolve(a.href, base);
    if (rels.includes('image_src')) imageSrc ??= resolve(a.href, base);
    if (rels.includes('alternate') && /json\+oembed/i.test(a.type ?? '')) oembed ??= resolve(a.href, base);
    if (!/(^|\s)(icon|apple-touch-icon|apple-touch-icon-precomposed|shortcut)(\s|$)/.test(rel)) continue;
    const href = resolve(a.href, base);
    if (!href) continue;
    if (/\.svg(\?|#|$)/i.test(href) || (a.type ?? '').includes('svg')) continue; // never stored: SVG is a document
    const size = Math.max(0, ...(a.sizes ?? '').split(/\s+/).map((s) => positive(s.split('x')[0]) ?? 0));
    icons.push({ href, size: size || (rel.includes('apple-touch') ? 180 : 32), rel });
  }

  const titleTag = withoutScripts.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1];
  const themeColor = first('theme-color')?.trim();
  // Read from the whole document: `ld+json` is as often at the end of `body`
  // as in the head, and it is the fallback precisely for pages whose head is
  // thin. It is never allowed to overwrite what the page stated for sharing.
  const ld = parseJsonLd(whole);

  /**
   * Picture candidates, best first and without repeats.
   *
   * Order is "what did the page most deliberately say", not "what is biggest":
   * `og:image` is written for this exact purpose, Twitter's is written for a
   * card too, `image_src` is the pre-OG version of the same statement, JSON-LD
   * is aimed at a search engine, and the Windows tile is a last resort that is
   * at least guaranteed to be a real file the site serves.
   */
  const images = [
    first('og:image:secure_url', 'og:image', 'og:image:url'),
    first('twitter:image', 'twitter:image:src', 'image'),
    imageSrc,
    ld.image,
    first('msapplication-tileimage'),
  ]
    .map((href) => resolve(href, base))
    .filter((href, i, all): href is string => Boolean(href) && all.indexOf(href) === i);

  return {
    title: cleanText(first('og:title', 'twitter:title') ?? titleTag, 200) ?? ld.title,
    description: cleanText(first('og:description', 'twitter:description', 'description'), 320) ?? ld.description,
    siteName: cleanText(first('og:site_name', 'application-name', 'apple-mobile-web-app-title'), 80) ?? ld.siteName,
    image: images[0],
    images,
    imageWidth: positive(first('og:image:width')),
    imageHeight: positive(first('og:image:height')),
    imageAlt: cleanText(first('og:image:alt', 'twitter:image:alt'), 200),
    icons: icons.sort((x, y) => y.size - x.size),
    themeColor: themeColor && HEX_OR_RGB.test(themeColor) ? themeColor : undefined,
    author: cleanText(first('author', 'article:author', 'twitter:creator'), 80) ?? ld.author,
    type: cleanText(first('og:type'), 40),
    canonical,
    oembed,
  };
}

/** The charset a response declares, in its header or its first bytes. */
export function sniffCharset(contentType: string, bytes: Buffer): string {
  const header = contentType.match(/charset\s*=\s*"?([\w.:-]+)/i)?.[1];
  if (header) return header.toLowerCase();
  const start = bytes.subarray(0, 4096).toString('latin1');
  const meta =
    start.match(/<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i)?.[1] ??
    start.match(/<meta[^>]+content\s*=\s*["'][^"']*charset=([\w.:-]+)/i)?.[1];
  return (meta ?? 'utf-8').toLowerCase();
}

export function decodeHtml(contentType: string, bytes: Buffer): string {
  const charset = sniffCharset(contentType, bytes);
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

export interface SniffedImage {
  mime: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/x-icon';
  ext: '.png' | '.jpg' | '.gif' | '.webp' | '.ico';
  width?: number;
  height?: number;
}

/**
 * What a picture really is, from its bytes.
 *
 * The response's Content-Type is the site's claim, and a preview is about to be
 * stored and served from this origin, so the claim is not good enough: an
 * "image/png" that is really an HTML page or an SVG is refused here. The size
 * comes from the same bytes, so a 1×1 tracking pixel can be told from a
 * picture without decoding either.
 */
export function sniffImage(b: Buffer): SniffedImage | null {
  if (b.length >= 24 && b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') {
    return { mime: 'image/png', ext: '.png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (b.length >= 10 && b.toString('latin1', 0, 4) === 'GIF8') {
    return { mime: 'image/gif', ext: '.gif', width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { mime: 'image/jpeg', ext: '.jpg', ...jpegSize(b) };
  }
  if (b.length >= 30 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
    const chunk = b.toString('latin1', 12, 16);
    let size: { width?: number; height?: number } = {};
    if (chunk === 'VP8X') size = { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    else if (chunk === 'VP8 ' && b.length >= 30) size = { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    else if (chunk === 'VP8L' && b.length >= 25) {
      const bits = b.readUInt32LE(21);
      size = { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    return { mime: 'image/webp', ext: '.webp', ...size };
  }
  if (b.length >= 22 && b.readUInt16LE(0) === 0 && b.readUInt16LE(2) === 1 && b.readUInt16LE(4) > 0) {
    return { mime: 'image/x-icon', ext: '.ico', width: b[6] || 256, height: b[7] || 256 };
  }
  return null;
}

function jpegSize(b: Buffer): { width?: number; height?: number } {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    const length = b.readUInt16BE(i + 2);
    // SOF0–SOF15, less DHT (C4), JPG (C8) and DAC (CC), carry the frame size.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    i += 2 + length;
  }
  return {};
}

/** Pull the words out of an oEmbed `html` blob — a post's text, say. */
export function textFromEmbedHtml(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const paragraph = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1];
  return cleanText(paragraph?.replace(/<br\s*\/?>/gi, ' '), 320);
}

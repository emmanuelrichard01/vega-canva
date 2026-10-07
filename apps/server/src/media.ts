import path from 'path';

/**
 * What may be uploaded, and what it is served as.
 *
 * Its own module so the tests can hold the real table rather than a
 * copy of it. `server.test.ts` used to redeclare all three of these constants
 * at the top of the file, which tests the copy: deleting an entry from the
 * server and forgetting the test leaves a green suite asserting the old
 * behaviour of code that no longer exists.
 */

/**
 * ## Why SVG is not on this list
 *
 * An SVG is a document, not an image. It can carry `<script>`,
 * `<foreignObject>` and event handlers, and a browser that navigates directly
 * to one served as `image/svg+xml` executes all of it **on the origin that
 * served it**. Uploading a file is not supposed to be a way to run code on the
 * server's origin, and for SVG it silently was.
 *
 * Nothing is lost by it: the board's SVG import parses the file in the browser
 * and creates real nodes, and the exporter writes SVG out. Neither round-trips
 * through object storage.
 */
export const ALLOWED_MIME_TYPES = new Set([
  // Images
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  // Audio
  'audio/webm',
  'audio/mp4',
  'audio/ogg',
  'audio/wav',
  'audio/mpeg',
  'audio/aac',
  // Fonts, uploaded so a board can be set in a typeface its collaborators
  // do not have installed. The client sends the canonical type for the
  // extension, whatever the operating system guessed.
  'font/woff2',
  'font/woff',
  'font/ttf',
  'font/otf',
]);

export const ALLOWED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif',
  '.webm', '.mp4', '.ogg', '.wav', '.mp3', '.m4a', '.aac',
  '.woff2', '.woff', '.ttf', '.otf',
]);

/** Font files, which have a tighter size cap than other media. */
export const FONT_EXTENSIONS = new Set(['.woff2', '.woff', '.ttf', '.otf']);

/**
 * The largest font accepted. A full CJK face can approach this; a Latin
 * family is a few hundred kilobytes, so anything bigger is not a font
 * anybody meant to set a board in.
 */
export const MAX_FONT_BYTES = 10 * 1024 * 1024;

/** Whether a stored key holds a font. */
export function isFontKey(key: string): boolean {
  return FONT_EXTENSIONS.has(path.extname(key).toLowerCase());
}

/**
 * The Content-Type a stored object is served as, decided by **us**.
 *
 * `file.mimetype` is whatever the client's multipart body claimed. The upload
 * filter checks it, but a check is not a guarantee: a request may declare
 * `image/png`, carry an SVG, and be stored with a `.png` key. The filter's job
 * is to refuse obvious junk; it cannot vouch for the bytes.
 *
 * So the proxy never echoes the stored type back. It maps the extension --
 * which the upload path sanitised into a known set -- through this table, and
 * anything it cannot place is served as a download rather than as content.
 */
export const EXTENSION_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.webm': 'audio/webm',
  '.mp4': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  // Served as fonts so `FontFace` and `@font-face` accept them. `nosniff`
  // still applies, and a font cannot be navigated to as a document.
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  // Favicons kept by link previews. Never accepted as an upload.
  '.ico': 'image/x-icon',
};

/** Whether an upload is one we will store at all. */
export function isAllowedUpload(mimetype: string, originalName: string): boolean {
  const ext = path.extname(originalName).toLowerCase();
  return ALLOWED_MIME_TYPES.has(mimetype) && ALLOWED_EXTENSIONS.has(ext);
}

/** The extension we will store a file under, never the one it claimed. */
export function safeExtension(originalName: string): string {
  const ext = path.extname(originalName).toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext) ? ext : '.bin';
}

/**
 * The type to serve a stored key as, and whether it may be rendered at all.
 *
 * `render: false` means the browser is told to download it instead, which is
 * the safe answer for a file whose extension we cannot place.
 */
export function serveAs(key: string): { type: string; render: boolean } {
  const type = EXTENSION_TYPES[path.extname(key).toLowerCase()];
  return type ? { type, render: true } : { type: 'application/octet-stream', render: false };
}

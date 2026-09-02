/**
 * Making an exported SVG stand on its own.
 *
 * ## The problem with a reference
 *
 * Images on the canvas are stored out of band — the CRDT holds a URL and the
 * bytes live in object storage, which is the right call and is documented as
 * such in `ARCHITECTURE.md`. But an SVG that carries those URLs forward is only
 * a picture *on this machine, while that server is reachable*. Sent to a
 * colleague it renders as empty rectangles; opened next year it renders as
 * empty rectangles; and in the common development case the URL is
 * `http://localhost:3000/rooms/...`, which is not merely unreachable for the
 * recipient but points at whatever *they* happen to be running.
 *
 * Nothing about that failure is visible to the person exporting. The file is
 * produced, it opens on their machine, and the images are there.
 *
 * ## Why the whole file, not a thumbnail
 *
 * Base64 costs a third more bytes than the original. That is the price of a
 * file that is still a file when it arrives, and it is the same trade every
 * design tool makes on export. A raster export has always embedded its pixels;
 * this only brings SVG into line with what PNG already guaranteed.
 *
 * ## Why failure is not an error
 *
 * A CORS refusal, an expired link, a server that is down: none of these should
 * lose the export. The URL is kept as it was, so the file is exactly as good as
 * it used to be, and the caller is told which ones could not be inlined so the
 * dialog can say so rather than implying a self-contained file.
 */

import { isLocalSrc, resolveLocalSrc } from '../../utils/pendingMedia';

/** What `fetch` has to provide. Narrowed so a test can hand over a fake. */
export type BlobFetcher = (url: string) => Promise<Blob>;

export interface InlineResult {
  /** Original URL → `data:` URI, for the ones that could be read. */
  embedded: Map<string, string>;
  /** URLs left as references, because reading them failed. */
  failed: string[];
}

/** A URL that is already self-contained needs no fetching. */
export function isSelfContained(src: string): boolean {
  return src.startsWith('data:');
}

/**
 * Read a blob as a `data:` URI.
 *
 * `FileReader` rather than manual base64 over an ArrayBuffer: it produces the
 * mime prefix from the blob's own type, and a hand-rolled loop over a
 * multi-megabyte buffer is a main-thread stall for no gain.
 */
export function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the image.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Inline every distinct source, keeping the ones that fail as references.
 *
 * Deduplicated by URL before fetching: the same photo placed six times is one
 * request and one copy of the bytes in the file, not six. That is the
 * difference between a shareable export and one nobody can email.
 */
export async function inlineImageSources(
  sources: readonly string[],
  fetchBlob: BlobFetcher,
  toDataUri: (blob: Blob) => Promise<string> = blobToDataUri
): Promise<InlineResult> {
  const embedded = new Map<string, string>();
  const failed: string[] = [];

  const distinct = [...new Set(sources.filter((s) => s && !isSelfContained(s)))];

  await Promise.all(
    distinct.map(async (src) => {
      try {
        /**
         * A `local:` src is not an address, so it must be turned into one
         * before anybody fetches it. On the device holding the bytes this
         * makes a not-yet-uploaded picture export correctly; anywhere else
         * `resolveLocalSrc` returns null, the fetch of an unfetchable string
         * throws, and it lands in `failed` -- which is the honest answer and
         * a path this function already reports.
         */
        const address = isLocalSrc(src) ? resolveLocalSrc(src) ?? src : src;
        embedded.set(src, await toDataUri(await fetchBlob(address)));
      } catch {
        // Kept as a reference. The export is then exactly as good as it was
        // before this existed, rather than failing outright.
        failed.push(src);
      }
    })
  );

  return { embedded, failed };
}

/** The browser's `fetch`, narrowed to the shape above. */
export const fetchBlob: BlobFetcher = async (url) => {
  const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  return response.blob();
};

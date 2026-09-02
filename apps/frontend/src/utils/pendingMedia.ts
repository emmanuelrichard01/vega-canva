import { useSyncExternalStore } from 'react';

/**
 * Where a picture lives between being dropped and reaching the server.
 *
 * ## The bug this exists to close
 *
 * A dropped file was drawn from `URL.createObjectURL(file)`, and that blob URL
 * was written straight into the node's `src` -- which is to say, into the
 * shared Yjs document. A `blob:` URL is scoped to the one document that
 * created it, so this had two consequences and neither was visible to the
 * person who dropped the file:
 *
 * 1. **Every other person in the room received a URL that resolves to
 *    nothing.** The author saw a photograph; everyone else saw the grey
 *    placeholder, immediately, with no failure anywhere to explain it.
 * 2. **It survived the reload it could not survive.** The document persists to
 *    IndexedDB, so reopening the board restored a `blob:` string that had been
 *    dead since the tab closed. The bytes were still on disk in the upload
 *    queue; nothing looked for them.
 *
 * The second one is what a person actually reports: an image added offline
 * comes back as an empty dashed rectangle, which reads as *deleted* when the
 * truth is *not uploaded yet*.
 *
 * ## The rule
 *
 * **The document may only hold a URL that means the same thing to everybody
 * who reads it.** That is the same invariant the rest of this codebase keeps
 * about content: a fact in the document must not resolve per viewer. A blob
 * URL breaks it silently, because it is a syntactically perfect URL that
 * happens to be meaningless one tab over.
 *
 * So the document holds `local:<uploadId>` instead. It is deliberately **not**
 * a fetchable URL: nothing will try to load it and quietly fail, and any code
 * that has not been taught about it cannot mistake it for an address. It says
 * exactly what is true -- these bytes exist on somebody's device and not yet
 * on the server -- and it is the same statement for every reader, which is
 * what lets a collaborator draw "uploading" rather than "broken".
 *
 * This module is the side table that turns that id back into something an
 * `<img>` can load, for the one client that has the bytes. It is deliberately
 * *not* in the document, because which files are on your disk is not a fact
 * about the board -- the same reason `cropMode` and `pathEdit` ride awareness
 * instead.
 */

const LOCAL_PREFIX = 'local:';

/** The `src` a node carries while its bytes are still only on one device. */
export const localSrcFor = (uploadId: string): string => `${LOCAL_PREFIX}${uploadId}`;

export const isLocalSrc = (src: string | undefined | null): boolean =>
  typeof src === 'string' && src.startsWith(LOCAL_PREFIX);

export const uploadIdFromSrc = (src: string): string | null =>
  isLocalSrc(src) ? src.slice(LOCAL_PREFIX.length) : null;

interface LocalMedia {
  url: string;
  /**
   * The blob's own MIME type, carried because the URL cannot express it.
   *
   * A `blob:` URL is an opaque handle with no extension and no media type in
   * it, so a caller naming a download file has nothing to read. The audio
   * renderer used to slice the type out of a `data:` URI, which silently
   * produced nonsense for every other kind of src.
   */
  type: string;
}

/** uploadId → the bytes this device happens to hold. */
const objectUrls = new Map<string, LocalMedia>();

const listeners = new Set<() => void>();

/**
 * A counter, not the Map, as the snapshot.
 *
 * `useSyncExternalStore` compares snapshots with `Object.is`, so returning the
 * Map itself would compare equal after every mutation and no renderer would
 * ever hear about a newly registered blob.
 */
let version = 0;

const announce = () => {
  version += 1;
  listeners.forEach((fn) => fn());
};

/**
 * Hold a local blob under an id, and hand back the URL to draw it with.
 *
 * Idempotent per id: rehydration on load and a live drop of the same file must
 * not leave a leaked URL behind.
 */
export const registerLocalMedia = (uploadId: string, blob: Blob): string => {
  const existing = objectUrls.get(uploadId);
  if (existing) return existing.url;

  const url = URL.createObjectURL(blob);
  objectUrls.set(uploadId, { url, type: blob.type });
  announce();
  return url;
};

/** Called once the real URL is in the document and the local copy is dead weight. */
export const releaseLocalMedia = (uploadId: string): void => {
  const held = objectUrls.get(uploadId);
  if (!held) return;
  URL.revokeObjectURL(held.url);
  objectUrls.delete(uploadId);
  announce();
};

/**
 * The URL to actually draw, or `null` when this device does not have the bytes.
 *
 * `null` is a real answer and not an error: it is what a collaborator gets,
 * and what the author gets on a second device. The caller draws "waiting to
 * upload" from it, which is the true statement — where the old code drew the
 * same grey box it draws for a permanently broken image.
 */
export const resolveLocalSrc = (src: string): string | null => {
  const id = uploadIdFromSrc(src);
  return id ? objectUrls.get(id)?.url ?? null : null;
};

/** The recorded MIME type behind a `local:` src, where this device holds it. */
export const localMediaType = (src: string): string | null => {
  const id = uploadIdFromSrc(src);
  return id ? objectUrls.get(id)?.type ?? null : null;
};

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

const getVersion = () => version;

/**
 * Resolve a node's `src` for rendering.
 *
 * Ordinary URLs pass straight through, so the common path costs one
 * `startsWith`. A `local:` src becomes an object URL if this device holds the
 * bytes, and an empty string if it does not — empty rather than the `local:`
 * string itself, because handing that to an `<img>` would produce a failed
 * load and the "broken" placeholder, which is the exact wrong answer.
 */
export const useResolvedSrc = (src: string): { src: string; pendingUpload: boolean } => {
  useSyncExternalStore(subscribe, getVersion, getVersion);

  if (!isLocalSrc(src)) return { src, pendingUpload: false };
  return { src: resolveLocalSrc(src) ?? '', pendingUpload: true };
};

/** Test seam. Not used by the app. */
export const __resetPendingMedia = () => {
  objectUrls.forEach((held) => URL.revokeObjectURL(held.url));
  objectUrls.clear();
  version = 0;
  listeners.clear();
};

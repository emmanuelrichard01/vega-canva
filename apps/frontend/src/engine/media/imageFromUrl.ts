import { nanoid } from 'nanoid';
import { createNode, deleteNode, doc, readNode } from '../document';
import { canEditObjects } from '../model/permissions';
import { cameraSystem } from '../CameraSystem';
import { fetchLinkPreview } from '../link/linkFetch';
import { parseLink } from '../link/linkProviders';
import type { LinkMeta } from '../link/linkTypes';
import { placementSize } from './imageFrame';

/**
 * Pictures from a web address.
 *
 * ## Only through the server
 *
 * The browser never loads the address itself. The server's preview service
 * fetches it through `safeFetch` (which refuses private networks, odd ports
 * and oversized bodies), sniffs the bytes to confirm they are a picture, and
 * stores a copy on this room's media store. The board only ever holds that
 * copy's URL, so the picture cannot change or vanish under it, works in
 * exports without tainting the canvas, and loading the board does not tell the
 * original site who is looking.
 */

/** Pasted pictures arrive a little smaller than dropped files: they are usually references, not artwork. */
const PASTED_IMAGE_MAX = 640;

export type ImageFromUrlResult =
  | { ok: true; id: string }
  | { ok: false; reason: string; kind: 'invalid' | 'not-image' | 'failed' | 'read-only' };

function measure(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img.naturalWidth && img.naturalHeight ? { width: img.naturalWidth, height: img.naturalHeight } : null);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function naturalSizeOf(meta: Pick<LinkMeta, 'image' | 'imageWidth' | 'imageHeight'>) {
  if (meta.imageWidth && meta.imageHeight) return { width: meta.imageWidth, height: meta.imageHeight };
  return meta.image ? measure(meta.image) : null;
}

/** What the preview service says about an address, reduced to "is it a picture we now hold". */
export function storedPicture(meta: Pick<LinkMeta, 'type' | 'image'> | undefined): string | null {
  if (!meta || meta.type !== 'image' || typeof meta.image !== 'string') return null;
  return /^https?:\/\//i.test(meta.image) ? meta.image : null;
}

/**
 * Turn a link card that turned out to be a picture into the picture.
 *
 * Same id, same centre, one transaction: the selection that held the card now
 * holds the image, and one undo brings the card back. Resolves false, leaving
 * the card alone, when the card moved on (deleted, re-pointed) while the
 * picture was being measured.
 */
export async function replaceLinkWithImage(
  id: string,
  url: string,
  meta: Pick<LinkMeta, 'type' | 'image' | 'imageWidth' | 'imageHeight'>
): Promise<boolean> {
  if (!canEditObjects()) return false;
  const src = storedPicture(meta);
  if (!src) return false;
  const natural = await naturalSizeOf(meta);
  if (!natural) return false;

  const card = readNode(id) as { type?: string; x?: number; y?: number; width?: number; height?: number; link?: { url?: string } } | null;
  if (!card || card.type !== 'link' || card.link?.url !== url) return false;
  const size = placementSize(natural, PASTED_IMAGE_MAX);
  const cx = (card.x ?? 0) + (card.width ?? 0) / 2;
  const cy = (card.y ?? 0) + (card.height ?? 0) / 2;

  doc.transact(() => {
    deleteNode(id);
    createNode({
      id,
      type: 'image',
      x: Math.round(cx - size.width / 2),
      y: Math.round(cy - size.height / 2),
      ...size,
      src,
      naturalWidth: natural.width,
      naturalHeight: natural.height,
      appearance: {},
    } as never);
  });
  return true;
}

/**
 * Place the picture at `raw` on the board, centred on `at` (or the view).
 *
 * A web page rather than a picture is reported as `not-image`, so the caller
 * can offer it as a link card instead of silently placing one.
 */
export async function insertImageFromUrl(raw: string, at?: { x: number; y: number }): Promise<ImageFromUrlResult> {
  if (!canEditObjects()) return { ok: false, kind: 'read-only', reason: 'Only editors can add pictures to this board.' };
  const parsed = parseLink(raw);
  if (!parsed) return { ok: false, kind: 'invalid', reason: 'That is not a web address.' };

  let answer = await fetchLinkPreview(parsed.url.href);
  // The picture is stored by the second half of a two-part answer.
  if (answer.meta && answer.pending) {
    const settled = await fetchLinkPreview(parsed.url.href, 25_000);
    if (settled.meta) answer = settled;
  }
  if (!answer.meta) return { ok: false, kind: 'failed', reason: answer.error ?? 'That address could not be reached.' };
  const src = storedPicture(answer.meta);
  if (!src) {
    return answer.meta.type && answer.meta.type !== 'image'
      ? { ok: false, kind: 'not-image', reason: 'That address is a page, not a picture.' }
      : { ok: false, kind: 'failed', reason: 'The picture at that address could not be kept.' };
  }
  const natural = await naturalSizeOf(answer.meta);
  if (!natural) return { ok: false, kind: 'failed', reason: 'The picture at that address could not be read.' };

  const centre = at ?? cameraSystem.screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
  const size = placementSize(natural);
  const id = createNode({
    id: nanoid(),
    type: 'image',
    x: Math.round(centre.x - size.width / 2),
    y: Math.round(centre.y - size.height / 2),
    ...size,
    src,
    naturalWidth: natural.width,
    naturalHeight: natural.height,
    appearance: {},
  } as never);
  return id ? { ok: true, id } : { ok: false, kind: 'read-only', reason: 'Only editors can add pictures to this board.' };
}

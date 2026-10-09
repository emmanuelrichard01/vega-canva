import { canvasToBlob, captureRaster, mountForCapture } from '../export/raster';
import { frameExportBounds } from '../export/bounds';
import { FORMAT_SPECS } from '../export/ExportTypes';
import { descendantsOfFrame } from '../model/frames';
import type { AnyNode, FrameNode } from '../model/schema';
import { useStore } from '../../hooks/useStore';
import { isPlaceholder } from './placeholderText';

/**
 * Pictures of slides, drawn by the board's own renderer.
 *
 * The presenter view's current and next slide, the slide view's grid, the
 * transitions and the PDF are all the real slide, not a sketch of it: each is
 * captured from the Konva stage through the export path, which mounts what is
 * off screen, waits for fonts and pictures, and draws only the slide's own
 * objects. Captures borrow the stage, so they run one at a time.
 *
 * Unfilled placeholders are left out, as they are when presenting.
 */

type Stage = { toCanvas: unknown } & Record<string, unknown>;

export function boardStage(): Stage | null {
  if (typeof window === 'undefined') return null;
  return ((window as unknown as { _konva_stage?: Stage })._konva_stage ?? null) as Stage | null;
}

let queue: Promise<unknown> = Promise.resolve();

/** Run `job` after every capture already asked for. */
function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

/** The ids a slide's picture is made of: the frame, what it holds, minus unfilled placeholders. */
export function slideIds(frameId: string, objects: Record<string, AnyNode>, filter?: (node: AnyNode) => boolean): string[] {
  const list = Object.values(objects);
  return [frameId, ...descendantsOfFrame(frameId, list)].filter((id) => {
    const node = objects[id];
    if (!node || node.hidden || isPlaceholder(node as never)) return false;
    return filter ? filter(node) : true;
  });
}

export interface SlideCaptureOptions {
  /** Pixels per world unit. */
  scale: number;
  /** Which of the slide's objects to draw; all of them when absent. */
  filter?: (node: AnyNode) => boolean;
  /** Draw the frame's page behind. On by default. */
  page?: boolean;
}

/**
 * The slide `frameId`, drawn at `scale`. Null when there is no stage (a test,
 * or the board has not mounted) or nothing to draw.
 */
export function captureSlide(frameId: string, options: SlideCaptureOptions): Promise<HTMLCanvasElement | null> {
  return serial(async () => {
    const stage = boardStage();
    const objects = useStore.getState().objects as Record<string, AnyNode>;
    const frame = objects[frameId] as FrameNode | undefined;
    if (!stage || !frame || frame.type !== 'frame') return null;
    const ids = slideIds(frameId, objects, (n) => (n.id === frameId ? options.page !== false : options.filter ? options.filter(n) : true));
    if (ids.length === 0) return null;
    const exportOptions = {
      stage,
      bounds: frameExportBounds(frame),
      selectedOnly: true,
      selectedIds: ids,
      scale: options.scale,
      background: 'transparent' as const,
    };
    const release = await mountForCapture(exportOptions);
    try {
      return captureRaster(exportOptions, FORMAT_SPECS.png).canvas;
    } finally {
      release();
    }
  });
}

// ---------------------------------------------------------------------------
// Thumbnails
// ---------------------------------------------------------------------------

/**
 * A slide's version: changes whenever anything on it changes. Cheap enough to
 * compute per render for a deck, and the cache key that keeps a thumbnail
 * from being captured twice.
 */
export function slideVersion(frameId: string, objects: Record<string, AnyNode>, dark: boolean): string {
  const list = Object.values(objects);
  const ids = [frameId, ...descendantsOfFrame(frameId, list)];
  let stamp = 0;
  for (const id of ids) {
    const n = objects[id] as AnyNode & { updatedAt?: number };
    if (n) stamp = Math.max(stamp, n.updatedAt ?? 0);
  }
  const f = objects[frameId];
  return `${ids.length}:${stamp}:${f ? `${f.x},${f.y},${f.width},${f.height}` : ''}:${dark ? 1 : 0}`;
}

const THUMB_LIMIT = 160;
/** Pictures by slide and size. */
const thumbs = new Map<string, { version: string; url: string }>();
/** The newest picture of each slide, whatever its size. */
const latest = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

/**
 * A JPEG data URL of the slide at thumbnail size, cached by version. Pending
 * requests for the same picture share one capture.
 */
export function slideThumbnail(frameId: string, version: string, width = 480): Promise<string | null> {
  const slot = `${frameId}@${width}`;
  const hit = thumbs.get(slot);
  if (hit && hit.version === version) return Promise.resolve(hit.url);
  const key = `${frameId}@${version}@${width}`;
  const inflight = pending.get(key);
  if (inflight) return inflight;
  const frame = useStore.getState().objects[frameId];
  if (!frame) return Promise.resolve(null);
  const job = captureSlide(frameId, { scale: width / Math.max(1, frame.width) })
    .then((canvas) => {
      if (!canvas) return null;
      const url = canvas.toDataURL('image/jpeg', 0.86);
      thumbs.delete(slot);
      thumbs.set(slot, { version, url });
      latest.set(frameId, url);
      if (thumbs.size > THUMB_LIMIT) thumbs.delete(thumbs.keys().next().value as string);
      return url;
    })
    .catch(() => null)
    .finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
}

/** The newest picture of a slide at any size, drawn while one at the right size is made. */
export function cachedThumbnail(frameId: string): string | null {
  return latest.get(frameId) ?? null;
}

/** One slide as a PNG, at twice slide resolution where the browser allows it. */
export async function slidePng(frameId: string): Promise<Blob> {
  const canvas = await captureSlide(frameId, { scale: 2 });
  if (!canvas) throw new Error('The board is not ready to draw yet. Try again in a moment.');
  return canvasToBlob(canvas, 'image/png');
}

/**
 * Put one slide on the clipboard as a PNG. The picture is handed over as a
 * promise, so the browser keeps the click's permission while it is drawn.
 */
export async function copySlidePng(frameId: string): Promise<{ ok: boolean; message?: string }> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    return { ok: false, message: 'This browser cannot copy images. Export the deck as a PDF instead.' };
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': slidePng(frameId) })]);
    return { ok: true };
  } catch (error) {
    const blocked = error instanceof Error && error.name === 'NotAllowedError';
    return { ok: false, message: blocked ? 'Your browser blocked the clipboard. Allow clipboard access and try again.' : 'Could not copy the slide.' };
  }
}

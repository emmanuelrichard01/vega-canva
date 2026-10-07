import { emojiUrl } from './emojiCode';

/**
 * Emoji artwork for the canvas: rasterised once per size, reused everywhere.
 *
 * Konva draws bitmaps, and an SVG drawn into a canvas at one size and scaled
 * is soft when zoomed in and wasteful when zoomed out. So each emoji is
 * rasterised into a **size bucket** — the next step up from the pixels it
 * actually covers on screen — and the bitmap is shared by every node that
 * shows that emoji at that bucket. Zooming re-rasterises only when a bucket
 * boundary is crossed, and the previous bucket keeps drawing until the new
 * one lands, so nothing flickers blank.
 *
 * The cache is bounded and least-recently-used; evicted `ImageBitmap`s are
 * closed so their memory is returned immediately rather than at GC.
 */

export const SIZE_BUCKETS = [16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512] as const;
const CACHE_LIMIT = 320;
const SOURCE_LIMIT = 160;

/** The smallest bucket that covers `px` device pixels. */
export function bucketFor(px: number): number {
  if (!(px > 0)) return SIZE_BUCKETS[0];
  for (const b of SIZE_BUCKETS) if (b >= px) return b;
  return SIZE_BUCKETS[SIZE_BUCKETS.length - 1];
}

type Slot =
  | { state: 'loading' }
  | { state: 'ready'; image: CanvasImageSource; close?: () => void }
  | { state: 'failed' };

/** Injectable for tests: how an SVG becomes something drawable. */
export interface EmojiRasteriser {
  loadSource(url: string): Promise<CanvasImageSource>;
  rasterise(source: CanvasImageSource, size: number): Promise<{ image: CanvasImageSource; close?: () => void }>;
}

const browserRasteriser: EmojiRasteriser = {
  loadSource(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`emoji ${url}`));
      img.src = url;
    });
  },
  async rasterise(source, size) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(source, 0, 0, size, size);
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(canvas);
      return { image: bitmap, close: () => bitmap.close() };
    }
    return { image: canvas };
  },
};

let rasteriser: EmojiRasteriser = browserRasteriser;
const slots = new Map<string, Slot>();
const sources = new Map<string, Promise<CanvasImageSource>>();
const failedCodes = new Set<string>();
let epoch = 0;
const listeners = new Set<() => void>();

function touch(key: string, slot: Slot): void {
  slots.delete(key);
  slots.set(key, slot);
  while (slots.size > CACHE_LIMIT) {
    const oldest = slots.keys().next().value as string;
    const old = slots.get(oldest);
    slots.delete(oldest);
    if (old?.state === 'ready') old.close?.();
  }
}

function changed(): void {
  epoch++;
  listeners.forEach((fn) => fn());
}

function sourceFor(code: string): Promise<CanvasImageSource> {
  let p = sources.get(code);
  if (!p) {
    p = rasteriser.loadSource(emojiUrl(code));
    sources.set(code, p);
    while (sources.size > SOURCE_LIMIT) sources.delete(sources.keys().next().value as string);
  }
  return p;
}

function request(code: string, bucket: number): void {
  const key = `${code}@${bucket}`;
  if (slots.has(key)) return;
  touch(key, { state: 'loading' });
  sourceFor(code)
    .then((src) => rasteriser.rasterise(src, bucket))
    .then(({ image, close }) => {
      // Evicted while loading: keep nothing, draw nothing stale.
      if (slots.get(key)?.state !== 'loading') {
        close?.();
        return;
      }
      touch(key, { state: 'ready', image, close });
      changed();
    })
    .catch(() => {
      sources.delete(code);
      failedCodes.add(code);
      if (slots.get(key)?.state === 'loading') touch(key, { state: 'failed' });
      changed();
    });
}

export interface EmojiBitmap {
  image: CanvasImageSource | null;
  /** True once the artwork is known not to exist; draw the glyph instead. */
  failed: boolean;
}

/**
 * The best artwork available right now for `code` at `bucket`, starting a
 * load if needed. Falls back to the nearest bucket already drawn.
 */
export function emojiBitmap(code: string, bucket: number): EmojiBitmap {
  if (!code) return { image: null, failed: true };
  if (failedCodes.has(code)) return { image: null, failed: true };
  const key = `${code}@${bucket}`;
  const slot = slots.get(key);
  if (slot?.state === 'ready') {
    touch(key, slot);
    return { image: slot.image, failed: false };
  }
  if (!slot) request(code, bucket);
  let best: CanvasImageSource | null = null;
  let bestDist = Infinity;
  for (const b of SIZE_BUCKETS) {
    const s = slots.get(`${code}@${b}`);
    if (s?.state === 'ready' && Math.abs(b - bucket) < bestDist) {
      best = s.image;
      bestDist = Math.abs(b - bucket);
    }
  }
  return { image: best, failed: false };
}

export const emojiCanvasEpoch = {
  get: () => epoch,
  subscribe: (fn: () => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

/** For tests: swap the browser rasteriser and start from an empty cache. */
export function resetEmojiCanvasForTests(next?: EmojiRasteriser): void {
  slots.forEach((s) => s.state === 'ready' && s.close?.());
  slots.clear();
  sources.clear();
  failedCodes.clear();
  rasteriser = next ?? browserRasteriser;
}

/** For tests and the HUD: how many rasters are held. */
export function emojiCacheSize(): number {
  return slots.size;
}

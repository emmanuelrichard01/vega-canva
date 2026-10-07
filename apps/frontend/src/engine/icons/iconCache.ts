import type { IconEntry, IconPathRecord } from './iconTypes';

/**
 * Parsed icon artwork, shared by every instance.
 *
 * A board of two thousand EC2 icons parses EC2's path data once: `artFor`
 * returns the same `IconArt` to all of them. Drawing is then `fill(Path2D)` per
 * layer, which the browser caches the tessellation of.
 *
 * Far zoom is cheaper still. Below `BITMAP_MAX_PX` device pixels an icon is a
 * few dozen pixels across and its detail is invisible, so it is rasterised once
 * per (icon, colour, size bucket) into an `ImageBitmap` and drawn with a single
 * `drawImage`. Buckets are powers of two, so zooming through a range reuses a
 * handful of bitmaps rather than minting one per zoom step. Above the limit the
 * vector path is drawn, which stays crisp at any zoom.
 */
export interface IconLayer {
  path: Path2D;
  f?: string;
  fo: number;
  eo: boolean;
  s?: string;
  sw: number;
  so: number;
  lc?: CanvasLineCap;
  lj?: CanvasLineJoin;
}

export interface IconArt {
  w: number;
  h: number;
  layers: IconLayer[];
}

export const BITMAP_MAX_PX = 128;
const MIN_BUCKET = 16;
const MAX_BITMAPS = 600;

const arts = new Map<string, IconArt>();
const stats = { parses: 0, bitmaps: 0 };

/** Counters for tests and the benchmark. */
export const iconCacheStats = () => ({ ...stats, arts: arts.size });
export function clearIconCache() {
  arts.clear();
  for (const b of bitmaps.values()) b.close?.();
  bitmaps.clear();
  stats.parses = 0;
  stats.bitmaps = 0;
}

const CAPS = new Set(['round', 'square']);
const JOINS = new Set(['round', 'bevel']);

function layerOf(rec: IconPathRecord): IconLayer {
  const base = new Path2D();
  const p = new Path2D(rec.d);
  if (rec.m && rec.m.length === 6) {
    base.addPath(p, { a: rec.m[0], b: rec.m[1], c: rec.m[2], d: rec.m[3], e: rec.m[4], f: rec.m[5] });
  } else {
    base.addPath(p);
  }
  return {
    path: base,
    f: rec.f,
    fo: rec.fo ?? 1,
    eo: rec.eo === 1,
    s: rec.s,
    sw: rec.sw ?? 1,
    so: rec.so ?? 1,
    lc: rec.lc && CAPS.has(rec.lc) ? (rec.lc as CanvasLineCap) : undefined,
    lj: rec.lj && JOINS.has(rec.lj) ? (rec.lj as CanvasLineJoin) : undefined,
  };
}

/** The parsed artwork for `key`, parsing `entry` the first time only. */
export function artFor(key: string, entry: IconEntry): IconArt {
  let art = arts.get(key);
  if (!art) {
    stats.parses++;
    art = { w: entry.v[0], h: entry.v[1], layers: entry.p.map(layerOf) };
    arts.set(key, art);
  }
  return art;
}

const isWhite = (c: string) => c === '#ffffff' || c === '#fff';
/** Recolouring keeps white glyphs white and repaints everything else. */
export const tinted = (c: string, colour?: string) => (colour && !isWhite(c) ? colour : c);

/** Where the artwork sits inside a `w` x `h` box: contained, centred. */
export function fitBox(art: { w: number; h: number }, w: number, h: number) {
  const s = Math.min(w / art.w, h / art.h);
  return { s, x: (w - art.w * s) / 2, y: (h - art.h * s) / 2, fw: art.w * s, fh: art.h * s };
}

/** Draw the artwork into a `w` x `h` box on a native 2D context. */
export function drawArt(ctx: CanvasRenderingContext2D, art: IconArt, w: number, h: number, colour?: string) {
  const fit = fitBox(art, w, h);
  ctx.save();
  ctx.translate(fit.x, fit.y);
  ctx.scale(fit.s, fit.s);
  for (const l of art.layers) {
    if (l.f) {
      ctx.globalAlpha = l.fo;
      ctx.fillStyle = tinted(l.f, colour);
      ctx.fill(l.path, l.eo ? 'evenodd' : 'nonzero');
    }
    if (l.s) {
      ctx.globalAlpha = l.so;
      ctx.strokeStyle = tinted(l.s, colour);
      ctx.lineWidth = l.sw;
      ctx.lineCap = l.lc ?? 'butt';
      ctx.lineJoin = l.lj ?? 'miter';
      ctx.stroke(l.path);
    }
  }
  ctx.restore();
}

// ------------------------------------------------------------------ bitmaps

const bitmaps = new Map<string, ImageBitmap>();
const pending = new Set<string>();
const waiters = new Map<string, Set<() => void>>();
let queue: Array<() => void> = [];
let scheduled = false;

const bucketOf = (devPx: number) => {
  let b = MIN_BUCKET;
  while (b < devPx && b < 256) b *= 2;
  return b;
};

function pump() {
  scheduled = false;
  const batch = queue.splice(0, 6);
  for (const job of batch) job();
  if (queue.length) schedule();
}
function schedule() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(pump, 0);
}

/**
 * A cached bitmap for an icon this small on screen, or `null` when it is large
 * enough to draw as vector, or not rasterised yet (in which case `onReady`
 * fires once and the caller redraws).
 */
export function bitmapFor(
  key: string,
  art: IconArt,
  colour: string | undefined,
  devPx: number,
  onReady?: () => void,
): ImageBitmap | null {
  if (devPx > BITMAP_MAX_PX || typeof createImageBitmap === 'undefined') return null;
  const bucket = bucketOf(devPx);
  const bkey = `${key}|${colour ?? ''}|${bucket}`;
  const hit = bitmaps.get(bkey);
  if (hit) {
    bitmaps.delete(bkey);
    bitmaps.set(bkey, hit); // most recently used last
    return hit;
  }
  if (onReady) {
    let set = waiters.get(bkey);
    if (!set) waiters.set(bkey, (set = new Set()));
    set.add(onReady);
  }
  if (pending.has(bkey)) return null;
  pending.add(bkey);
  queue.push(() => {
    const k = bucket / Math.max(art.w, art.h);
    const cw = Math.max(1, Math.ceil(art.w * k));
    const ch = Math.max(1, Math.ceil(art.h * k));
    const canvas: OffscreenCanvas | HTMLCanvasElement =
      typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(cw, ch) : Object.assign(document.createElement('canvas'), { width: cw, height: ch });
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
    if (!ctx) {
      pending.delete(bkey);
      return;
    }
    drawArt(ctx, art, cw, ch, colour);
    createImageBitmap(canvas as ImageBitmapSource).then(
      (bmp) => {
        stats.bitmaps++;
        pending.delete(bkey);
        bitmaps.set(bkey, bmp);
        if (bitmaps.size > MAX_BITMAPS) {
          const oldest = bitmaps.keys().next().value as string;
          bitmaps.get(oldest)?.close?.();
          bitmaps.delete(oldest);
        }
        const set = waiters.get(bkey);
        waiters.delete(bkey);
        set?.forEach((cb) => cb());
      },
      () => pending.delete(bkey),
    );
  });
  schedule();
  return null;
}

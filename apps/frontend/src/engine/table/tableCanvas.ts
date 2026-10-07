import { roughPolyline, type SketchLevel } from '../model/rough';
import { hachure, SKETCH_FONT, SKETCH_FONT_SCALE } from '../chart/chartSketch';
import type { TableLayout } from './tableLayout';
import { cellPrims, type Prim, type TextMeasure } from './tablePaint';
import { TABLE_FONT } from './tableMeasure';

/**
 * Painting a laid-out table on a 2D canvas — the board's renderer and the
 * editor's frozen bands draw with this one painter, so a frozen header is
 * the same pixels as the header it stands for.
 */

export interface SketchPaths {
  segments: Array<{ path: Path2D; color: string; width: number }>;
  hatches: Array<Path2D | null>;
  frame: Path2D | null;
}

export function buildSketch(layout: TableLayout, seed: number, level: SketchLevel): SketchPaths {
  return {
    segments: layout.segments.map((s, i) => ({
      path: new Path2D(roughPolyline([{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }], { seed: seed + i * 13, level, closed: false })),
      color: s.color,
      width: s.width * 1.2,
    })),
    hatches: layout.cells.map((c, i) => (c.fill ? new Path2D(hachure({ x: c.x, y: c.y, width: c.w, height: c.h }, seed + i * 7, 7)) : null)),
    frame:
      layout.frame.width > 0
        ? new Path2D(
            roughPolyline(
              [
                { x: 0, y: 0 },
                { x: layout.width, y: 0 },
                { x: layout.width, y: layout.height },
                { x: 0, y: layout.height },
                { x: 0, y: 0 },
              ],
              { seed: seed + 999, level, closed: false }
            )
          )
        : null,
  };
}

export function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

const pathCache = new Map<string, Path2D>();
function pathOf(d: string): Path2D {
  let p = pathCache.get(d);
  if (!p) {
    if (pathCache.size > 5000) pathCache.clear();
    p = new Path2D(d);
    pathCache.set(d, p);
  }
  return p;
}

function paint(ctx: CanvasRenderingContext2D, p: Prim, family: string, sketch: boolean) {
  switch (p.t) {
    case 'rect':
      roundRectPath(ctx, p.x, p.y, p.w, p.h, p.r ?? 0);
      if (p.fill) {
        ctx.globalAlpha = p.opacity ?? 1;
        ctx.fillStyle = p.fill;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (p.stroke) {
        ctx.strokeStyle = p.stroke;
        ctx.lineWidth = p.sw ?? 1;
        ctx.stroke();
      }
      return;
    case 'path': {
      const path = pathOf(p.d);
      if (p.fill) {
        ctx.fillStyle = p.fill;
        ctx.fill(path);
      }
      if (p.stroke) {
        ctx.strokeStyle = p.stroke;
        ctx.lineWidth = p.sw ?? 1;
        ctx.lineJoin = 'round';
        ctx.stroke(path);
      }
      return;
    }
    case 'text': {
      ctx.font = `${p.italic ? 'italic ' : ''}${p.bold || sketch ? 600 : 400} ${p.size}px ${family}`;
      ctx.fillStyle = p.fill;
      ctx.textAlign = p.anchor === 'middle' ? 'center' : p.anchor === 'end' ? 'right' : 'left';
      ctx.fillText(p.s, p.x, p.y + 0.5);
      if (p.underline) {
        const w = ctx.measureText(p.s).width;
        const x0 = p.anchor === 'middle' ? p.x - w / 2 : p.anchor === 'end' ? p.x - w : p.x;
        ctx.fillRect(x0, p.y + p.size * 0.52, w, Math.max(0.8, p.size * 0.07));
      }
      return;
    }
  }
}

/**
 * The part of node space the canvas shows, from the context's transform —
 * which already carries the device pixel ratio, the camera, and the node's
 * rotation. The canvas's four corners, in device pixels, mapped back through
 * its inverse: no second division by the pixel ratio, and a rotated table
 * culls by what is really on screen rather than by its unrotated rows.
 */
export function visibleRegion(ctx: CanvasRenderingContext2D): { x0: number; y0: number; x1: number; y1: number } {
  const { a, b, c, d, e, f } = ctx.getTransform();
  const det = a * d - b * c;
  if (!det) return { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity };
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [X, Y] of [
    [0, 0],
    [W, 0],
    [0, H],
    [W, H],
  ]) {
    xs.push((d * (X - e) - c * (Y - f)) / det);
    ys.push((-b * (X - e) + a * (Y - f)) / det);
  }
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/**
 * Each cell's paint, built when the cell is first on screen and kept for as
 * long as the layout lives — a 2,000-row table measures and fits only the
 * text somebody can see.
 */
export function primsCache(layout: TableLayout, measure: TextMeasure, sketch: boolean): (i: number) => Prim[] {
  const cache = new Array<Prim[] | undefined>(layout.cells.length);
  const k = sketch ? SKETCH_FONT_SCALE : 1;
  return (i) => (cache[i] ??= cellPrims(layout.cells[i], layout, { measure, fontScale: k }));
}

export interface PaintTableOptions {
  sketch?: SketchLevel;
  sketchPaths: SketchPaths | null;
  prims: (i: number) => Prim[];
  /** Node space to cull against; everything when absent. */
  region?: { x0: number; y0: number; x1: number; y1: number };
}

/** The whole table, cells, rules, text and frame, culled to a region of node space. */
export function paintTable(ctx: CanvasRenderingContext2D, layout: TableLayout, opts: PaintTableOptions): void {
  const { width: w, height: h } = layout;
  const { sketch, sketchPaths } = opts;
  const radius = sketch ? 0 : layout.frame.radius;
  const r = opts.region ?? visibleRegion(ctx);
  const visible = (x: number, y: number, ww: number, hh: number) => y + hh >= r.y0 - 2 && y <= r.y1 + 2 && x + ww >= r.x0 - 2 && x <= r.x1 + 2;

  ctx.save();
  if (layout.frame.fill !== 'transparent') {
    roundRectPath(ctx, 0, 0, w, h, radius);
    ctx.fillStyle = layout.frame.fill;
    ctx.fill();
  }
  roundRectPath(ctx, 0, 0, w, h, radius);
  ctx.clip();

  layout.cells.forEach((c, i) => {
    if (!c.fill || !visible(c.x, c.y, c.w, c.h)) return;
    if (sketchPaths) {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = c.fill;
      ctx.fillRect(c.x, c.y, c.w, c.h);
      ctx.globalAlpha = 0.9;
      const hatch = sketchPaths.hatches[i];
      if (hatch) {
        ctx.strokeStyle = c.fill;
        ctx.lineWidth = 1;
        ctx.stroke(hatch);
      }
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = c.fill;
      ctx.fillRect(c.x, c.y, c.w, c.h);
    }
  });

  ctx.lineCap = 'round';
  if (sketchPaths) {
    for (const s of sketchPaths.segments) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.stroke(s.path);
    }
  } else {
    for (const s of layout.segments) {
      if (!visible(Math.min(s.x1, s.x2), Math.min(s.y1, s.y2), Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1))) continue;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
    }
  }

  const family = sketch ? SKETCH_FONT : TABLE_FONT;
  ctx.textBaseline = 'middle';
  layout.cells.forEach((c, i) => {
    if (!visible(c.x, c.y, c.w, c.h)) return;
    for (const p of opts.prims(i)) paint(ctx, p, family, Boolean(sketch));
  });
  ctx.restore();

  if (layout.frame.width > 0) {
    ctx.strokeStyle = layout.frame.color;
    if (sketchPaths?.frame) {
      ctx.lineWidth = 1.6;
      ctx.stroke(sketchPaths.frame);
    } else {
      ctx.lineWidth = 1;
      roundRectPath(ctx, 0, 0, w, h, radius);
      ctx.stroke();
    }
  }
}

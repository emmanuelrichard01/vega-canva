import { THEMES } from '../../engine/model/stickyThemes';
import type { StickyTheme } from '../../engine/model/schema';

/**
 * A picture for a board this device has never opened.
 *
 * There is no summary to draw, because the board's contents live on a server
 * this device has not asked yet. A grey box captioned "Not opened" made most of
 * a new person's library look broken, so instead each board gets a small
 * composition in the board's own vocabulary — notes, frames, connectors and one
 * solid shape on a dot grid — seeded from its id and name. The same board
 * always draws the same picture, two boards almost never draw the same one, and
 * nothing here pretends to be the board's real content: it is a monogram, not a
 * thumbnail.
 *
 * Pure and cheap: a seeded PRNG, a few dozen numbers, no DOM.
 */

export const GEN_W = 160;
export const GEN_H = 100;

export type GenElement =
  | { k: 'note'; x: number; y: number; w: number; h: number; rot: number; fill: string; edge: string; ink: string; lines: number }
  | { k: 'frame'; x: number; y: number; w: number; h: number; label: number }
  | { k: 'shape'; form: 'rect' | 'ellipse' | 'diamond'; x: number; y: number; w: number; h: number; fill: string }
  | { k: 'link'; d: string; head: string };

export interface GeneratedCover {
  /** The paper the composition is keyed to; the ground is tinted from it. */
  key: string;
  /** Which arrangement was drawn, for tests and debugging. */
  layout: 'cluster' | 'flow' | 'frames' | 'map';
  elements: GenElement[];
}

/** Triads from the note palette, each one hue family plus a neighbour. */
const PALETTES: readonly (readonly StickyTheme[])[] = [
  ['yellow', 'peach', 'coral'],
  ['mint', 'lime', 'sky'],
  ['sky', 'lavender', 'pink'],
  ['yellow', 'pink', 'lavender'],
  ['lime', 'mint', 'yellow'],
  ['lavender', 'coral', 'peach'],
  ['peach', 'sky', 'yellow'],
  ['pink', 'coral', 'lavender'],
];

/** cyrb53-style string hash, folded to 32 bits. */
export function hashSeed(text: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
}

/** mulberry32: small, fast, and good enough to place a dozen notes. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

interface Ctx {
  rand: () => number;
  between: (lo: number, hi: number) => number;
  pick: <T>(list: readonly T[]) => T;
  palette: readonly StickyTheme[];
}

function note(ctx: Ctx, x: number, y: number, size: number, theme?: StickyTheme): GenElement {
  const t = THEMES[theme ?? ctx.pick(ctx.palette)];
  return {
    k: 'note',
    x: r1(x), y: r1(y), w: r1(size), h: r1(size),
    rot: r1(ctx.between(-5, 5)),
    fill: t.bg, edge: t.edge, ink: t.text,
    lines: 1 + Math.floor(ctx.rand() * 3),
  };
}

/** A curved connector from a to b, leaving and arriving horizontally or vertically, with an arrowhead. */
function link(ax: number, ay: number, bx: number, by: number, vertical = false): GenElement {
  const dx = bx - ax;
  const dy = by - ay;
  const c1x = vertical ? ax : ax + dx * 0.5;
  const c1y = vertical ? ay + dy * 0.5 : ay;
  const c2x = vertical ? bx : bx - dx * 0.5;
  const c2y = vertical ? by - dy * 0.5 : by;
  // The head points along the last segment of the curve.
  let ux = bx - c2x;
  let uy = by - c2y;
  const len = Math.hypot(ux, uy) || 1;
  ux /= len;
  uy /= len;
  const s = 3.2;
  const p1 = [bx - ux * s - uy * s * 0.6, by - uy * s + ux * s * 0.6];
  const p2 = [bx - ux * s + uy * s * 0.6, by - uy * s - ux * s * 0.6];
  return {
    k: 'link',
    d: `M${r1(ax)} ${r1(ay)} C${r1(c1x)} ${r1(c1y)} ${r1(c2x)} ${r1(c2y)} ${r1(bx)} ${r1(by)}`,
    head: `${r1(bx)},${r1(by)} ${r1(p1[0])},${r1(p1[1])} ${r1(p2[0])},${r1(p2[1])}`,
  };
}

function hero(ctx: Ctx, cx: number, cy: number, w: number, h: number): GenElement {
  const form = ctx.pick(['rect', 'ellipse', 'diamond'] as const);
  // The one solid, deep shape: the palette's own ink, so it reads as a shape on the board rather than as a note.
  return { k: 'shape', form, x: r1(cx - w / 2), y: r1(cy - h / 2), w: r1(w), h: r1(h), fill: THEMES[ctx.palette[0]].text };
}

function cluster(ctx: Ctx): GenElement[] {
  const fx = ctx.between(10, 20);
  const fy = ctx.between(14, 22);
  const cols = ctx.rand() < 0.5 ? 2 : 3;
  const size = cols === 2 ? 22 : 17;
  const gap = 5;
  const fw = cols * size + (cols + 1) * gap;
  const fh = 2 * size + 3 * gap;
  const out: GenElement[] = [{ k: 'frame', x: r1(fx), y: r1(fy), w: r1(fw), h: r1(fh), label: r1(ctx.between(12, 22)) }];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < cols; col++) {
      if (row === 1 && col === cols - 1 && ctx.rand() < 0.4) continue;
      out.push(note(ctx, fx + gap + col * (size + gap) + ctx.between(-1, 1), fy + gap + row * (size + gap) + ctx.between(-1, 1), size));
    }
  }
  const hx = ctx.between(Math.max(fx + fw + 30, 112), 136);
  const hy = ctx.between(30, 70);
  out.push(link(fx + fw + 2, fy + fh / 2, hx - 16, hy));
  out.push(hero(ctx, hx, hy, 26, 20));
  if (ctx.rand() < 0.7) out.push(note(ctx, hx - 10 + ctx.between(-4, 4), hy + (hy < 50 ? 18 : -38), 18));
  return out;
}

function flow(ctx: Ctx): GenElement[] {
  const n = ctx.rand() < 0.5 ? 3 : 4;
  const span = GEN_W - 36;
  const step = span / (n - 1);
  const heroAt = Math.floor(ctx.rand() * n);
  const nodes: { x: number; y: number; w: number; h: number }[] = [];
  const out: GenElement[] = [];
  for (let i = 0; i < n; i++) {
    const x = 18 + i * step;
    const y = 50 + (i % 2 === 0 ? -1 : 1) * ctx.between(6, 16);
    const w = n === 3 ? 26 : 22;
    const h = 17;
    nodes.push({ x, y, w, h });
  }
  for (let i = 0; i < n - 1; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    out.push(link(a.x + a.w / 2 + 1.5, a.y, b.x - b.w / 2 - 2, b.y));
  }
  nodes.forEach((p, i) => {
    if (i === heroAt) out.push(hero(ctx, p.x, p.y, p.w, p.h));
    else {
      const t = THEMES[ctx.palette[1 + (i % 2)]];
      out.push({ k: 'shape', form: ctx.pick(['rect', 'ellipse'] as const), x: r1(p.x - p.w / 2), y: r1(p.y - p.h / 2), w: r1(p.w), h: r1(p.h), fill: t.bg });
    }
  });
  const at = nodes[Math.floor(ctx.rand() * n)];
  out.push(note(ctx, at.x - 9, at.y < 50 ? at.y + 14 : at.y - 34, 18));
  return out;
}

function frames(ctx: Ctx): GenElement[] {
  const out: GenElement[] = [];
  const y = ctx.between(16, 24);
  const h = ctx.between(56, 66);
  const left = { x: 10, w: 66 };
  const right = { x: 84, w: 66 };
  const anchors: { x: number; y: number }[] = [];
  for (const f of [left, right]) {
    out.push({ k: 'frame', x: f.x, y: r1(y), w: f.w, h: r1(h), label: r1(ctx.between(12, 24)) });
    const count = 2 + Math.floor(ctx.rand() * 3);
    for (let i = 0; i < count; i++) {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const nx = f.x + 7 + col * 29 + ctx.between(-1.5, 1.5);
      const ny = y + 7 + row * 27 + ctx.between(-1.5, 1.5);
      out.push(note(ctx, nx, ny, 22, ctx.palette[(i + (f === right ? 1 : 0)) % ctx.palette.length]));
      anchors.push({ x: nx + 11, y: ny + 11 });
    }
  }
  const from = anchors[0];
  const to = anchors[anchors.length - 1];
  out.push(link(left.x + left.w - 4, from.y, right.x + 4, to.y));
  return out;
}

function map(ctx: Ctx): GenElement[] {
  const cx = 80 + ctx.between(-8, 8);
  const cy = 50 + ctx.between(-4, 4);
  const out: GenElement[] = [];
  const count = 4 + Math.floor(ctx.rand() * 2);
  const start = ctx.between(0, Math.PI * 2);
  const notes: GenElement[] = [];
  for (let i = 0; i < count; i++) {
    const angle = start + (i / count) * Math.PI * 2 + ctx.between(-0.25, 0.25);
    const nx = cx + Math.cos(angle) * ctx.between(50, 58);
    const ny = cy + Math.sin(angle) * ctx.between(28, 34);
    const size = 17;
    const x = Math.max(4, Math.min(GEN_W - size - 4, nx - size / 2));
    const yy = Math.max(4, Math.min(GEN_H - size - 4, ny - size / 2));
    const ex = x + size / 2;
    const ey = yy + size / 2;
    // Leave the hub and arrive at the near edge of the note.
    const vertical = Math.abs(ey - cy) > Math.abs(ex - cx) * 0.6;
    const tx = vertical ? ex : ex + (ex > cx ? -size / 2 - 1.5 : size / 2 + 1.5);
    const ty = vertical ? ey + (ey > cy ? -size / 2 - 1.5 : size / 2 + 1.5) : ey;
    out.push(link(cx, cy, tx, ty, vertical));
    notes.push(note(ctx, x, yy, size));
  }
  out.push(...notes);
  out.push(hero(ctx, cx, cy, 30, 20));
  return out;
}

const LAYOUTS = { cluster, flow, frames, map } as const;
const LAYOUT_ORDER = ['cluster', 'flow', 'frames', 'map'] as const;

/** The composition for one board. Same id and name, same picture. */
export function generateCover(id: string, name: string): GeneratedCover {
  const rand = prng(hashSeed(`${id}\u0000${name}`));
  const ctx: Ctx = {
    rand,
    between: (lo, hi) => lo + rand() * (hi - lo),
    pick: (list) => list[Math.floor(rand() * list.length) % list.length],
    palette: PALETTES[0],
  };
  ctx.palette = ctx.pick(PALETTES);
  const layout = ctx.pick(LAYOUT_ORDER);
  return { key: THEMES[ctx.palette[0]].bg, layout, elements: LAYOUTS[layout](ctx) };
}

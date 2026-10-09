import { nanoid } from 'nanoid';
import type { NewNodeInput } from '../../document/mutations';
import type { BezierSegment, Point, Shadow } from '../../model/schema';
import type { FillStyle, ShadingDensity, SketchLevel } from '../../model/rough';
import { BRAND, BRAND_INK, textWidth } from '../templateKit';

/**
 * The drawing vocabulary of the illustration boards.
 *
 * `templateKit` is a diagramming kit: labelled boxes on pale grounds, arrows
 * between them. Illustration needs different primitives — a shape drawn by
 * hand at a chosen roughness, a filled vector outline, a pencil line that
 * wanders — and needs them to agree with each other, so the five boards read
 * as one sketchbook rather than five experiments.
 *
 * Everything here returns ordinary `NewNodeInput`. Nothing is a special node:
 * every stroke on these boards can be selected, recoloured and redrawn with
 * the same panel controls anyone else uses, which is the point of drawing the
 * art with the product.
 */

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

/**
 * Four hands of colour: a pen, a wash and a tint for each.
 *
 * `pen` is the outline, `wash` is pen shading (hachure and dots read as a
 * mid-tone because the paper shows between the lines), and `tint` is a solid
 * ground pale enough to carry the pen on top. Amber is the brand; the three
 * cool hues are its counterweight, so the warm logo is the hottest thing on
 * any board it sits on.
 */
export const HAND = {
  amber: { pen: '#B45309', wash: '#F3A024', tint: '#FDE9C4' },
  blue: { pen: '#3355D1', wash: '#7C95F2', tint: '#DCE4FF' },
  teal: { pen: '#0B7A75', wash: '#38B2AC', tint: '#CDF3EE' },
  violet: { pen: '#6741D9', wash: '#9B7DF0', tint: '#E8E0FF' },
  ink: { pen: '#1E1E24', wash: '#5B5B66', tint: '#ECEAE6' },
} as const;

export type Hue = keyof typeof HAND;

/** The frame swatch called Paper: every artboard here is printed on it, so it reads the same on either theme. */
export const PAPER_WARM = '#FAF7F2';

/** The ink of the hand-lettered notes: near-black, never pure. */
export const PEN_INK = '#2B2B33';

// ---------------------------------------------------------------------------
// Shapes, drawn by hand
// ---------------------------------------------------------------------------

export interface SketchOptions {
  hue?: Hue;
  /** Overrides the hue's pen. */
  stroke?: string;
  /** `none` draws the outline only. Defaults to the hue's wash under shading, its tint when solid. */
  fill?: string | 'none';
  fillStyle?: FillStyle;
  density?: ShadingDensity;
  angle?: number;
  level?: SketchLevel;
  rotation?: number;
  weight?: number;
  /** Mixed into the id seed: picks a different hand when one draws badly. */
  seed?: number;
  geometry?: Record<string, unknown>;
  shadow?: Shadow;
  opacity?: number;
  cornerRadius?: number;
  text?: string;
  typography?: Record<string, unknown>;
}

/** A shape from the library, drawn by hand. */
export function sketch(
  x: number,
  y: number,
  width: number,
  height: number,
  kind: string,
  o: SketchOptions = {}
): NewNodeInput {
  const hand = HAND[o.hue ?? 'ink'];
  const style = o.fillStyle ?? 'hachure';
  const fill = o.fill === 'none' ? null : o.fill ?? (style === 'solid' ? hand.tint : hand.wash);
  return {
    id: nanoid(),
    type: 'shape',
    x,
    y,
    width,
    height,
    rotation: o.rotation ?? 0,
    ...(o.opacity !== undefined ? { opacity: o.opacity } : {}),
    geometry: { kind, ...o.geometry },
    ...(o.text ? { text: o.text, typography: { fontFamily: 'Caveat', fontSize: 22, fontWeight: 600, color: PEN_INK, align: 'center', verticalAlign: 'middle', ...o.typography } } : {}),
    appearance: {
      fill: fill ? [{ type: 'solid', color: fill }] : [],
      stroke: { color: o.stroke ?? hand.pen, width: o.weight ?? 2.5, cap: 'round', join: 'round' },
      sketch: o.level ?? 'medium',
      ...(fill && style !== 'solid' ? { fillStyle: style } : {}),
      ...(o.density ? { shadingDensity: o.density } : {}),
      ...(o.angle !== undefined ? { shadingAngle: o.angle } : {}),
      ...(o.seed ? { sketchSeed: o.seed } : {}),
      ...(o.shadow ? { shadow: o.shadow } : {}),
      cornerRadius: o.cornerRadius ?? 0,
    },
  } as NewNodeInput;
}

/**
 * A line or arrow shape between two points, drawn by hand.
 *
 * The node's box is the extent of the run, and the endpoints are stored
 * relative to it — the model's own form for a line, so the panel's end-cap and
 * profile controls work on it unchanged.
 */
export function stroke(
  a: Point,
  b: Point,
  o: {
    hue?: Hue;
    color?: string;
    weight?: number;
    level?: SketchLevel;
    head?: boolean;
    profile?: 'straight' | 'curved' | 'wavy' | 'zigzag' | 'coil';
    waves?: number;
    amplitude?: number;
    pad?: number;
  } = {}
): NewNodeInput {
  const pad = o.pad ?? (o.profile && o.profile !== 'straight' ? 18 : 6);
  const x = Math.min(a.x, b.x) - pad;
  const y = Math.min(a.y, b.y) - pad;
  return {
    id: nanoid(),
    type: 'shape',
    x,
    y,
    width: Math.abs(b.x - a.x) + pad * 2,
    height: Math.abs(b.y - a.y) + pad * 2,
    geometry: {
      kind: o.head === false ? 'line' : 'arrow',
      a: { x: a.x - x, y: a.y - y },
      b: { x: b.x - x, y: b.y - y },
      ...(o.profile && o.profile !== 'straight' ? { lineProfile: o.profile } : {}),
      ...(o.waves ? { lineWaves: o.waves } : {}),
      ...(o.amplitude ? { lineAmplitude: o.amplitude } : {}),
      ...(o.head === false ? {} : { endEnd: 'arrow', arrowEnd: true }),
    },
    appearance: {
      fill: [],
      stroke: { color: o.color ?? HAND[o.hue ?? 'ink'].pen, width: o.weight ?? 2.5, cap: 'round', join: 'round' },
      sketch: o.level ?? 'medium',
      cornerRadius: 0,
    },
  } as NewNodeInput;
}

// ---------------------------------------------------------------------------
// Vector paths
// ---------------------------------------------------------------------------

/** A cubic step: the curve arriving at `to`, leaving the previous anchor along `c1`. */
export type Step = { to: Point; c1?: Point; c2?: Point };

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * A pen path from absolute anchors, re-origined so its box is its extent.
 *
 * `steps[0]` is the start. On a closed path the run home is a straight line
 * unless the first step carries the closing curve's handles, which is the
 * model's own convention (see `BezierGeometry`).
 */
export function vector(
  steps: Step[],
  closed: boolean,
  appearance: Record<string, unknown>,
  extra: Record<string, unknown> = {}
): NewNodeInput {
  const pts: Point[] = [];
  steps.forEach((s) => {
    pts.push(s.to);
    if (s.c1) pts.push(s.c1);
    if (s.c2) pts.push(s.c2);
  });
  const minX = Math.min(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxX = Math.max(...pts.map((p) => p.x));
  const maxY = Math.max(...pts.map((p) => p.y));
  const segments: BezierSegment[] = steps.map((s) => ({
    x: round2(s.to.x - minX),
    y: round2(s.to.y - minY),
    ...(s.c1 ? { cp1x: round2(s.c1.x - minX), cp1y: round2(s.c1.y - minY) } : {}),
    ...(s.c2 ? { cp2x: round2(s.c2.x - minX), cp2y: round2(s.c2.y - minY) } : {}),
  }));
  return {
    id: nanoid(),
    type: 'path',
    x: round2(minX),
    y: round2(minY),
    width: Math.max(1, round2(maxX - minX)),
    height: Math.max(1, round2(maxY - minY)),
    geometry: { kind: 'bezier', segments, closed },
    appearance,
    ...extra,
  } as NewNodeInput;
}

/** A filled outline, no stroke. */
export const solidPath = (steps: Step[], color: string, extra: Record<string, unknown> = {}): NewNodeInput =>
  vector(steps, true, { fill: [{ type: 'solid', color }] }, extra);

/** An open or closed run drawn as a line, no fill. */
export const linePath = (steps: Step[], color: string, width: number, closed = false): NewNodeInput =>
  vector(steps, closed, { fill: [], stroke: { color, width, cap: 'round', join: 'round' } });

/** A straight-sided polygon. */
export const polygon = (points: Point[]): Step[] => points.map((p) => ({ to: p }));

/** A quadratic Bézier, from `from` through control `q` to `to`, as the cubic the model stores. */
export const quad = (from: Point, q: Point, to: Point): Step => ({
  to,
  c1: { x: from.x + (2 / 3) * (q.x - from.x), y: from.y + (2 / 3) * (q.y - from.y) },
  c2: { x: to.x + (2 / 3) * (q.x - to.x), y: to.y + (2 / 3) * (q.y - to.y) },
});

/** Map a run of steps through `f`, for placing artwork drawn in its own units. */
export const place = (steps: Step[], f: (p: Point) => Point): Step[] =>
  steps.map((s) => ({ to: f(s.to), ...(s.c1 ? { c1: f(s.c1) } : {}), ...(s.c2 ? { c2: f(s.c2) } : {}) }));

/**
 * A pencil line, gone over by hand.
 *
 * Stored as a freehand stroke — a centreline plus the outline the pencil would
 * have produced — with a sketch level, so the canvas redraws it from the
 * centreline as a run that wanders and doubles back the way a real pen does.
 * Annotation arrows and squiggles are made of these: a drawn arrow is a line
 * and two barbs, which is exactly one centreline.
 */
export function pencil(points: Point[], color: string, size = 4, level: SketchLevel = 'medium'): NewNodeInput {
  const minX = Math.min(...points.map((p) => p.x)) - size;
  const minY = Math.min(...points.map((p) => p.y)) - size;
  const maxX = Math.max(...points.map((p) => p.x)) + size;
  const maxY = Math.max(...points.map((p) => p.y)) + size;
  const local = points.map((p) => ({ x: round2(p.x - minX), y: round2(p.y - minY) }));
  return {
    id: nanoid(),
    type: 'path',
    x: round2(minX),
    y: round2(minY),
    width: round2(maxX - minX),
    height: round2(maxY - minY),
    geometry: { kind: 'freehand', svgPath: ribbon(local, size / 2), points: local, strokeSize: size },
    appearance: {
      fill: [{ type: 'solid', color }],
      stroke: { color, width: size },
      sketch: level,
    },
  } as NewNodeInput;
}

/** The filled outline of a centreline at an even width: what a pencil stores beside its points. */
function ribbon(points: Point[], half: number): string {
  if (points.length < 2) return '';
  const left: Point[] = [];
  const right: Point[] = [];
  points.forEach((p, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = (-(b.y - a.y) / len) * half;
    const ny = ((b.x - a.x) / len) * half;
    left.push({ x: p.x + nx, y: p.y + ny });
    right.push({ x: p.x - nx, y: p.y - ny });
  });
  const ring = [...left, ...right.reverse()];
  return `M ${ring.map((p) => `${round2(p.x)} ${round2(p.y)}`).join(' L ')} Z`;
}

/** Points along a cubic, for building pencil centrelines from smooth curves. */
export function sampleCubic(p0: Point, c1: Point, c2: Point, p1: Point, count = 18): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
      y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
    });
  }
  return out;
}

/** Two barbs at the end of a run, as extra centreline: tip → barb → tip → barb. */
export function withHead(run: Point[], size = 16, spread = 28): Point[] {
  const tip = run[run.length - 1];
  const from = run[Math.max(0, run.length - 4)];
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
  const barb = (sign: number) => ({
    x: tip.x - size * Math.cos(angle + (sign * spread * Math.PI) / 180),
    y: tip.y - size * Math.sin(angle + (sign * spread * Math.PI) / 180),
  });
  return [...run, barb(1), tip, barb(-1)];
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/**
 * Hand lettering in Caveat, on one line per paragraph.
 *
 * The box is sized to the line set in Inter, which is wider than Caveat by a
 * good margin: the catalogue's overflow check measures Inter, and a box that
 * is honest under the wider face can never clip the narrower one.
 */
export const handNote = (
  x: number,
  y: number,
  text: string,
  fontSize = 26,
  color = PEN_INK,
  extra: Record<string, unknown> = {}
): NewNodeInput => ({
  id: nanoid(),
  type: 'text',
  x,
  y,
  width: Math.ceil(Math.max(...text.split('\n').map((line) => textWidth(line, fontSize, 600)))),
  height: Math.round(fontSize * 1.3 * text.split('\n').length),
  text,
  resize: 'width',
  typography: { fontFamily: 'Caveat', fontSize, fontWeight: 600, color, lineHeight: 1.2 },
  ...extra,
});

// ---------------------------------------------------------------------------
// The brand, drawn
// ---------------------------------------------------------------------------

/**
 * The Vega mark in its own 100-unit square: the amber V with its notched stem,
 * and the four-point sparkle. Traced from `public/favicon.svg`, the vector the
 * favicon, the touch icon and the raster logos are all generated from.
 */
export const VEGA_V: Step[] = [
  { to: { x: 19.78, y: 5.42 } },
  { to: { x: 39.27, y: 5.42 } },
  quad({ x: 39.27, y: 5.42 }, { x: 40.77, y: 5.42 }, { x: 40.77, y: 6.92 }),
  { to: { x: 40.77, y: 55.04 } },
  { to: { x: 69.48, y: 5.42 } },
  { to: { x: 95.95, y: 5.42 } },
  { to: { x: 48.16, y: 88 } },
  quad({ x: 48.16, y: 88 }, { x: 44.45, y: 94.42 }, { x: 40.2, y: 94.42 }),
  { to: { x: 18.28, y: 94.42 } },
  { to: { x: 18.28, y: 67.32 } },
  // The notch: a quarter circle of radius 12 cut into the stem.
  { to: { x: 6.28, y: 55.32 }, c1: { x: 18.28, y: 60.69 }, c2: { x: 12.91, y: 55.32 } },
  { to: { x: 3.99, y: 55.32 } },
  { to: { x: 3.99, y: 32.42 } },
  { to: { x: 13.28, y: 32.42 } },
  { to: { x: 18.28, y: 27.42 }, c1: { x: 16.04, y: 32.42 }, c2: { x: 18.28, y: 30.18 } },
  { to: { x: 18.28, y: 6.92 } },
  quad({ x: 18.28, y: 6.92 }, { x: 18.28, y: 5.42 }, { x: 19.78, y: 5.42 }),
];

export const SPARKLE = (cx: number, cy: number, r: number): Step[] => {
  // Four concave arcs, pinched at 0.055 of the radius: the mark's own star.
  const k = 0.055 * r;
  const top = { x: cx, y: cy - r };
  const right = { x: cx + r, y: cy };
  const bottom = { x: cx, y: cy + r };
  const left = { x: cx - r, y: cy };
  return [
    { to: top },
    quad(top, { x: cx + k, y: cy - k }, right),
    quad(right, { x: cx + k, y: cy + k }, bottom),
    quad(bottom, { x: cx - k, y: cy + k }, left),
    quad(left, { x: cx - k, y: cy - k }, top),
  ];
};

/**
 * The mark as three nodes: the ink tile, the V and the sparkle.
 *
 * Kept crisp on a sketched board (`sketchClean`): a logo drawn by a wobbling
 * pen is no longer the logo.
 */
export function vegaMark(x: number, y: number, size: number, shadow?: Shadow): NewNodeInput[] {
  const s = size / 100;
  const at = (p: Point) => ({ x: x + p.x * s, y: y + p.y * s });
  const tile: NewNodeInput = {
    id: nanoid(),
    type: 'shape',
    x,
    y,
    width: size,
    height: size,
    geometry: { kind: 'rect' },
    appearance: {
      fill: [{ type: 'solid', color: BRAND_INK }],
      cornerRadius: Math.round(12 * s),
      sketchClean: true,
      ...(shadow ? { shadow } : {}),
    },
  } as NewNodeInput;
  return [
    tile,
    solidPath(place(VEGA_V, at), BRAND),
    solidPath(SPARKLE(x + 78.1 * s, y + 76.82 * s, 17.4 * s), '#FFFFFF'),
  ];
}

/**
 * VEGA, as the wordmark draws it: a V and a crossbar-less A of the same
 * stroke, an E of three free bars, and a G that is an open ring with a spur.
 *
 * Measured off `public/brand/wordmark-light.png` (cap height 91 units) rather
 * than set in a font, because no shipped face has that E or that A.
 */
export function vegaWordmark(x: number, y: number, cap: number, color = BRAND_INK): NewNodeInput[] {
  const s = cap / 91;
  const at = (p: Point) => ({ x: x + p.x * s, y: y + p.y * s });
  const nodes: NewNodeInput[] = [];

  nodes.push(solidPath(place(polygon([
    { x: 0, y: 0 }, { x: 18, y: 0 }, { x: 43, y: 64 }, { x: 68, y: 0 }, { x: 86, y: 0 }, { x: 48, y: 91 }, { x: 38, y: 91 },
  ]), at), color));

  for (const [top, w] of [[0, 66], [36, 64], [76, 66]] as const) {
    nodes.push(solidPath(place(polygon([
      { x: 146, y: top }, { x: 146 + w, y: top }, { x: 146 + w, y: top + 15 }, { x: 146, y: top + 15 },
    ]), at), color));
  }

  // The G: a ring of outer radius 46 and stroke 18, open from 0° to -36°,
  // closed by a bar running in from the right edge to the centre.
  const cx = 315;
  const cy = 45.5;
  const R = 46;
  const r = 28;
  const from = (-36 * Math.PI) / 180;
  const to = -2 * Math.PI;
  const ring: Point[] = [];
  const STEPS = 40;
  for (let i = 0; i <= STEPS; i++) {
    const a = from + ((to - from) * i) / STEPS;
    ring.push({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
  }
  // The bar runs in along the ring's end, from the right edge to just past the
  // centre, and the inner edge resumes where the bar's underside meets it.
  const BAR = 12;
  ring.push({ x: cx + 5, y: cy }, { x: cx + 5, y: cy + BAR });
  const resume = to + Math.asin(BAR / r);
  for (let i = 0; i <= STEPS; i++) {
    const a = resume + ((from - resume) * i) / STEPS;
    ring.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  nodes.push(solidPath(place(polygon(ring), at), color));

  nodes.push(solidPath(place(polygon([
    { x: 408, y: 91 }, { x: 446, y: 0 }, { x: 456, y: 0 }, { x: 494, y: 91 }, { x: 476, y: 91 }, { x: 451, y: 30 }, { x: 427, y: 91 },
  ]), at), color));

  return nodes;
}

/** The wordmark's width at a cap height, for centring it. */
export const wordmarkWidth = (cap: number) => (494 * cap) / 91;

/**
 * STUDIO, in the wordmark's light tracked capitals: six stroked letters on a
 * shared baseline, spread across `width`.
 */
export function studioLine(x: number, y: number, cap: number, width: number, color = BRAND): NewNodeInput[] {
  const w = Math.max(1, cap * 0.09);
  const glyphs: Array<{ advance: number; draw: (ox: number) => NewNodeInput[] }> = [];
  const at = (ox: number) => (p: Point) => ({ x: ox + p.x * cap, y: y + p.y * cap });

  glyphs.push({
    advance: 0.66,
    draw: (ox) => [linePath(place([
      { to: { x: 0.63, y: 0.15 } },
      { to: { x: 0.34, y: 0 }, c1: { x: 0.57, y: 0.04 }, c2: { x: 0.46, y: 0 } },
      { to: { x: 0.04, y: 0.26 }, c1: { x: 0.16, y: 0 }, c2: { x: 0.04, y: 0.1 } },
      { to: { x: 0.36, y: 0.5 }, c1: { x: 0.04, y: 0.42 }, c2: { x: 0.2, y: 0.47 } },
      { to: { x: 0.66, y: 0.75 }, c1: { x: 0.53, y: 0.53 }, c2: { x: 0.66, y: 0.6 } },
      { to: { x: 0.33, y: 1 }, c1: { x: 0.66, y: 0.9 }, c2: { x: 0.53, y: 1 } },
      { to: { x: 0.01, y: 0.84 }, c1: { x: 0.18, y: 1 }, c2: { x: 0.06, y: 0.94 } },
    ], at(ox)), color, w)],
  });
  glyphs.push({
    advance: 0.7,
    draw: (ox) => [linePath(place(polygon([
      { x: 0, y: 0 }, { x: 0.7, y: 0 }, { x: 0.35, y: 0 }, { x: 0.35, y: 1 },
    ]), at(ox)), color, w)],
  });
  glyphs.push({
    advance: 0.72,
    draw: (ox) => [linePath(place([
      { to: { x: 0, y: 0 } },
      { to: { x: 0, y: 0.62 } },
      { to: { x: 0.36, y: 1 }, c1: { x: 0, y: 0.86 }, c2: { x: 0.15, y: 1 } },
      { to: { x: 0.72, y: 0.62 }, c1: { x: 0.57, y: 1 }, c2: { x: 0.72, y: 0.86 } },
      { to: { x: 0.72, y: 0 } },
    ], at(ox)), color, w)],
  });
  glyphs.push({
    advance: 0.84,
    draw: (ox) => [linePath(place([
      { to: { x: 0, y: 0 } },
      { to: { x: 0.36, y: 0 } },
      { to: { x: 0.84, y: 0.5 }, c1: { x: 0.66, y: 0 }, c2: { x: 0.84, y: 0.22 } },
      { to: { x: 0.36, y: 1 }, c1: { x: 0.84, y: 0.78 }, c2: { x: 0.66, y: 1 } },
      { to: { x: 0, y: 1 } },
    ], at(ox)), color, w, true)],
  });
  glyphs.push({
    advance: 0,
    draw: (ox) => [linePath(place(polygon([{ x: 0, y: 0 }, { x: 0, y: 1 }]), at(ox)), color, w)],
  });
  glyphs.push({
    advance: 1,
    draw: (ox) => {
      const k = 0.5523 * 0.5;
      return [linePath(place([
        { to: { x: 0.5, y: 0 }, c1: { x: 0, y: 0.5 - k }, c2: { x: 0.5 - k, y: 0 } },
        { to: { x: 1, y: 0.5 }, c1: { x: 0.5 + k, y: 0 }, c2: { x: 1, y: 0.5 - k } },
        { to: { x: 0.5, y: 1 }, c1: { x: 1, y: 0.5 + k }, c2: { x: 0.5 + k, y: 1 } },
        { to: { x: 0, y: 0.5 }, c1: { x: 0.5 - k, y: 1 }, c2: { x: 0, y: 0.5 + k } },
      ], at(ox)), color, w, true)];
    },
  });

  const inked = glyphs.reduce((sum, g) => sum + g.advance * cap, 0);
  const gap = (width - inked) / (glyphs.length - 1);
  const nodes: NewNodeInput[] = [];
  let ox = x;
  for (const g of glyphs) {
    nodes.push(...g.draw(ox));
    ox += g.advance * cap + gap;
  }
  return nodes;
}

/** The brand's own lockup proportions: STUDIO's cap height and width against VEGA's. */
export const STUDIO_CAP = 0.27;
export const STUDIO_WIDTH = 0.6;

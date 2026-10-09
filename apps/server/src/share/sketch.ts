/**
 * A hand-drawn pen, for the site's own share card.
 *
 * The app draws its sketch mode with rough.js in the browser; this server has
 * no DOM and no rough.js, and the card is drawn once at build time, so this is
 * the same idea at the size of one picture: every outline is traced twice by a
 * slightly unsteady hand, closed shapes overshoot where they meet, and fills
 * are either a wash or hachure at rough.js's own -41°.
 *
 * Deterministic. Each drawing takes a seed, so the card is byte-for-byte the
 * same every time it is generated and a rebuild never shows up as a diff.
 */

export type Pt = [number, number];

export const round = (n: number) => Math.round(n * 100) / 100;

/** mulberry32: small, fast, and good enough to make a line wobble. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A smooth curve through the points: Catmull-Rom, written as cubic Béziers. */
export function smooth(points: Pt[], closed: boolean): string {
  if (points.length < 2) return '';
  const n = points.length;
  const at = (i: number): Pt => (closed ? points[(i + n) % n] : points[Math.max(0, Math.min(n - 1, i))]);
  let d = `M${round(points[0][0])} ${round(points[0][1])}`;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${round(c1[0])} ${round(c1[1])} ${round(c2[0])} ${round(c2[1])} ${round(p2[0])} ${round(p2[1])}`;
  }
  return closed ? `${d}Z` : d;
}

/** Straight segments, for outlines that must keep their corners. */
export function polyline(points: Pt[], closed: boolean): string {
  const d = points.map(([x, y], i) => `${i ? 'L' : 'M'}${round(x)} ${round(y)}`).join('');
  return closed ? `${d}Z` : d;
}

/**
 * Long edges get a midpoint, so a jittered polygon bows the way a drawn line
 * does instead of staying ruler-straight between wobbly corners.
 */
function densify(points: Pt[], closed: boolean, step: number): Pt[] {
  const out: Pt[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    out.push(a);
    if (!closed && i === n - 1) break;
    const b = points[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const parts = Math.floor(len / step);
    for (let k = 1; k <= parts; k++) {
      const t = k / (parts + 1);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

export interface Stroke {
  rough?: number;
  /** Corners stay corners: straight segments between the jittered points. */
  sharp?: boolean;
}

/**
 * Two passes of an unsteady pen over the same outline.
 *
 * The second pass starts a little further round a closed shape and runs past
 * where it began, which is the overshoot that makes a sketch read as drawn.
 */
export function roughOutline(points: Pt[], closed: boolean, rand: () => number, { rough = 1.6, sharp = false }: Stroke = {}): string {
  const base = sharp ? densify(points, closed, 60) : points;
  const jitter = (p: Pt, amount: number): Pt => [p[0] + (rand() - 0.5) * 2 * amount, p[1] + (rand() - 0.5) * 2 * amount];
  const pass = (amount: number, shift: number) => {
    let pts = base.map((p) => jitter(p, amount));
    if (closed) {
      const k = Math.min(shift, pts.length - 1);
      pts = [...pts.slice(k), ...pts.slice(0, k), jitter(pts[k], amount * 0.6)];
      if (pts.length > 2) pts.push(jitter(pts[1], amount * 0.8));
    }
    return sharp ? polyline(pts, false) : smooth(pts, false);
  };
  return pass(rough, 0) + pass(rough * 1.15, closed ? 1 : 0);
}

// ---------------------------------------------------------------- outlines

export function ellipsePts(cx: number, cy: number, rx: number, ry: number, n = 22): Pt[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry] as Pt;
  });
}

export function roundRectPts(x: number, y: number, w: number, h: number, r: number): Pt[] {
  const rr = Math.min(r, w / 2, h / 2);
  const corner = (cx: number, cy: number, from: number): Pt[] =>
    [0, 0.5, 1].map((t) => {
      const a = from + t * (Math.PI / 2);
      return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr] as Pt;
    });
  return [
    ...corner(x + w - rr, y + rr, -Math.PI / 2),
    ...corner(x + w - rr, y + h - rr, 0),
    ...corner(x + rr, y + h - rr, Math.PI / 2),
    ...corner(x + rr, y + rr, Math.PI),
  ];
}

export function starPts(cx: number, cy: number, outer: number, inner: number, points = 5): Pt[] {
  return Array.from({ length: points * 2 }, (_, i) => {
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 ? inner : outer;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as Pt;
  });
}

export function regularPts(cx: number, cy: number, rx: number, ry: number, sides: number, start = -Math.PI / 2): Pt[] {
  return Array.from({ length: sides }, (_, i) => {
    const a = start + (i / sides) * Math.PI * 2;
    return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry] as Pt;
  });
}

/** The classic parametric heart, fitted to a box. */
export function heartPts(x: number, y: number, w: number, h: number, n = 28): Pt[] {
  const raw: Pt[] = Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    return [16 * Math.sin(t) ** 3, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))];
  });
  return raw.map(([px, py]) => [x + ((px + 16) / 32) * w, y + ((py + 12) / 29) * h] as Pt);
}

/** A cloud: an ellipse of scallops, each an outward arc between two anchors. */
export function cloudPts(x: number, y: number, w: number, h: number, bumps = 7): Pt[] {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const anchors = ellipsePts(cx, cy, w * 0.38, h * 0.3, bumps);
  const out: Pt[] = [];
  for (let i = 0; i < bumps; i++) {
    const a = anchors[i];
    const b = anchors[(i + 1) % bumps];
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    const half = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2;
    const out0 = Math.atan2(my - cy, mx - cx);
    for (let k = 0; k < 5; k++) {
      const t = k / 5;
      const ang = out0 - Math.PI / 2 + t * Math.PI;
      out.push([mx + Math.cos(ang) * half * 1.02, my + Math.sin(ang) * half * 1.02]);
    }
  }
  return out;
}

// ---------------------------------------------------------------- drawing

export interface Ink {
  pen: string;
  wash?: string;
  tint?: string;
}

export interface ShapeOptions {
  ink: Ink;
  fill?: 'solid' | 'hachure' | 'crosshatch' | 'none';
  /** Solid fill colour, when not the tint. */
  fillColor?: string;
  rotate?: number;
  width?: number;
  rough?: number;
  sharp?: boolean;
  seed: number;
}

let clipSerial = 0;

/** Restart clip ids, so a document generated twice is generated identically. */
export function resetSketchIds(): void {
  clipSerial = 0;
}

function centroid(points: Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p[0];
    y += p[1];
  }
  return [x / points.length, y / points.length];
}

function bounds(points: Pt[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

/** Parallel pen lines across the shape, clipped to it. */
function hachure(points: Pt[], outline: string, color: string, angleDeg: number, gap: number, rand: () => number): string {
  const id = `h${++clipSerial}`;
  const { minX, minY, maxX, maxY } = bounds(points);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const reach = Math.hypot(maxX - minX, maxY - minY) / 2 + gap;
  let lines = '';
  for (let off = -reach; off <= reach; off += gap) {
    const j = () => (rand() - 0.5) * 1.6;
    lines += `M${round(cx - reach + j())} ${round(cy + off + j())}L${round(cx + reach + j())} ${round(cy + off + j())}`;
  }
  return (
    `<clipPath id="${id}"><path d="${outline}"/></clipPath>` +
    `<g clip-path="url(#${id})"><path d="${lines}" transform="rotate(${angleDeg} ${round(cx)} ${round(cy)})" stroke="${color}" stroke-width="1.7" stroke-linecap="round" fill="none"/></g>`
  );
}

/** One sketched shape: fill, then the two-pass outline, turned about its centre. */
export function sketchShape(points: Pt[], o: ShapeOptions): string {
  const rand = seeded(o.seed);
  const outline = o.sharp ? polyline(points, true) : smooth(points, true);
  let body = '';
  const fill = o.fill ?? 'none';
  if (fill === 'solid') body += `<path d="${outline}" fill="${o.fillColor ?? o.ink.tint ?? o.ink.wash}"/>`;
  if (fill === 'hachure' || fill === 'crosshatch') {
    const wash = o.ink.wash ?? o.ink.pen;
    if (o.ink.tint) body += `<path d="${outline}" fill="${o.ink.tint}" fill-opacity="0.55"/>`;
    body += hachure(points, outline, wash, -41, 8, rand);
    if (fill === 'crosshatch') body += hachure(points, outline, wash, 49, 8, rand);
  }
  body += `<path d="${roughOutline(points, true, rand, { rough: o.rough, sharp: o.sharp })}" fill="none" stroke="${o.ink.pen}" stroke-width="${o.width ?? 2.3}" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (!o.rotate) return `<g>${body}</g>`;
  const [cx, cy] = centroid(points);
  return `<g transform="rotate(${o.rotate} ${round(cx)} ${round(cy)})">${body}</g>`;
}

/** An open pen line, traced twice. */
export function sketchLine(points: Pt[], color: string, seed: number, width = 2.3, rough = 1.2): string {
  const rand = seeded(seed);
  return `<path d="${roughOutline(points, false, rand, { rough })}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/** A line with a sketched open arrowhead at its end. */
export function sketchArrow(points: Pt[], color: string, seed: number, width = 2.3, head = 12): string {
  const end = points[points.length - 1];
  const prev = points[points.length - 2];
  const angle = Math.atan2(end[1] - prev[1], end[0] - prev[0]);
  const wing = (turn: number): Pt => [end[0] - Math.cos(angle + turn) * head, end[1] - Math.sin(angle + turn) * head];
  return (
    sketchLine(points, color, seed, width) +
    sketchLine([wing(0.5), end, wing(-0.5)], color, seed + 1, width, 0.6)
  );
}

/** The mark's four-point sparkle, as a filled path. */
export function sparkle(cx: number, cy: number, r: number, color: string): string {
  const k = 0.12 * r;
  return (
    `<path d="M${cx} ${cy - r}Q${round(cx + k)} ${round(cy - k)} ${cx + r} ${cy}Q${round(cx + k)} ${round(cy + k)} ${cx} ${cy + r}` +
    `Q${round(cx - k)} ${round(cy + k)} ${cx - r} ${cy}Q${round(cx - k)} ${round(cy - k)} ${cx} ${cy - r}Z" fill="${color}"/>`
  );
}

/**
 * The hand-drawn look, as arithmetic.
 *
 * ## The mistake this file was rewritten to fix
 *
 * The first version treated every shape as a ring of straight edges and gave
 * each edge a bow and an **overshoot** past its corner. That is right for a
 * rectangle, where the corners are real and a hand genuinely does run past
 * them — and badly wrong for a circle, which has no corners at all. Sampled at
 * sixteen points, a circle became sixteen short chords each bowed and each
 * shooting past a corner that was not there: a broken, spiky ring rather than
 * a drawn circle.
 *
 * The fix is that **corners and curves are different problems**:
 *
 *  - A shape with real corners (rectangle, polygon, star, line) is drawn edge
 *    by edge, each edge a bowed cubic that overshoots. The overshoot *is* the
 *    corner treatment — it is what makes a hand-drawn box look gone-over.
 *  - A curve (circle, ellipse) is drawn as **one continuous spline** through
 *    points scattered around the true curve, with the loop closing slightly
 *    past where it began so the ends cross. Nothing is ever lifted mid-curve.
 *
 * Both are drawn twice, which is the single most recognisable part of the
 * style: two passes that diverge and re-cross read as a pen going round again.
 *
 * The construction follows Rough.js, which is the reference implementation of
 * this look and got these constants right by iteration. Reimplemented rather
 * than depended on: the library brings a canvas/SVG drawing surface and a
 * generator API this codebase has no use for, while the part that matters is
 * the hundred lines below — and having it here means it is seeded, pure, and
 * runs in the exporter and in a test without a DOM.
 *
 * ## Why it is seeded rather than random
 *
 * A sketch regenerated from fresh randomness on every render **crawls** — the
 * outline creeps whenever anything re-renders the node, which on this canvas
 * is every selection, drag, presence update and remote edit. The seed comes
 * from the node's id, so an object is drawn the same way for its whole life
 * and the same way for everybody in the room. That is also what makes it
 * exportable: the strokes in the SVG are *the same strokes*, not another draw
 * from the same distribution.
 */

import type { Point } from './schema';

/** The three hands. */
/**
 * What is in the pencil.
 *
 * `smooth` is perfect-freehand's tapered ribbon — the stroke the tool has
 * always drawn. The others are the sketch levels, which redraw the stroke from
 * its centreline as a line gone over by hand. One union rather than a boolean
 * plus a level, because "drawn, but how much" is one question.
 */
export type PencilNib = 'smooth' | SketchLevel;

export type SketchLevel = 'light' | 'medium' | 'heavy';
export const SKETCH_LEVELS: SketchLevel[] = ['light', 'medium', 'heavy'];

/**
 * What separates the three, and why it is not one amplitude knob.
 *
 * A single "roughness" number was tried and removed, because scaling the
 * displacement is the one axis that does *not* produce three usable looks: turn
 * it up and the shape stops reading as drawn and starts reading as broken, and
 * turn it down and it is indistinguishable from off. The levels have to differ
 * in **character**, which means the three things a hand actually varies:
 *
 * - **`passes`** — how many times the pen goes round. One confident pass is a
 *   drafted line; two is the doubled, gone-over look people recognise as a
 *   sketch. This is the single biggest difference between Light and Medium and
 *   it is not an amount at all.
 * - **`bow`** — how far an edge bellies between its ends. Low is a ruler held
 *   loosely; high is a line drawn fast without one.
 * - **`overshoot`** — how far a stroke runs past its corner. This is what makes
 *   a box look gone-over rather than plotted, and it is the tell that separates
 *   Medium from Heavy far more than displacement does.
 *
 * `offset` moves least across the three, deliberately: it is the parameter that
 * degrades the shape fastest and it is doing the least work of the four.
 */
interface SketchProfile {
  passes: number;
  bow: number;
  offset: number;
  overshoot: number;
  /** Ellipse samples. Fewer points is a looser, more obviously drawn loop. */
  steps: number;
}

const PROFILES: Record<SketchLevel, SketchProfile> = {
  // One pass, barely bowed. A neat hand with a straight edge — the setting for
  // a diagram that should read as drawn without reading as informal.
  light: { passes: 1, bow: 0.6, offset: 1.0, overshoot: 0.4, steps: 12 },
  // Two passes. The Excalidraw look, and the reason this feature exists.
  medium: { passes: 2, bow: 1.1, offset: 1.6, overshoot: 1.0, steps: 9 },
  // Two passes that wander further and cross well past every corner. A marker
  // sketch: still the shape, unmistakably done by hand and in a hurry.
  heavy: { passes: 2, bow: 1.9, offset: 2.4, overshoot: 1.9, steps: 7 },
};

export function profileFor(level: SketchLevel | undefined): SketchProfile {
  return PROFILES[level ?? 'medium'] ?? PROFILES.medium;
}

/**
 * Deterministic PRNG (mulberry32).
 *
 * Small, fast, and — the only property that actually matters here — identical
 * in every browser for a given seed, so two people looking at one board see
 * one shape.
 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable 32-bit seed from a node id, so the sketch outlives a reload. */
export function seedFrom(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Trimmed to a tenth of a unit — no renderer resolves finer, and it halves the string. */
function r(n: number): string {
  return String(Math.round(n * 10) / 10);
}

type Rand = () => number;

/** A symmetric random displacement of up to `amount`. */
function jitter(amount: number, rand: Rand): number {
  return amount * (rand() - 0.5) * 2;
}

/**
 * One edge, as a hand would draw it.
 *
 * Two controls placed at a *diverge point* — a fraction of the way along,
 * randomised per stroke rather than fixed at a third and two thirds — is what
 * stops every edge bellying identically. The perpendicular displacement scales
 * with the edge's own direction, so a long edge bows more than a short one in
 * absolute terms, which is what a hand does.
 *
 * `pass` shifts the whole stroke slightly, so the second lap is a different
 * attempt at the same edge rather than a copy of the first.
 */
function edge(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rand: Rand,
  second: boolean,
  prof: SketchProfile
): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  const length = Math.sqrt(lengthSq);

  // A very short edge cannot absorb the full offset without ceasing to be the
  // edge, so the offset is capped by the length rather than applied blindly.
  let offset = prof.offset;
  if (offset * offset * 100 > lengthSq) offset = length / 10;
  const half = offset / 2;

  // How far the stroke runs past each end, along the edge's own direction.
  // This is the corner treatment — the thing that makes two edges cross past
  // their shared vertex instead of meeting on it — and it is the parameter
  // that most separates the three levels. Capped as a fraction of the edge so
  // a short run cannot overshoot further than it is long.
  const over = Math.min(prof.overshoot * 1.6, length * 0.09);
  const ux = dx / length;
  const uy = dy / length;

  // Between a fifth and two fifths along — where the pen starts to wander.
  const diverge = 0.2 + rand() * 0.2;

  // The belly, perpendicular to the run. The /200 is Rough.js's scaling and is
  // what keeps a 2000px edge from bowing twenty times as far as a 100px one.
  let midX = (prof.bow * prof.offset * dy) / 200;
  let midY = (prof.bow * prof.offset * -dx) / 200;
  midX = jitter(midX, rand) + midX;
  midY = jitter(midY, rand) + midY;

  const o = () => jitter(half, rand);
  const wander = () => (second ? o() : jitter(offset, rand));
  const start = `M ${r(x1 - ux * over + wander())} ${r(y1 - uy * over + wander())}`;

  const c1x = midX + x1 + dx * diverge + o();
  const c1y = midY + y1 + dy * diverge + o();
  const c2x = midX + x1 + 2 * dx * diverge + o();
  const c2y = midY + y1 + 2 * dy * diverge + o();
  const ex = x2 + ux * over + wander();
  const ey = y2 + uy * over + wander();

  return `${start} C ${r(c1x)} ${r(c1y)} ${r(c2x)} ${r(c2y)} ${r(ex)} ${r(ey)}`;
}

/**
 * A run of points as a sketched polyline, drawn twice.
 *
 * For shapes whose corners are real. Each edge is its own subpath: the strokes
 * deliberately do not meet, and welding them into one contour would both lose
 * that and make the result fillable, which is not what this is.
 */
export function roughPolyline(
  points: readonly Point[],
  options: { seed: number; closed?: boolean; level?: SketchLevel }
): string {
  const { seed, closed = true, level } = options;
  if (points.length < 2) return '';
  const prof = profileFor(level);
  const rand = rng(seed);
  const out: string[] = [];
  const count = closed ? points.length : points.length - 1;

  // Pass-major: one whole lap, then another. Alternating per edge would pair
  // each stroke with its own second attempt and lose the sense of a continuous
  // hand travelling the outline.
  for (let pass = 0; pass < prof.passes; pass++) {
    for (let i = 0; i < count; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      out.push(edge(a.x, a.y, b.x, b.y, rand, pass === 1, prof));
    }
  }
  return out.join(' ');
}

/**
 * A closed spline through a list of points, as cubics.
 *
 * Catmull-Rom, converted to Bezier by the standard construction: the control
 * points either side of a span are a sixth of the vector between that span's
 * outer neighbours. This is what makes the curve pass *through* every sample
 * rather than being pulled away from them, which matters because the samples
 * are the scattered points and the scatter is the whole effect.
 */
function spline(points: readonly Point[]): string {
  const n = points.length;
  if (n < 3) return '';
  const at = (i: number) => points[(i + n) % n];
  let d = `M ${r(points[0].x)} ${r(points[0].y)}`;
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${r(c1x)} ${r(c1y)} ${r(c2x)} ${r(c2y)} ${r(p2.x)} ${r(p2.y)}`;
  }
  return d;
}

/**
 * A circle or an ellipse, drawn by hand.
 *
 * ## Why this is four lines and not forty
 *
 * It used to have a construction of its own: `prof.steps` samples around the
 * ellipse — **seven** of them at Heavy — each displaced by an independent
 * random amount in x and y, splined together. Both halves of that were wrong,
 * and `roughLoop` already had both right for hearts and curved lines.
 *
 * The sample count fell as the roughness rose, so a heavier hand did not draw a
 * rougher circle, it drew a *lower-resolution* one: seven control points is a
 * blobby heptagon-ish spline, not a hurried circle. Density decides how
 * faithfully the lap follows the true curve and amplitude decides how far the
 * pen wanders — conflating them is the single reason curves looked worse than
 * corners, where the two were always separate.
 *
 * And the displacement was in x and y, which on a curve is mostly *tangential*:
 * it slides samples along the outline, bunching and stretching them, rather
 * than varying the radius. A hand-drawn circle is out of round — the radius
 * drifts — it is not unevenly paced. `roughLoop` drifts along the normal with a
 * low-pass filtered offset, which is what "a hand does not shake, it drifts"
 * means in arithmetic.
 *
 * So an ellipse is now a loop like any other closed curve, and the two are
 * drawn by one function. A circle and a heart on the same board are made of the
 * same marks, which they visibly were not before.
 */
export function roughEllipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  options: { seed: number; level?: SketchLevel }
): string {
  /**
   * Forty-eight samples of the true ellipse, handed to the loop sketcher.
   *
   * The ring is the *input outline*, not the drawing: `roughLoop` re-samples it
   * by arc length at a density it chooses from the shape's size, so this only
   * has to be fine enough that the polygon it walks is indistinguishable from
   * the curve. It is the same ring the hachure fills against, which is why the
   * shading and the outline agree about where the edge is.
   */
  return roughLoop(ellipseRing(cx, cy, rx, ry), { ...options, closed: true });
}

/**
 * A closed curve of any shape, drawn as a wandering loop.
 *
 * ## Why a curve cannot go through `roughPolyline`
 *
 * That function treats every vertex as a corner and overshoots past it, which
 * is exactly right for a rectangle or a hexagon where the corners are real. A
 * curve arrives here already flattened into a hundred-odd tiny segments, none
 * of which is a corner — so it overshot a hundred times, and a heart came out
 * bristling. Same reason `roughEllipse` exists rather than sketching a
 * hundred-sided polygon.
 *
 * This is `roughEllipse` generalised: sample the outline evenly *by arc
 * length*, jitter the samples, run past the start, and spline through them.
 * Evenly by arc length rather than by index is what keeps the wobble the same
 * size everywhere — a flattener puts its points close together on tight
 * curvature and far apart on straights, so sampling by index would make the
 * lobes of a heart shake and its long sides lie still.
 */
export function roughLoop(
  outline: readonly Point[],
  options: { seed: number; level?: SketchLevel; closed?: boolean }
): string {
  const closed = options.closed !== false;
  if (outline.length < (closed ? 3 : 2)) return '';
  const prof = profileFor(options.level);
  const rand = rng(options.seed);

  // Cumulative arc length around the closed loop, so a position can be asked
  // for as a distance rather than as an index.
  const n = outline.length;
  // A closed run has one more segment than it has points — the one that gets
  // back to the start. An open one does not, and walking off the end of it is
  // how a hand-drawn line would acquire a stroke back to where it began.
  const spans = closed ? n : n - 1;
  const cum: number[] = [0];
  for (let i = 1; i <= spans; i += 1) {
    const a = outline[i - 1];
    const b = outline[i % n];
    cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = cum[spans];
  if (total === 0) return '';

  const at = (distance: number): Point => {
    // Clamped on an open run, wrapped on a closed one: running past the end of
    // a line has to stop at the end, not reappear at its beginning.
    let d = closed ? distance % total : Math.max(0, Math.min(total, distance));
    if (d < 0) d += total;
    // Linear scan is fine: this runs once per sample per pass, a few dozen
    // times, and a binary search here would be more code than it saves.
    let i = 1;
    while (i <= spans && cum[i] < d) i += 1;
    const a = outline[(i - 1) % n];
    const b = outline[i % n];
    const span = cum[i] - cum[i - 1];
    const t = span === 0 ? 0 : (d - cum[i - 1]) / span;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };

  // The centroid, so each pass can breathe in and out around the shape the way
  // `roughEllipse` varies its radii.
  let cx = 0;
  let cy = 0;
  for (const p of outline) {
    cx += p.x;
    cy += p.y;
  }
  cx /= n;
  cy /= n;
  // An open run has no interior to breathe in and out of, so the swell is
  // suppressed rather than pulling the line toward an arbitrary centroid.
  const swellable = closed;

  /**
   * How many samples the loop is drawn from.
   *
   * `prof.steps` is a *per-edge* count in the polyline sketcher, so it is far
   * too few for a whole outline. Scaling with the shape's size keeps the
   * wobble at a consistent physical wavelength — a large heart gets more
   * samples rather than the same number stretched into long, mechanical bows.
   */
  /**
   * Sample density and wobble amplitude are independent, and conflating them
   * is what made the first version of this both squiggly *and* a poor heart.
   *
   * Density decides how faithfully the lap follows the true outline: too few
   * samples and the spline cuts across the cusp between the lobes and rounds
   * off the tip, so the shape stops being a heart before it starts looking
   * hand-drawn. Amplitude decides how far the pen wanders, and is `prof.offset`
   * alone. Sampling generously and letting the drift below do the smoothing
   * gives a line that is both faithful and calm — which is what a confident
   * hand-drawn heart is.
   */
  const samples = Math.max(20, Math.min(80, Math.round(total / 22)));
  const step = total / samples;

  /**
   * A drifting offset rather than an independent one per sample.
   *
   * Jittering each sample on its own is white noise: every point pulls a fresh
   * random number, so the line changes direction at every control point and the
   * result is a *shaky* line — which is what a heart came out as. A hand does
   * not shake; it drifts. Its errors are slow and correlated, so the stroke
   * wanders wide of the true curve for a while and then comes back.
   *
   * One pole of low-pass filtering gives exactly that: each offset is mostly
   * the previous one with a little new noise mixed in. The wobble keeps its
   * amplitude and loses its frequency, which is the whole difference between
   * "drawn by hand" and "drawn by someone nervous".
   */
  /**
   * How far the pen wanders before it comes back, in world units.
   *
   * The retention is derived from it rather than being a fixed number, so the
   * wobble keeps the same physical wavelength however densely the outline is
   * sampled. A constant retention would tie the wavelength to the sample
   * count, and raising the density to make the shape faithful — which is
   * exactly what the note above does — would silently make the line shakier.
   */
  const WANDER = 58;
  const retention = Math.exp(-step / WANDER);
  const drift = (previous: number, amount: number): number =>
    previous * retention + jitter(amount, rand) * (1 - retention) * 2.4;

  const laps: string[] = [];
  for (let pass = 0; pass < prof.passes; pass += 1) {
    // A whole-shape swell, from the centroid, so the second pass is a slightly
    // different heart rather than the same one traced twice.
    const swell = swellable ? 1 + jitter(0.008, rand) : 1;
    // A lap of a closed shape can start anywhere; an open run starts at its
    // start, because that is where the pen was put down.
    const from = closed ? rand() * total : 0;
    const overlap = step * (0.25 + prof.overshoot * 0.4) * (0.7 + rand() * 0.6);

    const pts: Point[] = [];
    // Seeded from the same noise the drift is made of, so a lap does not
    // always begin exactly on the true curve.
    let ox = jitter(prof.offset, rand);
    let oy = jitter(prof.offset, rand);
    const place = (distance: number, pull: number) => {
      const p = at(distance);
      const sx = cx + (p.x - cx) * swell * pull;
      const sy = cy + (p.y - cy) * swell * pull;
      ox = drift(ox, prof.offset);
      oy = drift(oy, prof.offset);
      pts.push({ x: sx + ox, y: sy + oy });
    };

    for (let i = 0; i < samples; i += 1) place(from + i * step, 1);
    if (closed) {
      // Past its own beginning, then pulled very slightly inward, so the
      // crossing reads as a hand closing a loop rather than as a bulge.
      place(from + total + overlap * 0.5, 1);
      place(from + overlap, 0.98);
    } else {
      // An open run ends *on* its end. Overshooting a connector would push its
      // line out past the arrowhead it is supposed to stop under.
      place(total, 1);
    }

    laps.push(splineOpen(pts));
  }
  return laps.join(' ');
}

/** The spline above, left open — an ellipse's lap must not snap shut. */
function splineOpen(points: readonly Point[]): string {
  const n = points.length;
  if (n < 3) return '';
  const at = (i: number) => points[Math.max(0, Math.min(n - 1, i))];
  let d = `M ${r(points[0].x)} ${r(points[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    d +=
      ` C ${r(p1.x + (p2.x - p0.x) / 6)} ${r(p1.y + (p2.y - p0.y) / 6)}` +
      ` ${r(p2.x - (p3.x - p1.x) / 6)} ${r(p2.y - (p3.y - p1.y) / 6)}` +
      ` ${r(p2.x)} ${r(p2.y)}`;
  }
  return d;
}

/** Exported for the hachure, which fills against a smooth ring rather than the sketch. */
export { spline as closedSpline };

/**
 * Hachure fill — parallel strokes at an angle, the way a pen shades.
 *
 * A flat fill under a sketched outline looks printed, which fights everything
 * the outline is doing.
 *
 * Scanline against the polygon: for each line across the shape at the hachure
 * angle, find where it crosses the edges and stroke between crossing pairs.
 * Sorting the crossings and taking them two at a time is what makes it correct
 * for a concave shape — a star is the case that fails if you assume two
 * crossings per line.
 *
 * Each stroke is drawn as a bowed edge rather than a straight run, so the
 * shading is made of the same marks as the outline.
 */
function hachurePass(
  points: readonly Point[],
  options: { seed: number; gap: number; angle: number; level?: SketchLevel }
): string {
  const { seed, gap, angle, level } = options;
  if (points.length < 3) return '';

  const prof = profileFor(level);
  const rand = rng(seed ^ 0x9e3779b9);
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(-rad);
  const sin = Math.sin(-rad);
  // Work in a frame where the hachure runs horizontally, then rotate back.
  const rot = points.map((p) => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }));
  const minY = Math.min(...rot.map((p) => p.y));
  const maxY = Math.max(...rot.map((p) => p.y));

  const strokes: string[] = [];
  const back = (x: number, y: number) => ({ x: x * cos + y * sin, y: -x * sin + y * cos });

  for (let y = minY + gap / 2; y < maxY; y += gap) {
    const crossings: number[] = [];
    for (let i = 0; i < rot.length; i++) {
      const a = rot[i];
      const b = rot[(i + 1) % rot.length];
      // Half-open test, so a vertex exactly on the scanline is counted once
      // rather than opening and closing the same span.
      if (a.y <= y === b.y <= y) continue;
      crossings.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    crossings.sort((p, q) => p - q);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      // Pulled in at both ends, unevenly, so the shading does not end on a
      // ruled edge where the outline is deliberately loose.
      const s = back(crossings[i] + Math.abs(jitter(2, rand)), y + jitter(1, rand));
      const e = back(crossings[i + 1] - Math.abs(jitter(2, rand)), y + jitter(1, rand));
      strokes.push(edge(s.x, s.y, e.x, e.y, rand, false, prof));
    }
  }
  return strokes.join(' ');
}

/**
 * Zigzag / scribble fill — continuous back-and-forth pen strokes connecting at edges.
 */
function zigzagPass(
  points: readonly Point[],
  options: { seed: number; gap: number; angle: number; level?: SketchLevel }
): string {
  const { seed, gap, angle, level } = options;
  if (points.length < 3) return '';

  const prof = profileFor(level);
  const rand = rng(seed ^ 0x9e3779b9);
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(-rad);
  const sin = Math.sin(-rad);
  const rot = points.map((p) => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }));
  const minY = Math.min(...rot.map((p) => p.y));
  const maxY = Math.max(...rot.map((p) => p.y));

  const strokes: string[] = [];
  const back = (x: number, y: number) => ({ x: x * cos + y * sin, y: -x * sin + y * cos });

  let prevPoint: Point | null = null;
  let forward = true;

  for (let y = minY + gap / 2; y < maxY; y += gap) {
    const crossings: number[] = [];
    for (let i = 0; i < rot.length; i++) {
      const a = rot[i];
      const b = rot[(i + 1) % rot.length];
      if (a.y <= y === b.y <= y) continue;
      crossings.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    crossings.sort((p, q) => p - q);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const left = back(crossings[i] + Math.abs(jitter(2, rand)), y + jitter(1, rand));
      const right = back(crossings[i + 1] - Math.abs(jitter(2, rand)), y + jitter(1, rand));
      const s = forward ? left : right;
      const e = forward ? right : left;

      if (prevPoint) {
        // Connecting loop stroke between previous scanline and this one
        strokes.push(edge(prevPoint.x, prevPoint.y, s.x, s.y, rand, false, prof));
      }
      strokes.push(edge(s.x, s.y, e.x, e.y, rand, false, prof));
      prevPoint = e;
      forward = !forward;
    }
  }
  return strokes.join(' ');
}

/**
 * Dots / stippling fill — organic hand-stippled dot clusters inside the shape.
 *
 * Performance-tuned: uses adaptive spacing and minimal stroked dot endpoints
 * (`M x y l 0.01 0` with round caps) so rendering across zoom frames is instant
 * in GPU Canvas2D rather than parsing thousands of heavy SVG arcs.
 */
function dotsPass(
  points: readonly Point[],
  options: { seed: number; gap: number; angle: number; level?: SketchLevel }
): string {
  const { seed, angle, level, gap } = options;
  if (points.length < 3) return '';

  const rand = rng(seed ^ 0x9e3779b9);
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(-rad);
  const sin = Math.sin(-rad);
  const rot = points.map((p) => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }));
  const minY = Math.min(...rot.map((p) => p.y));
  const maxY = Math.max(...rot.map((p) => p.y));
  const minX = Math.min(...rot.map((p) => p.x));
  const maxX = Math.max(...rot.map((p) => p.x));

  /**
   * The spacing, from the gap it was handed — and adapted, not overridden.
   *
   * This used to compute its own step from the shape's diagonal and *discard*
   * the `gap` parameter entirely, which made stipple the one shading style with
   * no density: the control was offered on four styles and worked on three, and
   * on the fourth it was the one style whose whole language is density. Nothing
   * about a dot pattern argues for that.
   *
   * The adaptive part is kept, because it is doing real work: a very large
   * shape at a fixed spacing is thousands of dots, and this is drawn as a path
   * every frame. So the gap sets the intent and the diagonal sets a floor
   * beneath it, rather than replacing it.
   */
  const diag = Math.hypot(maxX - minX, maxY - minY);
  const nib = level === 'heavy' ? 1.35 : level === 'light' ? 2 : 1.65;
  const step = Math.max(gap * nib, Math.min(40, diag / 16));

  const paths: string[] = [];
  const back = (x: number, y: number) => ({ x: x * cos + y * sin, y: -x * sin + y * cos });

  for (let y = minY + step * 0.6; y < maxY - step * 0.2; y += step) {
    const crossings: number[] = [];
    for (let i = 0; i < rot.length; i++) {
      const a = rot[i];
      const b = rot[(i + 1) % rot.length];
      if (a.y <= y === b.y <= y) continue;
      crossings.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    crossings.sort((p, q) => p - q);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const xStart = crossings[i] + step * 0.4;
      const xEnd = crossings[i + 1] - step * 0.4;
      for (let x = xStart; x < xEnd; x += step) {
        const jx = jitter(step * 0.3, rand);
        const jy = jitter(step * 0.3, rand);
        const p = back(x + jx, y + jy);
        paths.push(`M ${r(p.x)} ${r(p.y)} l 0.01 0`);
      }
    }
  }
  return paths.join(' ');
}

/** A rectangle as a ring, so the polyline sketcher covers it. */
export function rectRing(width: number, height: number): Point[] {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
}

/**
 * An ellipse as a ring, for the hachure only.
 *
 * The *outline* never goes through this — it uses `roughEllipse`, which is a
 * continuous curve. This is the smooth silhouette the shading is clipped
 * against, and it is sampled finely because a coarse ring would leave the
 * hachure ending short of the drawn edge.
 */
export function ellipseRing(cx: number, cy: number, rx: number, ry: number, steps = 48): Point[] {
  const ring: Point[] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    ring.push({ x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry });
  }
  return ring;
}

/**
 * How a sketched shape's interior is shaded.
 *
 * `solid` is the ordinary fill — a flat colour under a drawn outline.
 * `hachure` is parallel pen strokes.
 * `crosshatch` lays a second set across it at a right angle for a denser tone.
 * `zigzag` is continuous back-and-forth pencil shading.
 * `dots` is organic stippling.
 */
export type FillStyle = 'solid' | 'hachure' | 'crosshatch' | 'zigzag' | 'dots';
export const FILL_STYLES: FillStyle[] = ['solid', 'hachure', 'crosshatch', 'zigzag', 'dots'];

/**
 * The default hachure angle.
 *
 * Off the diagonal on purpose. A shading angle of exactly 45° lines up with
 * the corners of every rectangle on the board, so the strokes appear to run
 * into the corners and the eye reads them as part of the shape rather than as
 * shading laid over it. Forty-one degrees is close enough to look natural and
 * far enough to stay separate.
 */
export const HACHURE_ANGLE = -41;

/** The gap between strokes at the middle density, in world units. */
const HACHURE_GAP = 9;

/**
 * How close the strokes are laid, which is how pen shading says *tone*.
 *
 * ## Why this had to become a control
 *
 * The gap was one constant, so every hachured shape on a board carried exactly
 * the same weight of grey. That is the one thing pen shading is *for*: a
 * drawing distinguishes a light surface from a dark one by how densely it is
 * hatched, and with a fixed gap the style could draw the texture and not the
 * value. Two shapes that ought to read as foreground and background read as
 * the same material.
 *
 * Three steps rather than a slider, for the reason the sketch levels are three:
 * the useful range is narrow — below about four units the strokes merge into a
 * flat tone and the drawn quality is lost, above about sixteen they read as
 * stripes rather than shading — and a continuous control over that range mostly
 * offers ways to get it wrong.
 */
export type ShadingDensity = 'light' | 'medium' | 'dense';
export const SHADING_DENSITIES: ShadingDensity[] = ['light', 'medium', 'dense'];

const DENSITY_GAP: Record<ShadingDensity, number> = {
  light: 14,
  medium: HACHURE_GAP,
  dense: 5.5,
};

export function gapFor(density: ShadingDensity | undefined): number {
  return DENSITY_GAP[density ?? 'medium'] ?? HACHURE_GAP;
}

/**
 * Pen shading for a shape's interior.
 *
 * `angle` overrides the shared default, which every shape used to share
 * without exception — so two hachured shapes laid over each other shaded in
 * lockstep and the pair read as one continuous field rather than two objects.
 * Turning one of them is how a drawing separates them, and it is the same
 * thing a hand does without thinking about it.
 */
export function shapeFill(
  points: readonly Point[],
  options: {
    seed: number;
    style: FillStyle;
    level?: SketchLevel;
    density?: ShadingDensity;
    angle?: number;
  }
): string {
  const { seed, style, level, density } = options;
  if (style === 'solid') return '';

  const gap = gapFor(density);
  const angle = Number.isFinite(options.angle) ? (options.angle as number) : HACHURE_ANGLE;

  if (style === 'zigzag') {
    return zigzagPass(points, { seed, gap: gap * 1.2, angle, level });
  }

  if (style === 'dots') {
    return dotsPass(points, { seed, gap: gap * 1.3, angle, level });
  }

  const first = hachurePass(points, { seed, gap, angle, level });
  if (style === 'hachure') return first;

  /**
   * The second pass is not exactly perpendicular, and not exactly the same gap.
   *
   * Both are deliberate: a true right angle at an even spacing produces graph
   * paper, which is a printed texture rather than a drawn one. Fifteen per cent
   * wider and a right angle off a line that is already off the diagonal keeps
   * the crossings irregular.
   */
  const second = hachurePass(points, {
    seed: seed ^ 0x5bf03635,
    gap: gap * 1.15,
    angle: angle + 90,
    level,
  });
  return `${first} ${second}`;
}

/**
 * The shape's silhouette, as a hand would enclose it — one closed wobbly path.
 *
 * ## Why a solid fill needs its own outline
 *
 * A sketched shape with a solid fill was drawn as the **true** ring: a
 * geometrically perfect rectangle in flat colour, with the drawn strokes laid
 * over it. The crisp filled edge won completely. From any normal distance the
 * shape read as a plain rectangle that happened to have a slightly furry
 * outline, and the whole effect disappeared — which is exactly what "I can't
 * see the sketch" means. The hachure styles never showed it because they have
 * no solid region to give the game away.
 *
 * So the fill gets a sketched boundary too. It is **not** the outline path:
 * that one is deliberately made of disjoint, overshooting strokes, and filling
 * those leaves bites out of the shape wherever two failed to meet. This is a
 * single continuous contour — each vertex displaced once and *shared* by the
 * two edges that meet there, so the path closes exactly — with the same bowing
 * along each edge. One pass, because a fill has no second pass.
 */
export function roughSilhouette(
  points: readonly Point[],
  options: { seed: number; level?: SketchLevel }
): string {
  const { seed, level } = options;
  if (points.length < 3) return '';
  const prof = profileFor(level);
  // A different stream from the outline's, so the fill boundary and the drawn
  // edge wander independently — which is what a real pen and a real wash do.
  const rand = rng(seed ^ 0x2545f491);

  // Displace every vertex once. Shared by both adjacent edges, which is the
  // property that makes the contour closed rather than merely nearly closed.
  const moved = points.map((p) => ({
    x: p.x + jitter(prof.offset * 0.8, rand),
    y: p.y + jitter(prof.offset * 0.8, rand),
  }));

  let d = `M ${r(moved[0].x)} ${r(moved[0].y)}`;
  for (let i = 0; i < moved.length; i++) {
    const a = moved[i];
    const b = moved[(i + 1) % moved.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    // The same perpendicular belly the outline uses, at the same scaling, so a
    // fill and the stroke over it bow the same way rather than crossing.
    const bowX = (prof.bow * prof.offset * dy) / 220 + jitter(prof.offset * 0.5, rand);
    const bowY = (prof.bow * prof.offset * -dx) / 220 + jitter(prof.offset * 0.5, rand);
    const c1x = a.x + dx / 3 + bowX;
    const c1y = a.y + dy / 3 + bowY;
    const c2x = a.x + (dx * 2) / 3 + bowX;
    const c2y = a.y + (dy * 2) / 3 + bowY;
    d += ` C ${r(c1x)} ${r(c1y)} ${r(c2x)} ${r(c2y)} ${r(b.x)} ${r(b.y)}`;
  }
  return d + ' Z';
}

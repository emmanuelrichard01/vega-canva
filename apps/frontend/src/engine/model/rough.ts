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
 * How far a pen of a given width wanders, relative to a fine one.
 *
 * ## The ratio, not the amount
 *
 * Every displacement in this file was in world units and blind to the stroke
 * it was about to be drawn with — so the *visible* roughness was the wander
 * divided by the stroke width, and only the numerator was ever tuned. At two
 * pixels a medium hand strays about one and a half, which reads; at eight the
 * same stroke covers its own wander and a sketched shape is a clean shape with
 * a slightly furry edge. The two gone-over passes suffered worst: separated by
 * less than a nib width, they merge into one thicker line and the doubling —
 * the single most recognisable thing about a hand-drawn shape — disappears.
 *
 * A real pen behaves the way this describes: a broad marker held loosely
 * strays further than a fineliner, because the hand's error and the tool's
 * scale go together. So the wander is proportional to the nib.
 *
 * Two limits, both from looking at it. Below the reference width the wander is
 * *not* reduced — a hairline outline should still be visibly drawn, and a
 * proportional rule would make a 0.5px stroke perfectly smooth. Above three
 * times it stops growing: a 24px marker straying 30 units is not a confident
 * hand, it is a different shape, and past that point the drawing's silhouette
 * is what is being damaged rather than its edge quality.
 *
 * The scale is not part of the seed. A stroke width change rescales the same
 * wander rather than redrawing a different one, so dragging the width slider
 * thickens the line the user drew instead of animating a new sketch.
 */
const NIB_REFERENCE = 2;
const NIB_MAX = 3;

export function nibScale(width: number | undefined): number {
  if (!Number.isFinite(width) || width === undefined) return 1;
  return Math.max(1, Math.min(NIB_MAX, width / NIB_REFERENCE));
}

/**
 * The profile for `level`, with its displacements scaled to the pen's width.
 *
 * `bow` is divided back out, and that is not a fudge. The belly of an edge is
 * `bow × offset × length / 200` — so scaling `offset` for a wide pen scaled the
 * belly with it, and at eight pixels a rectangle's bottom edge sagged into a
 * visible arc. That is the shape being damaged, not the edge quality: how far
 * an edge departs from straight is fidelity, and how far the pen strays from
 * where it meant to be is character. This file has had to separate those before
 * — for the ellipse's sample count, and for the drift's frequency — and this is
 * the same mistake in a new place. Keeping the product invariant means a wide
 * pen wanders further at the ends and bellies exactly as much in the middle.
 */
function penFor(level: SketchLevel | undefined, width: number | undefined): SketchProfile {
  const prof = profileFor(level);
  const nib = nibScale(width);
  return nib === 1 ? prof : { ...prof, offset: prof.offset * nib, bow: prof.bow / nib };
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

/**
 * The seed for one shape's drawing, given its id and which variant was asked
 * for.
 *
 * Mixed rather than replaced. Using the variant alone would make every shape
 * redrawn `n` times draw *identically*, so redrawing a selection of six
 * rectangles would turn them into six copies of one rectangle — which is the
 * opposite of what a hand-drawn effect is for. Folding it into the id's hash
 * keeps each shape's own identity in the result.
 *
 * Variant 0 and absent both mean "the original", so nothing that was drawn
 * before this existed changes.
 */
export function seedFor(id: string, variant?: number): number {
  const base = seedFrom(id);
  if (!variant) return base;
  // The same FNV step the hash above uses, applied once more with the variant
  // folded in — so the variants of one shape are as unrelated to each other as
  // two different ids are.
  return Math.imul(base ^ (variant >>> 0), 16777619) >>> 0;
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
  /**
   * The belly, perpendicular to the run, leaning the *other* way on the second
   * pass.
   *
   * Same reason `roughLoop` alternates its lean: the two attempts at one edge
   * were both bowed in the base direction and jittered independently, so how
   * far apart they ended up was luck, and often they ended up nowhere apart.
   * Flipping the second one makes the pair cross in the middle and part
   * towards the ends, which is what two goes at the same line look like.
   */
  const side = second ? -1 : 1;
  let midX = (side * prof.bow * prof.offset * dy) / 200;
  let midY = (side * prof.bow * prof.offset * -dx) / 200;
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
 *
 * `asCurve` is for a run that is a flattened curve (a spline, an arc, a plot of
 * a function): drawn edge by edge that comes out as a row of short dashes, so
 * it is handed to `roughLoop` as one continuous stroke. The caller says so;
 * nothing here guesses, because a dense data line looks like a curve and must
 * keep every vertex.
 *
 * `passes` caps the laps. A dashed stroke takes one, because two laps with
 * independent dash phases fill each other's gaps.
 */
export function roughPolyline(
  points: readonly Point[],
  options: { seed: number; closed?: boolean; level?: SketchLevel; width?: number; asCurve?: boolean; passes?: number }
): string {
  const { seed, closed = true, level, width, asCurve, passes } = options;
  if (points.length < 2) return '';
  if (asCurve) return roughLoop(points, { seed, closed, level, width, passes });
  const base = penFor(level, width);
  const prof = passes ? { ...base, passes: Math.max(1, Math.min(base.passes, passes)) } : base;
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
 * drifts — it is not unevenly paced. `roughLoop` displaces along the normal by a
 * few slow, seeded waves, which is what "a hand does not shake, it drifts"
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
  options: { seed: number; level?: SketchLevel; width?: number; passes?: number }
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
  // A thin ellipse needs more samples, or its tips flatten into false corners.
  const ratio = Math.max(rx, ry) / Math.max(Math.min(rx, ry), 1e-6);
  const steps = Math.min(384, 48 * Math.max(1, Math.ceil(Math.sqrt(ratio))));
  return roughLoop(ellipseRing(cx, cy, rx, ry, steps), { ...options, closed: true });
}

/**
 * A closed curve of any shape, drawn as a wandering loop.
 *
 * A curve arrives here flattened into many short segments, none of which is a
 * corner, so it cannot go through the edge-by-edge sketcher, which overshoots
 * every vertex. Instead the outline is resampled by arc length, each sample is
 * pushed along the outline's normal by a smooth offset, and one continuous
 * spline is drawn through the result per pass.
 *
 * ## The offset
 *
 * Each pass's offset is two low harmonics with seeded phases, weighted toward
 * the slowest, so a lap wanders wide two or three times and comes back with
 * no shake and no S-bends along a straight side, at any size. A very short run
 * uses only the slowest.
 * On a closed loop the harmonics are whole cycles per lap, so a lap meets its
 * own start exactly.
 *
 * The wander is capped by the outline's local radius of curvature, so a tight
 * end or a small ring stays round instead of wobbling out of shape, and the
 * cap is smoothed along the run so it never steps.
 *
 * ## Sampling
 *
 * Samples are evenly spaced by arc length, and an interval over which the
 * outline turns more than 25° is subdivided, so a capsule's ends and a thin
 * ellipse's tips are followed rather than cut across.
 *
 * Real corners (a turn over 55°) are placed twice, so the spline arrives along
 * one direction and leaves along the other. A closed outline with corners
 * starts and ends its lap *at* one of them, which is where a hand puts the pen
 * down on a heart or a cloud; the run past the start continues into the next
 * edge rather than curling at the cusp. A closed outline without corners starts
 * anywhere, landing just beside the line and lifting off a little past it.
 *
 * An open run tapers its offset to zero at both ends, so a connector still
 * starts and ends exactly on its anchors.
 */
export function roughLoop(
  outline: readonly Point[],
  options: { seed: number; level?: SketchLevel; closed?: boolean; width?: number; passes?: number }
): string {
  const closed = options.closed !== false;
  if (outline.length < (closed ? 3 : 2)) return '';
  const prof = penFor(options.level, options.width);
  const passes = Math.max(1, Math.min(prof.passes, options.passes ?? prof.passes));
  const rand = rng(options.seed);

  const n = outline.length;
  const spans = closed ? n : n - 1;
  const cum: number[] = [0];
  for (let i = 1; i <= spans; i += 1) {
    const a = outline[i - 1];
    const b = outline[i % n];
    cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = cum[spans];
  if (!(total > 0)) return '';

  const { corners, turnAt, turnTotal } = turningOf(outline, closed, cum);

  /** Segment index containing arc length `d`, which lies in [0, total]. */
  const segmentAt = (d: number): number => {
    let lo = 1;
    let hi = spans;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < d) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const normalOf = (i: number): { nx: number; ny: number } => {
    const a = outline[(i - 1 + n) % n];
    const b = outline[i % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { nx: -(b.y - a.y) / len, ny: (b.x - a.x) / len };
  };
  const wrap = (distance: number): number => {
    if (!closed) return Math.max(0, Math.min(total, distance));
    const d = distance % total;
    return d < 0 ? d + total : d;
  };
  /** Turning accumulated from the start of the run up to an unwrapped distance. */
  const turnUpTo = (distance: number): number => {
    if (!closed) return turnAt(Math.max(0, Math.min(total, distance)));
    const laps = Math.floor(distance / total);
    return laps * turnTotal + turnAt(distance - laps * total);
  };

  /** A point on the outline with its unit normal. */
  const at = (distance: number): Point & { nx: number; ny: number } => {
    const d = wrap(distance);
    const i = segmentAt(d);
    const a = outline[(i - 1) % n];
    const b = outline[i % n];
    const span = cum[i] - cum[i - 1];
    const t = span === 0 ? 0 : (d - cum[i - 1]) / span;
    const { nx, ny } = normalOf(i);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, nx, ny };
  };
  /** A corner vertex, pushed along the bisector of its two edges. */
  const atCorner = (index: number): Point & { nx: number; ny: number } => {
    const into = normalOf(index === 0 && closed ? spans : index);
    const out = normalOf(closed ? (index % spans) + 1 : Math.min(spans, index + 1));
    const sx = into.nx + out.nx;
    const sy = into.ny + out.ny;
    const sl = Math.hypot(sx, sy);
    // Scaled so offset strokes stay parallel to both edges through the turn,
    // capped so a hairpin does not throw the point far out.
    const scale = sl > 1e-6 ? Math.min(2, 2 / sl) / sl : 0;
    return { ...outline[index % n], nx: sx * scale, ny: sy * scale };
  };

  let cx = 0;
  let cy = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of outline) {
    cx += p.x;
    cy += p.y;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  cx /= n;
  cy /= n;
  // A closed shape's thinner side; an open run has no thickness to protect.
  const thickness = closed ? Math.min(maxX - minX, maxY - minY) : Infinity;

  /** Even spacing; density follows size, never the sketch level. */
  const samples = Math.max(20, Math.min(80, Math.round(total / 22)));
  const step = total / samples;

  /**
   * How far the pen strays (RMS), capped by the run and by the shape's
   * thickness so small and thin shapes are drawn with a steadier hand.
   */
  const amplitude = Math.min(prof.offset * 0.55, total / 90, thickness * 0.05);
  /** How far apart two laps sit on average, so the second is visible. */
  const separation = Math.min(4, Math.max(0.5, options.width ?? NIB_REFERENCE) * 0.5);

  /** Bows per lap: whole cycles on a loop; fewer on a short run. */
  const harmonics: number[] = closed
    ? total < 150 ? [2] : [2, 3]
    : (() => {
        const base = Math.max(0.6, Math.min(3, total / 240));
        return total < 150 ? [base] : [base, base * 1.7];
      })();

  /** A smooth seeded wave of unit RMS along the run. */
  const wave = (): ((d: number) => number) => {
    const terms = harmonics.map((k) => ({
      k,
      amp: (0.6 + rand() * 0.8) / (k * k),
      phase: rand() * Math.PI * 2,
    }));
    const rms = Math.sqrt(terms.reduce((sum, term) => sum + (term.amp * term.amp) / 2, 0)) || 1;
    return (d: number) => {
      let v = 0;
      for (const term of terms) v += term.amp * Math.sin((2 * Math.PI * term.k * d) / total + term.phase);
      return v / rms;
    };
  };

  /** Local radius of curvature around an unwrapped distance. */
  const window = Math.max(step, (2 * total) / spans);
  const radiusAt = (distance: number): number => {
    const turned = turnUpTo(distance + window / 2) - turnUpTo(distance - window / 2);
    return turned > 1e-6 ? window / turned : Infinity;
  };

  const ramp = Math.min(total / 2, 36);
  const smoothstep = (x: number) => {
    const t = Math.max(0, Math.min(1, x));
    return t * t * (3 - 2 * t);
  };
  const envelope = (s: number) => (closed ? 1 : smoothstep(s / ramp) * smoothstep((total - s) / ramp));

  const tailBase = Math.max(6, Math.min(30, total * 0.03));
  const tail = closed ? tailBase * (0.5 + 0.3 * prof.overshoot) : 0;
  // Stops across a seam, counted from the shape alone so every level samples a
  // lap equally densely; the level only changes how long the seam is.
  const seamStops = Math.max(2, Math.ceil(tailBase / Math.max(step / 2, 1)));
  const kickBase = (0.6 + 0.5 * prof.overshoot) * Math.max(separation, amplitude);
  const STOP_BUDGET = 200;
  const SUBDIVIDE = (25 * Math.PI) / 180;
  const PIECE = (12 * Math.PI) / 180;

  const laps: string[] = [];
  for (let pass = 0; pass < passes; pass += 1) {
    const offset = wave();
    const swell = closed ? 1 + jitter(0.006, rand) : 1;
    const bias = passes > 1 ? (pass % 2 === 0 ? -0.5 : 0.5) * separation : 0;
    const startPick = rand();
    const startCorner = closed && corners.length > 0 ? corners[Math.floor(startPick * corners.length)] : null;
    const from = startCorner ? startCorner.d : closed ? startPick * total : 0;
    const side = rand() < 0.5 ? -1 : 1;
    // Starting at a corner the pen lands on it; elsewhere it lands just beside
    // the line. Either way it lifts off a little past where it began.
    const kickIn = startCorner ? 0 : side * kickBase * (0.2 + rand() * 0.15);
    const kickOut = -side * kickBase * (0.35 + rand() * 0.25);
    const lapLength = total + tail;

    // Stops along this lap, in distance from `from`.
    type Stop = { s: number; corner: number };
    const NONE = -1;
    const regular: number[] = [];
    for (let i = 0; i <= samples; i += 1) regular.push(i * step);
    if (closed) {
      for (let j = 1; j < seamStops; j += 1) regular.push((tailBase * j) / seamStops);
      for (let j = 1; j <= seamStops; j += 1) regular.push(total + (tail * j) / seamStops);
    }
    regular.sort((a, b) => a - b);

    // Subdivide wherever the outline turns sharply between two stops.
    const fine: number[] = [];
    let budget = STOP_BUDGET - regular.length - corners.length * 4;
    for (let i = 0; i < regular.length; i += 1) {
      const a = regular[i];
      fine.push(a);
      const b = regular[i + 1];
      if (b === undefined || b - a < 1e-9 || budget <= 0) continue;
      const turned = turnUpTo(from + b) - turnUpTo(from + a);
      if (turned > SUBDIVIDE) {
        const pieces = Math.min(16, budget + 1, Math.ceil(turned / PIECE));
        for (let j = 1; j < pieces; j += 1) fine.push(a + ((b - a) * j) / pieces);
        budget -= pieces - 1;
      }
    }

    const cornerStops: Stop[] = [];
    for (const c of corners) {
      const rel = closed ? (((c.d - from) % total) + total) % total : c.d;
      if (closed && (rel < 1e-6 || total - rel < 1e-6)) {
        cornerStops.push({ s: 0, corner: c.index }, { s: total, corner: c.index });
        continue;
      }
      if (rel <= 0 || rel >= total) continue;
      cornerStops.push({ s: rel, corner: c.index });
      if (closed && rel <= tail) cornerStops.push({ s: total + rel, corner: c.index });
    }

    // Regular stops give way to a corner within half a unit of it.
    const merged: Stop[] = cornerStops.slice();
    for (const s of fine) {
      if (s > lapLength + 1e-9) continue;
      if (cornerStops.some((c) => Math.abs(c.s - s) < 0.5)) continue;
      merged.push({ s, corner: NONE });
    }
    merged.sort((p, q) => p.s - q.s);

    const stops: Stop[] = [];
    for (const stop of merged) {
      const prev = stops[stops.length - 1];
      if (prev && stop.s - prev.s < 0.05) {
        if (stop.corner !== NONE) stops[stops.length - 1] = stop;
        continue;
      }
      stops.push(stop);
    }

    // The wander cap at each stop, smoothed so it never steps.
    let cap = stops.map((stop) => Math.min(amplitude, 0.04 * radiusAt(from + stop.s)));
    // Spread a tight spot one stop either way, then blur, so the cap ramps
    // down before a tight end rather than stepping at it.
    for (let round = 0; round < 2; round += 1) {
      const prev = cap;
      cap = prev.map((c, i) => Math.min(c, prev[Math.max(0, i - 1)], prev[Math.min(prev.length - 1, i + 1)]));
    }
    for (let round = 0; round < 3; round += 1) {
      const prev = cap.slice();
      for (let i = 0; i < cap.length; i += 1) {
        const l = prev[Math.max(0, i - 1)];
        const r2 = prev[Math.min(cap.length - 1, i + 1)];
        cap[i] = Math.min(prev[i], (l + 2 * prev[i] + r2) / 4);
      }
    }

    const pts: Point[] = [];
    stops.forEach((stop, i) => {
      const p = stop.corner === NONE ? at(from + stop.s) : atCorner(stop.corner);
      const d = wrap(from + stop.s);
      let o = (bias + offset(d) * cap[i]) * envelope(stop.s);
      if (closed) {
        // Shrunk where the curvature cap is, so a seam on a tight end stays round.
        const tight = amplitude > 0 ? Math.min(1, cap[i] / amplitude) : 1;
        if (stop.s < tailBase) o += kickIn * tight * (1 - stop.s / tailBase) ** 2;
        if (stop.s > total) o += kickOut * tight * ((stop.s - total) / (tail || 1)) ** 2;
      }
      const x = cx + (p.x - cx) * swell + p.nx * o;
      const y = cy + (p.y - cy) * swell + p.ny * o;
      pts.push({ x, y });
      if (stop.corner !== NONE) pts.push({ x, y });
    });
    laps.push(splineOpen(pts));
  }
  return laps.join(' ');
}

/**
 * Where an outline turns: its real corners (a turn over 55° at one vertex) and
 * the accumulated turning of everything else, as a function of arc length.
 */
function turningOf(
  outline: readonly Point[],
  closed: boolean,
  cum: readonly number[]
): {
  corners: Array<{ d: number; index: number }>;
  turnAt: (d: number) => number;
  turnTotal: number;
} {
  const n = outline.length;
  const CORNER = (55 * Math.PI) / 180;
  const corners: Array<{ d: number; index: number }> = [];
  const at: number[] = [];
  const sum: number[] = [];
  let running = 0;
  for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i += 1) {
    const before = outline[(i - 1 + n) % n];
    const here = outline[i];
    const after = outline[(i + 1) % n];
    const ax = here.x - before.x;
    const ay = here.y - before.y;
    const bx = after.x - here.x;
    const by = after.y - here.y;
    if (Math.hypot(ax, ay) < 1e-9 || Math.hypot(bx, by) < 1e-9) continue;
    const turn = Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
    if (turn > CORNER) {
      corners.push({ d: cum[i], index: i });
      continue;
    }
    running += turn;
    at.push(cum[i]);
    sum.push(running);
  }
  const turnAt = (d: number): number => {
    let lo = 0;
    let hi = at.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (at[mid] <= d) lo = mid + 1;
      else hi = mid;
    }
    return lo === 0 ? 0 : sum[lo - 1];
  };
  return { corners, turnAt, turnTotal: running };
}

/**
 * Whether a run of points looks like a flattened curve: four consecutive
 * vertices that each turn under 20° between edges shorter than a twelfth of
 * the run. Relative to the run, so a shape is classified the same at any size.
 * A fallback for callers that cannot say; every caller in this codebase that
 * knows passes the answer explicitly.
 */
export function isSampledCurve(points: readonly Point[], closed: boolean): boolean {
  const n = points.length;
  if (n < 5) return false;
  let perimeter = 0;
  for (let i = 1; i < (closed ? n + 1 : n); i += 1) {
    const a = points[i - 1];
    const b = points[i % n];
    perimeter += Math.hypot(b.x - a.x, b.y - a.y);
  }
  const SMOOTH = Math.cos((20 * Math.PI) / 180);
  const SHORT = perimeter / 12;
  let run = 0;
  const limit = closed ? n + 3 : n - 1;
  for (let k = 1; k < limit; k += 1) {
    const before = points[(k - 1) % n];
    const here = points[k % n];
    const after = points[(k + 1) % n];
    const ax = here.x - before.x;
    const ay = here.y - before.y;
    const bx = after.x - here.x;
    const by = after.y - here.y;
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    const smooth =
      la > 1e-9 && lb > 1e-9 && la < SHORT && lb < SHORT && (ax * bx + ay * by) / (la * lb) > SMOOTH;
    run = smooth ? run + 1 : 0;
    if (run >= 4) return true;
  }
  return false;
}

/**
 * An open spline through `points`, as cubics.
 *
 * Catmull-Rom with tangents weighted by the neighbouring spacing, so samples
 * that are unevenly spaced (the fine stops at a lap's seam) do not make the
 * curve overshoot, and a repeated point — a corner — makes the curve leave
 * along its outgoing chord. With even spacing this is the standard
 * Catmull-Rom construction.
 */
function splineOpen(points: readonly Point[]): string {
  const n = points.length;
  if (n < 2) return '';
  if (n === 2) return `M ${r(points[0].x)} ${r(points[0].y)} L ${r(points[1].x)} ${r(points[1].y)}`;
  const at = (i: number) => points[Math.max(0, Math.min(n - 1, i))];
  const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
  let d = `M ${r(points[0].x)} ${r(points[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const d12 = dist(p1, p2);
    if (d12 < 1e-9) continue;
    const w1 = dist(p0, p1) + d12;
    const w2 = d12 + dist(p2, p3);
    const t1x = w1 > 1e-9 ? (p2.x - p0.x) / w1 : 0;
    const t1y = w1 > 1e-9 ? (p2.y - p0.y) / w1 : 0;
    const t2x = w2 > 1e-9 ? (p3.x - p1.x) / w2 : 0;
    const t2y = w2 > 1e-9 ? (p3.y - p1.y) / w2 : 0;
    d +=
      ` C ${r(p1.x + (t1x * d12) / 3)} ${r(p1.y + (t1y * d12) / 3)}` +
      ` ${r(p2.x - (t2x * d12) / 3)} ${r(p2.y - (t2y * d12) / 3)}` +
      ` ${r(p2.x)} ${r(p2.y)}`;
  }
  return d;
}

/** Exported for the hachure, which fills against a smooth ring rather than the sketch. */
export { spline as closedSpline };

/**
 * A sketch profile, tempered for strokes laid close together.
 *
 * `edge` displaces the ends of a stroke by `offset`, and that number is an
 * absolute — 1.0, 1.6 or 2.4 by level. For an *outline* that is exactly right:
 * an edge is long, it has nothing beside it, and the displacement is the whole
 * character of the mark.
 *
 * Shading is the case it was not written for. At the dense setting the strokes
 * are 5.5 units apart, so a medium profile moving both neighbours' ends by up
 * to 0.8 toward each other closes a third of the spacing before the scanline
 * wobble is counted at all — and two shading strokes that merge are not a
 * rougher drawing, they are a flat tone where a tone was meant to be varied.
 *
 * A hand does the same thing without thinking about it: shading a small area
 * closely, it makes neater strokes than it does drawing the outline round it.
 * Loosening that would not read as more character, it would read as mud.
 *
 * So the displacement is capped as a fraction of the spacing, and only capped
 * — a light density leaves the profile untouched, because there the absolute
 * number is already well within the room available.
 */
function shadingProfile(prof: SketchProfile, gap: number): SketchProfile {
  const room = gap * 0.16;
  return prof.offset <= room ? prof : { ...prof, offset: room };
}

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
 *
 * ## The two displacements are fractions of the gap, and were constants
 *
 * A stroke is nudged along its own axis at each end, and off the scanline by a
 * little. Both were absolute — two units and one unit — while the gap they sit
 * between ranges from 5.5 to 14, a factor of two and a half. One number cannot
 * serve that, and it failed at both ends of the range in opposite ways.
 *
 * At `dense` the strokes came within 3.5 units of each other, because each of
 * a pair could wander a whole unit toward the other. The density docstring
 * names four units as where "the strokes merge into a flat tone and the drawn
 * quality is lost" — so the densest setting was intermittently destroying the
 * thing the control exists to vary. At `light` the same unit is seven per cent
 * of the spacing and reads as nothing, which is why that setting looked ruled
 * rather than drawn.
 *
 * This is the same density-versus-amplitude confusion the file has had to
 * separate for the shading angle, the ellipse sketcher and the stroke nib. The
 * tell is always this one: a constant displacement sitting next to a variable
 * spacing.
 */

/**
 * A shape's contours, however the caller had them.
 *
 * Everything here used to take one ring, which is right for the shapes that
 * have one and silently wrong for the ones that do not: a ring, a gear, a
 * pierced key, a person and a rack are each two or more contours, and passing
 * their concatenation as a single ring invents an edge from the end of one to
 * the start of the next. That edge is a stray stroke across the sketched
 * outline and a false crossing in the shading's scanline — so a sketched ring
 * shaded straight through its own hole.
 *
 * Accepting both forms rather than replacing the signature keeps the callers
 * that genuinely have one ring — a sticky's edge, the panel's specimens —
 * saying so.
 */
export type Rings = readonly Point[] | readonly (readonly Point[])[];

export function asRings(input: Rings): readonly (readonly Point[])[] {
  if (input.length === 0) return [];
  return Array.isArray((input as readonly (readonly Point[])[])[0])
    ? (input as readonly (readonly Point[])[])
    : [input as readonly Point[]];
}

/**
 * Where a horizontal line at `y` crosses the rings, left to right.
 *
 * Even-odd by construction: the crossings of *every* contour go into one
 * sorted list, so a hole's two crossings close the span its outer contour
 * opened. That is the whole of hole support for shading, and it is four lines.
 */
function scanCrossings(rings: readonly (readonly Point[])[], y: number): number[] {
  const out: number[] = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      // Half-open test, so a vertex exactly on the scanline is counted once
      // rather than opening and closing the same span.
      if (a.y <= y === b.y <= y) continue;
      out.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
  }
  return out.sort((p, q) => p - q);
}

function hachurePass(
  input: Rings,
  options: { seed: number; gap: number; angle: number; level?: SketchLevel }
): string {
  const { seed, gap, angle, level } = options;
  if (asRings(input).every((r) => r.length < 3)) return '';

  const prof = shadingProfile(profileFor(level), gap);
  const rand = rng(seed ^ 0x9e3779b9);
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(-rad);
  const sin = Math.sin(-rad);
  // Work in a frame where the hachure runs horizontally, then rotate back.
  const rot = asRings(input).map((ring) =>
    ring.map((p) => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }))
  );
  const flat = rot.flat();
  const minY = Math.min(...flat.map((p) => p.y));
  const maxY = Math.max(...flat.map((p) => p.y));

  const strokes: string[] = [];
  const back = (x: number, y: number) => ({ x: x * cos + y * sin, y: -x * sin + y * cos });

  /**
   * How far a stroke may stray off its scanline, at each end independently.
   *
   * Independent ends are deliberate — it tilts the stroke rather than merely
   * offsetting it, which is what a hand does — and it is why this has to stay
   * well under half the gap: two neighbours leaning toward each other close
   * the spacing by twice this.
   */
  const wobble = gap * 0.09;

  /**
   * How far short of the edge a stroke stops, on average.
   *
   * The mean is inward, because shading that routinely ran past the outline
   * would read as a mistake rather than as a hand. The *variation* is
   * symmetric about that mean, so a stroke occasionally reaches the edge or
   * crosses it slightly, which is the difference between shading that was
   * drawn and shading that was clipped. `Math.abs` here forced every stroke
   * short, which did not avoid a ruled edge so much as move it inward.
   */
  const inset = Math.min(gap * 0.22, 3);

  for (let y = minY + gap / 2; y < maxY; y += gap) {
    const crossings = scanCrossings(rot, y);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const lo = crossings[i] + inset + jitter(inset, rand);
      const hi = crossings[i + 1] - inset - jitter(inset, rand);
      // A span narrower than the inset would invert, drawing the stroke
      // backwards past both edges. Skipped rather than clamped: a sliver at
      // the tip of a star has no room for a mark, and drawing one there is
      // what puts shading outside the shape.
      if (hi <= lo) continue;
      const s = back(lo, y + jitter(wobble, rand));
      const e = back(hi, y + jitter(wobble, rand));
      strokes.push(edge(s.x, s.y, e.x, e.y, rand, false, prof));
    }
  }
  return strokes.join(' ');
}

/**
 * One run of the pen: a span of scanlines it has been travelling down without
 * lifting. Held in the rotated frame, where a span is a plain interval.
 */
interface Scribble {
  /** The span this chain occupied on the row above, for the overlap test. */
  lo: number;
  hi: number;
  /** Where the pen finished, in the rotated frame and in world space. */
  atX: number;
  at: Point;
  /** Which way the *next* row of this chain runs. */
  forward: boolean;
}

/**
 * Zigzag / scribble fill — continuous back-and-forth pen shading.
 *
 * ## What makes this different from hachure, and why that costs something
 *
 * Hachure is a set of separate strokes, so each span of each scanline is
 * independent and nothing has to be tracked between them. A scribble is *one
 * stroke*: the pen runs to the end of a row, turns, and comes back along the
 * next one without leaving the paper. That continuity is the entire look, and
 * it is also the only thing here that can be wrong in a way a stroke-per-span
 * fill cannot.
 *
 * ## The pen may not leave the shape, and it used to
 *
 * The first version carried a single `prevPoint` across every span of every
 * scanline and joined each new span to it. On a convex shape there is one span
 * per row and that is exactly right. On anything concave — a star, a C, a
 * ring, a polygon with a notch — a row has two or more spans with a *gap*
 * between them, and joining the end of one to the start of the next draws a
 * stroke straight across that gap, outside the shape. A star shaded this way
 * had its points webbed together.
 *
 * So the pen is tracked as one or more `Scribble` chains rather than one
 * point. A span continues the chain from the row above whose span it overlaps,
 * and starts a fresh chain when there is none — which is what a hand does at
 * the top of each arm of a star, because there is nowhere to have come from.
 * Where a shape narrows to nothing a chain simply ends; where it splits, one
 * side continues and the other begins, since the pen cannot be in two places.
 *
 * `forward` is per chain for the same reason. It was a single flag toggled
 * once per *span*, so on a row with two spans the two ran in opposite
 * directions and the next row reversed both — which, combined with the joins
 * above, is what produced the crossing diagonals rather than shading.
 *
 * ## The turn is a turn, not another stroke
 *
 * The join between two rows used to be a full bowed `edge`, identical in
 * character to the shading strokes, so it read as an extra line rather than as
 * the pen changing direction. A hand turns *past* the end of the row and comes
 * back — the same overshoot this file already gives every corner, for the same
 * reason. It is one quadratic bulging outward, away from the span it is
 * leaving, so the pair of rows is joined by a hairpin.
 *
 * The bulge is a fraction of the gap, so a dense scribble turns tightly and a
 * light one loops — density and amplitude staying in step, which is the
 * distinction this file has had to make three times elsewhere. It is capped in
 * absolute terms so a light density cannot produce loops bigger than the marks
 * they join, and scaled by the level's own overshoot so the three levels differ
 * in character here as they do everywhere else.
 */
function zigzagPass(
  input: Rings,
  options: { seed: number; gap: number; angle: number; level?: SketchLevel }
): string {
  const { seed, gap, angle, level } = options;
  if (asRings(input).every((r) => r.length < 3)) return '';

  const prof = shadingProfile(profileFor(level), gap);
  const rand = rng(seed ^ 0x9e3779b9);
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(-rad);
  const sin = Math.sin(-rad);
  const rot = asRings(input).map((ring) =>
    ring.map((p) => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }))
  );
  const flat = rot.flat();
  const minY = Math.min(...flat.map((p) => p.y));
  const maxY = Math.max(...flat.map((p) => p.y));

  const strokes: string[] = [];
  const back = (x: number, y: number) => ({ x: x * cos + y * sin, y: -x * sin + y * cos });

  // How far the pen runs past the end of a row before coming back.
  const turn = Math.min(gap * 0.5, 5) * (0.5 + prof.overshoot * 0.5);
  // The same two as `hachurePass`, for the same reason and by the same rule.
  const wobble = gap * 0.09;
  const inset = Math.min(gap * 0.22, 3);

  let open: Scribble[] = [];

  for (let y = minY + gap / 2; y < maxY; y += gap) {
    const crossings = scanCrossings(rot, y);

    const next: Scribble[] = [];
    const taken = new Set<Scribble>();

    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const lo = crossings[i];
      const hi = crossings[i + 1];

      // Pulled in at both ends, unevenly, so the shading does not end on a
      // ruled edge where the outline is deliberately loose. Fractions of the
      // gap for the reason `hachurePass` sets out at length: a constant
      // displacement beside a variable spacing serves neither end of it.
      const loX = lo + inset + jitter(inset, rand);
      const hiX = hi - inset - jitter(inset, rand);
      if (hiX <= loX) continue;
      const left = back(loX, y + jitter(wobble, rand));
      const right = back(hiX, y + jitter(wobble, rand));

      /**
       * The chain this span continues, if any.
       *
       * Overlap in the rotated frame, strictly — two spans that merely touch
       * at a point are a shape pinched to nothing there, and drawing the pen
       * through that point is the webbing this whole structure exists to
       * avoid. Each chain is claimed at most once: a span that splits in two
       * continues one side and starts the other.
       */
      const from = open.find(
        (c) => !taken.has(c) && Math.min(c.hi, hi) - Math.max(c.lo, lo) > 0
      );

      const forward = from ? from.forward : true;
      const startX = forward ? loX : hiX;
      const s = forward ? left : right;
      const e = forward ? right : left;

      if (from) {
        taken.add(from);
        /**
         * The hairpin, bulging away from the row it is leaving.
         *
         * Which way is outward is decided by which end of its span the pen
         * finished on, not by `forward` — they agree on a straight run and
         * come apart the moment a chain continues into a span that has moved
         * sideways under it, which is every sloped edge.
         */
        const out = from.atX >= (from.lo + from.hi) / 2 ? 1 : -1;
        const cx = (from.atX + startX) / 2 + out * (turn + Math.abs(jitter(turn * 0.3, rand)));
        // Halfway back up to the row it came from, which sits one gap above.
        const cy = y - gap / 2;
        const c = back(cx, cy);
        strokes.push(`M ${r(from.at.x)} ${r(from.at.y)} Q ${r(c.x)} ${r(c.y)} ${r(s.x)} ${r(s.y)}`);
      }

      strokes.push(edge(s.x, s.y, e.x, e.y, rand, false, prof));
      next.push({ lo, hi, atX: forward ? hiX : loX, at: e, forward: !forward });
    }

    open = next;
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
  input: Rings,
  options: { seed: number; gap: number; angle: number; level?: SketchLevel }
): string {
  const { seed, angle, level, gap } = options;
  if (asRings(input).every((r) => r.length < 3)) return '';

  const rand = rng(seed ^ 0x9e3779b9);
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(-rad);
  const sin = Math.sin(-rad);
  const rot = asRings(input).map((ring) =>
    ring.map((p) => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }))
  );
  const flat = rot.flat();
  const minY = Math.min(...flat.map((p) => p.y));
  const maxY = Math.max(...flat.map((p) => p.y));
  const minX = Math.min(...flat.map((p) => p.x));
  const maxX = Math.max(...flat.map((p) => p.x));

  /**
   * The spacing, from the gap it was handed — and capped by a *count*, not by
   * a length.
   *
   * ## The history, because it has now been wrong twice in the same place
   *
   * The first version computed its own step from the shape's diagonal and
   * discarded `gap` entirely, which made stipple the one shading style with no
   * density: the control was offered on four styles, worked on three, and did
   * nothing on the one whose whole language *is* density.
   *
   * The fix put the gap back — under `Math.max(gap * nib, min(40, diag / 16))`
   * — and the floor went straight on dominating it, because a floor derived
   * from the shape grows with the shape while the gap does not. Measured:
   *
   * ```text
   *              light   medium   dense
   *   200x140    23.10    15.26   15.26   ← two settings identical
   *   300x200    23.10    22.53   22.53   ← all three within 3%
   *   600x400    40.00    40.00   40.00   ← the control does nothing
   * ```
   *
   * So the control worked on small shapes and faded out as the shape grew,
   * which is worse than not working: it is a control that answers sometimes,
   * and the existing test asserted `dense !== light` on a 100-unit square,
   * where it happens to. That is the honest lesson here — the assertion was
   * true and the feature was broken, because the case it chose was the case
   * that worked.
   *
   * ## What the cap is actually protecting
   *
   * Not a spacing. The reason a limit exists at all is that this is drawn as a
   * single path every frame, so what has to stay bounded is **how many dots
   * there are**. Saying that directly means density is honoured at every size
   * and the cap engages only when the count genuinely would be a problem —
   * which, for a shape big enough to reach it, is a shape where nobody can
   * distinguish the two densities anyway.
   */
  const nib = level === 'heavy' ? 1.35 : level === 'light' ? 2 : 1.65;
  const want = gap * nib;
  const area = Math.max(1, (maxX - minX) * (maxY - minY));
  /**
   * Dots per shape, past which the spacing is opened up.
   *
   * Two thousand is roughly where a stipple path stops being cheap to parse
   * and starts being visible in a frame budget, and it is far past the point
   * where a shape reads as stippled rather than as filled.
   */
  const BUDGET = 2000;
  const wanted = area / (want * want);
  const step = wanted > BUDGET ? want * Math.sqrt(wanted / BUDGET) : want;

  const paths: string[] = [];
  const back = (x: number, y: number) => ({ x: x * cos + y * sin, y: -x * sin + y * cos });

  /**
   * Alternate rows are offset by half a step, and the jitter is wider.
   *
   * A square lattice with a ±30% wobble is still a square lattice: the eye
   * finds the rows and the columns straight through that much noise, and
   * stipple that reads as a grid of dots is the one thing it must not be.
   * Pushing the jitter far enough to hide a lattice on its own would have to
   * exceed half a step, at which point dots swap places and clump.
   *
   * Staggering the rows is the cheaper half of the answer and the one that
   * actually removes the artefact — it is why hexagonal packing looks organic
   * and square packing does not — so the jitter only has to break up what is
   * left, rather than do the whole job on its own.
   */
  let row = 0;
  for (let y = minY + step * 0.6; y < maxY - step * 0.2; y += step, row++) {
    const crossings = scanCrossings(rot, y);
    const stagger = row % 2 ? step / 2 : 0;
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const xStart = crossings[i] + step * 0.4 + stagger;
      const xEnd = crossings[i + 1] - step * 0.4;
      for (let x = xStart; x < xEnd; x += step) {
        const jx = jitter(step * 0.34, rand);
        const jy = jitter(step * 0.34, rand);
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
 * Whether a style paints an enclosed region, or draws the inside as marks.
 *
 * Said once, here, because four places were asking it and each had written its
 * own answer: the renderer's solid-fill layer, the renderer's inner-shadow
 * clip, the SVG exporter, and the Effects panel's `penShaded`. Three of those
 * spelled the question as `fillPaint.type === 'solid'`, which is a question
 * about the **paint** — is it a colour or a gradient — and not about the
 * *style*, so they agreed with each other only by accident of the silhouette
 * being empty for the pen-shaded styles.
 *
 * That accident is exactly what made the hit-region fix inert: gating on
 * "there is a silhouette" was standing in for "this style fills its interior",
 * and the moment the silhouette had to exist for a reason *other* than being
 * painted, the two came apart. A region and a fill are different facts and the
 * code now asks for them separately.
 *
 * Absent is `solid`, matching `shapeFill`, so an unset style behaves as the
 * ordinary flat fill everywhere rather than in most places.
 */
export function fillsInterior(style: FillStyle | undefined): boolean {
  return (style ?? 'solid') === 'solid';
}

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
  input: Rings,
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
    return zigzagPass(input, { seed, gap: gap * 1.2, angle, level });
  }

  if (style === 'dots') {
    return dotsPass(input, { seed, gap: gap * 1.3, angle, level });
  }

  const first = hachurePass(input, { seed, gap, angle, level });
  if (style === 'hachure') return first;

  /**
   * The second pass is not exactly perpendicular, and not exactly the same gap.
   *
   * Both are deliberate: a true right angle at an even spacing produces graph
   * paper, which is a printed texture rather than a drawn one. Fifteen per cent
   * wider and a right angle off a line that is already off the diagonal keeps
   * the crossings irregular.
   */
  const second = hachurePass(input, {
    seed: seed ^ 0x5bf03635,
    gap: gap * 1.15,
    angle: angle + 90,
    level,
  });
  return `${first} ${second}`;
}

/**
 * A sampled ring displaced along its normals by a few slow, closed waves —
 * the fill boundary that matches `roughLoop`'s outline. The wander is capped
 * by the local radius of curvature, smoothed round the ring, so small rings
 * stay round and cusps stay sharp.
 */
function smoothSilhouette(points: readonly Point[], prof: SketchProfile, rand: Rand): string {
  const n = points.length;
  const cum: number[] = [0];
  for (let i = 1; i <= n; i += 1) {
    const a = points[i - 1];
    const b = points[i % n];
    cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = cum[n];
  if (!(total > 0)) return '';
  const amplitude = Math.min(prof.offset * 0.45, total / 90);
  const harmonics = total < 150 ? [2] : [2, 3];
  const terms = harmonics.map((k) => ({ k, amp: (0.6 + rand() * 0.8) / (k * k), phase: rand() * Math.PI * 2 }));
  const rms = Math.sqrt(terms.reduce((sum, t) => sum + (t.amp * t.amp) / 2, 0)) || 1;

  const normals: Array<{ nx: number; ny: number }> = [];
  let cap: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const before = points[(i - 1 + n) % n];
    const here = points[i];
    const after = points[(i + 1) % n];
    const ax = here.x - before.x;
    const ay = here.y - before.y;
    const bx = after.x - here.x;
    const by = after.y - here.y;
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    const tx = after.x - before.x;
    const ty = after.y - before.y;
    const tl = Math.hypot(tx, ty) || 1;
    normals.push({ nx: -ty / tl, ny: tx / tl });
    const turn = la > 1e-9 && lb > 1e-9 ? Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by)) : 0;
    const radius = turn > 1e-6 ? (la + lb) / 2 / turn : Infinity;
    cap.push(Math.min(amplitude, 0.04 * radius));
  }
  for (let round = 0; round < 3; round += 1) {
    const prev = cap;
    cap = prev.map((c, i) => Math.min(c, (prev[(i - 1 + n) % n] + 2 * c + prev[(i + 1) % n]) / 4));
  }

  let d = '';
  for (let i = 0; i < n; i += 1) {
    let v = 0;
    for (const t of terms) v += t.amp * Math.sin((2 * Math.PI * t.k * cum[i]) / total + t.phase);
    const o = (v / rms) * cap[i];
    const x = points[i].x + normals[i].nx * o;
    const y = points[i].y + normals[i].ny * o;
    d += `${i === 0 ? 'M' : ' L'} ${r(x)} ${r(y)}`;
  }
  return d + ' Z';
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
  input: Rings,
  options: { seed: number; level?: SketchLevel; width?: number; curved?: boolean }
): string {
  const { seed, level, width, curved } = options;
  const rings = asRings(input).filter((r) => r.length >= 3);
  if (rings.length === 0) return '';
  // One closed contour per ring, in the order the outline gave them — which
  // for a compound shape is outer first and holes after, wound the other way.
  // Both painters fill this non-zero, so opposite windings are what make the
  // hole a hole rather than a second disc drawn on top of the first.
  return rings.map((ring) => oneSilhouette(ring, seed, level, width, curved)).join(' ');
}

function oneSilhouette(
  points: readonly Point[],
  seed: number,
  level: SketchLevel | undefined,
  width: number | undefined,
  curved: boolean | undefined
): string {
  // The same nib as the outline: the fill boundary and the stroke over it have
  // to stray by the same amount, or a wide pen's wander walks the drawn edge
  // off its own fill.
  const prof = penFor(level, width);
  // A different stream from the outline's, so the fill boundary and the drawn
  // edge wander independently — which is what a real pen and a real wash do.
  const rand = rng(seed ^ 0x2545f491);

  // A sampled curve gets the same smooth wander the outline does; independent
  // per-vertex jitter would give its fill a ragged edge under a smooth stroke.
  if (curved ?? isSampledCurve(points, true)) return smoothSilhouette(points, prof, rand);

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

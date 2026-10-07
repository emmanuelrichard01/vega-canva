/**
 * Curved connectors that go around things.
 *
 * A curve is fitted over the elbow route the router found (the skeleton). It
 * inherits everything that route knows: which side of each obstacle to pass,
 * leaving and arriving along the port normals, and staying out of both ends'
 * own boxes.
 *
 * Every elbow of the skeleton becomes a cubic Bézier that leaves along the
 * incoming leg and arrives along the outgoing one, reaching up to half of each
 * leg (the whole leg for the first and last, less a short straight stub at the
 * port). Two neighbouring turns that each take half of the leg between them
 * meet in its middle with the same heading, so the curve is one continuous
 * sweep with no kink, and a long straight run stays straight between turns.
 * The reach along each leg is set independently, so a short jog between two
 * long runs becomes a long, gentle S rather than a tight wiggle.
 *
 * A wide turn cuts the corner it rounds, and cut too far it reaches into the
 * box the elbow was going around. So each turn is sampled and checked against
 * the obstacles; where it intrudes, that turn alone is tightened and checked
 * again, down to the elbow's own corner, which is clear by construction. The
 * rest of the curve keeps its sweep.
 *
 * A route that has to come back on itself at a port (the target sits behind
 * the side it is entered from, or the source's side faces away from where it
 * goes) has two turns a short stub apart. Rounded one at a time, the second
 * is squeezed into the stub and the end curls into a teardrop. Those two turns
 * are drawn as one U instead: a single sweep from the run into the stub that
 * stays between the two parallel legs, so the line leaves or arrives along
 * the port normal and turns steadily one way, never doubling back.
 *
 * Pure and deterministic: the same skeleton and obstacles always give the same
 * points.
 */

import type { Pt, Rect } from './geometry';

/** Clearance a curve keeps from an obstacle's own box, inside the router's margin. */
export const CURVE_CLEARANCE = 6;
/** Samples per turn. Enough to look smooth at any zoom a connector is read at. */
const STEPS_PER_TURN = 20;
/** The longest a turn may reach along one leg, as a multiple of its reach along the other. */
const MAX_REACH_RATIO = 2.5;
/**
 * A middle leg shorter than this share of both legs beside it is a jog, not a
 * run. An S-shaped jog (in and out heading the same way) is drawn as one
 * sweep across it rather than two turns meeting head-on in a short leg.
 */
const JOG_SHARE = 0.6;
/** The straight run kept at each port before the first turn begins. */
const PORT_STUB = 8;
/**
 * How far a turn's control points sit along its legs, as a share of its reach.
 * 0.55 is a circular quarter; a little more gives the fuller sweep that reads
 * as a drawn curve rather than a rounded corner.
 */
const HANDLE = 0.62;
/** The straight run a hairpin leaves at its port: enough to clear the port's own box. */
const HAIRPIN_STUB = CURVE_CLEARANCE + 1;
/**
 * How far a hairpin may bulge past its corners. The router keeps its legs a
 * margin clear of everything, and the curve needs less than that; a hairpin
 * that would bulge into something is tightened like any other turn.
 */
const HAIRPIN_BULGE = 12;
/** How many times a turn is tightened before it falls back to its corner. */
const TIGHTEN_STEPS = 6;
const TIGHTEN_FACTOR = 0.62;

function inside(r: Rect, p: Pt): boolean {
  return p.x > r.minX && p.x < r.maxX && p.y > r.minY && p.y < r.maxY;
}

/** The first sample, if any, that enters one of the boxes. Ends are allowed to touch. */
export function intrusion(samples: readonly Pt[], boxes: readonly Rect[]): number {
  for (let i = 1; i + 1 < samples.length; i += 1) {
    for (const r of boxes) if (inside(r, samples[i])) return i;
  }
  return -1;
}

function dedupe(points: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 1e-6) out.push(p);
  }
  return out;
}

interface Turn {
  /** For a merged jog or hairpin: the second corner, where the sweep ends. */
  exit?: Pt;
  /** A hairpin: the sweep comes back the way it went, as a U across a leg this wide, running `mid`. */
  hairpin?: { width: number; mid: Pt };
  corner: Pt;
  /** Unit direction of the incoming leg, toward the corner. */
  din: Pt;
  /** Unit direction of the outgoing leg, away from the corner. */
  dout: Pt;
  /** How far the turn may reach back along the incoming leg and on along the outgoing one. */
  maxIn: number;
  maxOut: number;
}

function cubicAt(p0: Pt, c0: Pt, c1: Pt, p1: Pt, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * p0.x + b * c0.x + c * c1.x + d * p1.x, y: a * p0.y + b * c0.y + c * c1.y + d * p1.y };
}

/** Handle length of a quarter circle drawn as one cubic, per unit of radius. */
const QUARTER = 0.5523;

/**
 * A hairpin at a reach scale: two quarter circles of one radius, joined by a
 * straight run when the U is wider than they are. Each end starts no further
 * back along its leg than `maxIn`, which leaves the port its straight stub,
 * and the U may bulge past the corners by up to `HAIRPIN_BULGE` to stay round.
 */
function sampleHairpin(turn: Turn, scale: number): Pt[] {
  const { corner, din, dout } = turn;
  const exit = turn.exit!;
  const { width, mid } = turn.hairpin!;
  const bulge = Math.min(HAIRPIN_BULGE, Math.max(0, width / 2 - turn.maxIn)) * scale;
  const r = Math.min(width / 2, turn.maxIn + HAIRPIN_BULGE) * scale;
  if (r < 0.5) return [{ ...corner }, { ...exit }];
  const a = { x: corner.x + din.x * bulge, y: corner.y + din.y * bulge };
  const b = { x: exit.x + din.x * bulge, y: exit.y + din.y * bulge };
  const k = r * QUARTER;
  const q0 = { x: a.x - din.x * r, y: a.y - din.y * r };
  const q1 = { x: a.x + mid.x * r, y: a.y + mid.y * r };
  const q2 = { x: b.x - mid.x * r, y: b.y - mid.y * r };
  const q3 = { x: b.x + dout.x * r, y: b.y + dout.y * r };
  const first = [q0, { x: q0.x + din.x * k, y: q0.y + din.y * k }, { x: q1.x - mid.x * k, y: q1.y - mid.y * k }, q1] as const;
  const second = [q2, { x: q2.x + mid.x * k, y: q2.y + mid.y * k }, { x: q3.x - dout.x * k, y: q3.y - dout.y * k }, q3] as const;
  const out: Pt[] = [];
  for (const [p0, c0, c1, p1] of [first, second]) {
    for (let s = 0; s <= STEPS_PER_TURN; s += 1) out.push(cubicAt(p0, c0, c1, p1, s / STEPS_PER_TURN));
  }
  return out;
}

/** One turn sampled at a reach scale, start and end included. */
function sampleTurn(turn: Turn, scale: number): Pt[] {
  if (turn.hairpin) return sampleHairpin(turn, scale);
  const rin = turn.maxIn * scale;
  const rout = turn.maxOut * scale;
  const { corner, din, dout } = turn;
  const exit = turn.exit ?? corner;
  if (rin < 0.5 || rout < 0.5) return turn.exit ? [{ ...corner }, { ...exit }] : [{ ...corner }];
  const p0 = { x: corner.x - din.x * rin, y: corner.y - din.y * rin };
  const p1 = { x: exit.x + dout.x * rout, y: exit.y + dout.y * rout };
  // A jog's handles span the run between its ends; a turn's reach along its legs.
  const span = turn.exit ? Math.abs((p1.x - p0.x) * din.x + (p1.y - p0.y) * din.y) * 0.5 : 0;
  const hin = turn.exit ? span : rin * HANDLE;
  const hout = turn.exit ? span : rout * HANDLE;
  const c0 = { x: p0.x + din.x * hin, y: p0.y + din.y * hin };
  const c1 = { x: p1.x - dout.x * hout, y: p1.y - dout.y * hout };
  const out: Pt[] = [];
  for (let s = 0; s <= STEPS_PER_TURN; s += 1) out.push(cubicAt(p0, c0, c1, p1, s / STEPS_PER_TURN));
  return out;
}

function hits(samples: readonly Pt[], boxes: readonly Rect[]): boolean {
  for (const p of samples) for (const r of boxes) if (inside(r, p)) return true;
  return false;
}

/**
 * A curve over an elbow route that stays out of `boxes`.
 *
 * `boxes` are the obstacles' own boxes grown by the clearance the curve must
 * keep (not the router's full margin, which the elbow route already keeps).
 */
export function fitCurve(route: readonly Pt[], boxes: readonly Rect[] = []): Pt[] {
  const pts = dedupe(route);
  const n = pts.length;
  if (n < 3) return pts.map((p) => ({ ...p }));

  const legs: number[] = [];
  const dirs: Pt[] = [];
  for (let i = 0; i + 1 < n; i += 1) {
    const dx = pts[i + 1].x - pts[i].x;
    const dy = pts[i + 1].y - pts[i].y;
    const len = Math.hypot(dx, dy);
    legs.push(len);
    dirs.push({ x: dx / len, y: dy / len });
  }

  // Each leg's share for the turn at either end of it: an end leg gives all
  // of itself but the port stub to its one turn, an interior leg half to each.
  const share = (leg: number) => {
    const len = legs[leg];
    if (leg === 0 || leg === legs.length - 1) return Math.max(0, len - Math.min(PORT_STUB, len * 0.4));
    return len / 2;
  };

  const out: Pt[] = [{ ...pts[0] }];
  for (let i = 1; i + 1 < n; i += 1) {
    const din = dirs[i - 1];
    const dout = dirs[i];
    // A straight-through vertex is not a turn.
    if (Math.abs(din.x * dout.y - din.y * dout.x) < 1e-6 && din.x * dout.x + din.y * dout.y > 0) continue;
    let turn: Turn;
    const jog =
      i + 2 < n &&
      legs[i] < JOG_SHARE * Math.min(legs[i - 1], legs[i + 1]) &&
      Math.abs(dirs[i + 1].x - din.x) < 1e-6 &&
      Math.abs(dirs[i + 1].y - din.y) < 1e-6;
    // A U whose one side is a port's stub: the turn into or out of the
    // port, drawn round (see `sampleHairpin`) rather than as two turns, the
    // second squeezed into the stub.
    const stubLeg = i === 1 ? 0 : i + 1;
    const otherLeg = i === 1 ? i + 1 : i - 1;
    const depth = Math.min(Math.max(0, legs[stubLeg] - HAIRPIN_STUB), share(otherLeg));
    const hairpin =
      !jog &&
      i + 2 < n &&
      (i === 1 || i + 2 === n - 1) &&
      depth > 0.5 &&
      Math.abs(din.x * dout.y - din.y * dout.x) > 0.999 &&
      dirs[i + 1].x * din.x + dirs[i + 1].y * din.y < -0.999;
    if (jog) {
      turn = { corner: pts[i], exit: pts[i + 1], din, dout: dirs[i + 1], maxIn: share(i - 1), maxOut: share(i + 1) };
      i += 1;
    } else if (hairpin) {
      turn = { corner: pts[i], exit: pts[i + 1], din, dout: dirs[i + 1], maxIn: depth, maxOut: depth, hairpin: { width: legs[i], mid: dout } };
      i += 1;
    } else {
      let maxIn = share(i - 1);
      let maxOut = share(i);
      // A turn far longer on one side than the other bends all at once at the
      // short end; keeping the two within a ratio spreads the bend out.
      maxIn = Math.min(maxIn, maxOut * MAX_REACH_RATIO);
      maxOut = Math.min(maxOut, maxIn * MAX_REACH_RATIO);
      turn = { corner: pts[i], din, dout, maxIn, maxOut };
    }
    let scale = 1;
    let samples = sampleTurn(turn, scale);
    for (let k = 0; k < TIGHTEN_STEPS && samples.length > 1 && hits(samples, boxes); k += 1) {
      scale *= TIGHTEN_FACTOR;
      samples = sampleTurn(turn, scale);
    }
    if (samples.length > 1 && hits(samples, boxes)) {
      samples = turn.exit ? [{ ...turn.corner }, { ...turn.exit }] : [{ ...turn.corner }];
    }
    for (const p of samples) {
      const last = out[out.length - 1];
      if (Math.hypot(last.x - p.x, last.y - p.y) > 1e-6) out.push(p);
    }
  }
  const end = pts[n - 1];
  const last = out[out.length - 1];
  if (Math.hypot(last.x - end.x, last.y - end.y) > 1e-6) out.push({ ...end });
  return out;
}

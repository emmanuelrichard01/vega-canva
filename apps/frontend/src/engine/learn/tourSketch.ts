import { roughEllipse, roughPolyline, seedFrom } from '../model/rough';
import type { Box, TourSide } from './tour';

/**
 * The tour, drawn by hand.
 *
 * ## Why hand-drawn, and why it is not a costume
 *
 * A tour is **annotation**, not interface. It is somebody leaning over and
 * drawing on your screen, and the register should say so. A crisp popover with
 * a system-styled beak competes with the real controls it is pointing at:
 * everything on this screen is a rectangle with a shadow, and the thing that
 * says "look here" is another rectangle with a shadow. A pen mark cannot be
 * mistaken for a control, which is the whole job.
 *
 * The reason this is *ours* rather than a style borrowed from somewhere is that
 * the product already draws this way. `rough.ts` is a first-class feature of the
 * canvas: any shape, frame or connector can be rendered hand-drawn at three
 * roughnesses. So the marks here are made by **the same generator the board
 * uses**, with the same profiles and the same seeded wobble, rather than by a
 * second imitation of a pen that would drift from the first the moment either
 * was tuned.
 *
 * ## Where the hand stops
 *
 * At the pointing. The ring, the pointer and its head are drawn; the title
 * takes the handwritten face because it is short, large, and it is the voice;
 * the body stays in the interface's own type.
 *
 * That line is not taste. The sketch is the *gesture* and the body is the
 * *information*, and handwriting at fourteen pixels is worse to read in every
 * language, worse with a fallback font, and worse for anybody who finds it hard
 * to begin with. A tour whose instructions are hard to read has spent its one
 * advantage on the wrong half.
 *
 * ## Why the seed comes from the step
 *
 * The marks are redrawn whenever the board pans, the window resizes or a panel
 * opens, which is many times a second while somebody scrolls. Seeded from the
 * step's id, every one of those redraws produces the *same* wobble, so the ring
 * sits still. Seeded from anything that moves, it would shimmer, and a drawing
 * that boils is the single fastest way to make a hand-drawn interface look
 * cheap rather than made.
 */

export interface Point {
  x: number;
  y: number;
}

/** How far outside the target the ring is drawn. */
const RING_PAD = 10;

/**
 * A ring round the thing being pointed at.
 *
 * An ellipse rather than a rectangle. Circling something is what a person does
 * with a pen, and a hand-drawn rectangle round a rectangular control reads as a
 * second, worse border on it rather than as a mark about it.
 */
export function ringPath(box: Box, stepId: string): string {
  const rx = box.width / 2 + RING_PAD;
  const ry = box.height / 2 + RING_PAD;
  return roughEllipse(box.x + box.width / 2, box.y + box.height / 2, rx, ry, {
    seed: seedFrom(`ring:${stepId}`),
    level: 'medium',
    width: 2,
  });
}

/**
 * Where the pointer leaves the card, and where it lands on the ring.
 *
 * Both offset off the centre line, which is what makes the stroke a gesture
 * rather than a leader line. A pen drawn from the middle of one box to the
 * middle of another is a diagram; one that leaves at an angle and curves in is
 * somebody's hand.
 */
function ends(card: Box, ring: Box, side: TourSide): { from: Point; to: Point; bow: number } {
  const ringMid = { x: ring.x + ring.width / 2, y: ring.y + ring.height / 2 };
  // A third of the way along the edge rather than the middle of it.
  const off = 0.22;

  switch (side) {
    case 'top':
      return {
        from: { x: card.x + card.width * (0.5 + off), y: card.y + card.height },
        to: { x: ringMid.x + ring.width * 0.12, y: ring.y - RING_PAD },
        bow: 1,
      };
    case 'bottom':
      return {
        from: { x: card.x + card.width * (0.5 - off), y: card.y },
        to: { x: ringMid.x - ring.width * 0.12, y: ring.y + ring.height + RING_PAD },
        bow: -1,
      };
    case 'left':
      return {
        from: { x: card.x + card.width, y: card.y + card.height * (0.5 - off) },
        to: { x: ring.x - RING_PAD, y: ringMid.y - ring.height * 0.12 },
        bow: -1,
      };
    default:
      return {
        from: { x: card.x, y: card.y + card.height * (0.5 + off) },
        to: { x: ring.x + ring.width + RING_PAD, y: ringMid.y + ring.height * 0.12 },
        bow: 1,
      };
  }
}

/** Sample a quadratic curve, which is what the pen is then run along. */
function arc(from: Point, to: Point, bow: number, steps = 14): Point[] {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  // Perpendicular to the run, so the curve bends across it rather than along.
  // A quarter of the distance is the point at which it reads as a deliberate
  // sweep; much more and it loops back on itself and stops pointing.
  const lift = Math.min(len * 0.26, 78) * bow;
  const cx = mx + (-dy / len) * lift;
  const cy = my + (dx / len) * lift;

  const out: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push({
      x: u * u * from.x + 2 * u * t * cx + t * t * to.x,
      y: u * u * from.y + 2 * u * t * cy + t * t * to.y,
    });
  }
  return out;
}

/** The head, as two strokes off the last direction of travel. */
function head(points: readonly Point[], stepId: string): string {
  const tip = points[points.length - 1];
  const before = points[points.length - 3] ?? points[0];
  const angle = Math.atan2(tip.y - before.y, tip.x - before.x);
  const size = 13;
  const spread = 0.42;

  const wing = (turn: number): Point => ({
    x: tip.x - size * Math.cos(angle + turn),
    y: tip.y - size * Math.sin(angle + turn),
  });

  // Two open strokes rather than a filled triangle: a filled head is a vector
  // arrowhead and reads as a diagram, where two crossing pen strokes read as
  // the same hand that drew the shaft.
  return [
    roughPolyline([wing(spread), tip], { seed: seedFrom(`hl:${stepId}`), closed: false, level: 'light', width: 2 }),
    roughPolyline([wing(-spread), tip], { seed: seedFrom(`hr:${stepId}`), closed: false, level: 'light', width: 2 }),
  ].join(' ');
}

export interface Pointer {
  /** The curving shaft. */
  shaft: string;
  /** The two strokes of the head. */
  head: string;
}

/**
 * Below this the card is against the ring and the arrow is noise.
 *
 * `TOUR_GAP` keeps them well apart in the ordinary case, so this only fires
 * where the placement had to clamp -- a window smaller than the card, or a
 * target in a corner. There the ring is already touching the card and drawing a
 * stroke between them would be pointing at something the reader is looking
 * straight at.
 */
const MIN_RUN = 34;

/**
 * A curving pen stroke from the card to the ring, with an arrowhead.
 *
 * Returned as two paths rather than one so the shaft can draw itself on and the
 * head can arrive after it, which is the order a hand does it in.
 */
export function pointerPath(card: Box, ring: Box, side: TourSide, stepId: string): Pointer | null {
  const { from, to, bow } = ends(card, ring, side);
  if (Math.hypot(to.x - from.x, to.y - from.y) < MIN_RUN) return null;
  const points = arc(from, to, bow);
  return {
    shaft: roughPolyline(points, {
      seed: seedFrom(`arrow:${stepId}`),
      closed: false,
      level: 'light',
      width: 2,
    }),
    head: head(points, stepId),
  };
}

/** The ring's own box, which the pointer aims at rather than at the target. */
export function ringBox(box: Box): Box {
  return {
    x: box.x - RING_PAD,
    y: box.y - RING_PAD,
    width: box.width + RING_PAD * 2,
    height: box.height + RING_PAD * 2,
  };
}

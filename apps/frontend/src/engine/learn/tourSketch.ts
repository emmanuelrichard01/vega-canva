import { roughEllipse, roughLoop, seedFrom } from '../model/rough';
import type { Box } from './tour';

/**
 * The pen ring the tour and the walkthrough draw round what they point at.
 *
 * Annotation rather than interface: everything on this screen is a rectangle
 * with a shadow, and a pen mark cannot be mistaken for another control. It is
 * made by `rough.ts`, the generator the canvas draws hand-drawn shapes with, so
 * the two hands cannot drift apart.
 *
 * Seeded from the step's id, so every redraw while the screen moves produces
 * the same wobble and the ring sits still instead of shimmering.
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
  // `heavy`: two passes that wander further and cross well past every corner.
  // A ring is the one mark here somebody would draw fast and without care, and
  // the overshoot at the join is most of what says a hand made it.
  return roughEllipse(box.x + box.width / 2, box.y + box.height / 2, rx, ry, {
    seed: seedFrom(`ring:${stepId}`),
    level: 'heavy',
    width: 2,
  });
}

/**
 * The rounded outline of a box, as points: `radius` at each corner, sampled
 * finely enough on the arcs that the sketcher sees a curve.
 *
 * Pure and exported for the test that holds the outline outside the box.
 */
export function roundedOutline(box: Box, radius: number, pad: number): Point[] {
  const x0 = box.x - pad;
  const y0 = box.y - pad;
  const x1 = box.x + box.width + pad;
  const y1 = box.y + box.height + pad;
  const r = Math.max(0, Math.min(radius + pad, (x1 - x0) / 2, (y1 - y0) / 2));
  const corners: Array<[number, number, number]> = [
    [x1 - r, y0 + r, -Math.PI / 2],
    [x1 - r, y1 - r, 0],
    [x0 + r, y1 - r, Math.PI / 2],
    [x0 + r, y0 + r, Math.PI],
  ];
  const STEPS = 6;
  const out: Point[] = [];
  for (const [cx, cy, from] of corners) {
    for (let i = 0; i <= STEPS; i++) {
      const a = from + (i / STEPS) * (Math.PI / 2);
      out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
  }
  return out;
}

/** How far outside the spotlight's edge the tour's pen outline runs. */
export const OUTLINE_PAD = 9;

/**
 * The tour's mark: a pen line round the spotlight's own shape.
 *
 * An ellipse fits a button and fails a toolbar: round the dock, an ellipse that
 * clears the middle cuts across both ends. Following the cut-out keeps the
 * mark outside the element on every shape, a pill or an 800px dock alike.
 */
export function outlinePath(box: Box, radius: number, stepId: string): string {
  return roughLoop(roundedOutline(box, radius, OUTLINE_PAD), {
    seed: seedFrom(`outline:${stepId}`),
    level: 'medium',
    width: 2,
  });
}

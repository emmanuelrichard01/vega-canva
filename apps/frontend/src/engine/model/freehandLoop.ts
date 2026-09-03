import type { Point } from './schema';

/**
 * Whether a freehand stroke came back to where it started.
 *
 * ## What "closed" means for a pencil
 *
 * `perfect-freehand` emits a filled outline polygon rather than a line, so the
 * *outline* is always a closed shape — that is not the question. The question
 * is whether the **centreline** loops, which is the only sense in which a
 * pencil stroke has an inside for a fill to land in.
 *
 * ## Why it is not simply "the ends are close"
 *
 * Two short back-and-forth scribbles end near where they began, and neither
 * encloses anything. A tap ends exactly where it began. So the gap has to be
 * small *relative to the stroke*, not small in absolute terms — a loop the size
 * of a full stop and a loop the size of the board both close, and a two-inch
 * zigzag that happens to finish near its start does not.
 *
 * Three conditions, and each rules out a real case:
 *
 * - **Enough points.** A tap and a flick have no shape to enclose.
 * - **The ends are within reach of the nib.** A gap the pen itself would cover
 *   is one a person would call closed; the floor keeps a hairline from needing
 *   sub-pixel accuracy to count.
 * - **The stroke travelled much further than the gap.** This is the one that
 *   does the work: it is what separates a loop from a line that wandered back.
 */
export function isClosedLoop(points: Point[], nib: number): boolean {
  if (points.length < 8) return false;

  const first = points[0];
  const last = points[points.length - 1];
  const gap = Math.hypot(last.x - first.x, last.y - first.y);

  // A gap the pen would cover looks joined, because at that size it is.
  const reach = Math.max(10, nib * 2);
  if (gap > reach) return false;

  let travelled = 0;
  for (let i = 1; i < points.length; i += 1) {
    travelled += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }

  // Six times is the ratio a genuine loop clears easily — a circle's
  // circumference against a gap the width of its own line is far more than
  // that — and a there-and-back stroke never does, because its travel is only
  // twice its own length.
  return travelled > Math.max(reach * 6, gap * 6);
}

/**
 * The centreline as a closed path, for filling the area a loop encloses.
 *
 * The *centreline*, not the outline: the outline is the edge of the ink, and
 * filling it would paint the stroke's own body rather than the region inside
 * the loop. The two differ by half the nib all the way round, which is exactly
 * the overlap that makes the fill meet the ink with no seam between them.
 */
export function loopPath(points: Point[]): string {
  if (points.length < 3) return '';
  const parts = [`M${points[0].x} ${points[0].y}`];
  for (let i = 1; i < points.length; i += 1) parts.push(`L${points[i].x} ${points[i].y}`);
  parts.push('Z');
  return parts.join(' ');
}

import { describe, expect, it } from 'vitest';
import { shapeFill, HACHURE_ANGLE, type FillStyle } from './rough';

/**
 * The scribble fill, which is the one shading style drawn as a single
 * continuous stroke rather than as a set of separate ones.
 *
 * That continuity is the whole look and it is also the only thing here that
 * can be wrong in a way hachure cannot: hachure's spans are independent, so a
 * concave shape costs it nothing, while a scribble has to decide what the pen
 * does when the row it is running along splits in two.
 *
 * The answer it used to give was to join them, which drew the pen straight
 * across the gap — outside the shape. These tests are about that.
 */

/** A square, where every row is one span and nothing can go wrong. */
const square = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

/**
 * A U, whose middle rows are two spans with a wide gap between them.
 *
 * The notch is deliberately deep and wide: 40 units of empty space between the
 * two legs, from y=0 down to y=70, so a stroke crossing it is unmistakable
 * rather than a rounding error.
 */
const notched = [
  { x: 0, y: 0 },
  { x: 30, y: 0 },
  { x: 30, y: 70 },
  { x: 70, y: 70 },
  { x: 70, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

const fill = (points: { x: number; y: number }[], over: Record<string, unknown> = {}) =>
  shapeFill(points, {
    seed: 11,
    style: 'zigzag' as FillStyle,
    level: 'medium',
    // Straight across, so a span is a horizontal run and "inside the notch" is
    // a plain arithmetic question rather than a rotated one.
    angle: 0,
    ...over,
  });

/** Every coordinate pair in a path, control points included. */
function pointsOf(d: string): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const re = /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) out.push({ x: Number(m[1]), y: Number(m[2]) });
  return out;
}

/**
 * Samples along every straight and quadratic run in the path.
 *
 * The endpoints alone are not enough: the failure being pinned is a stroke
 * that *crosses* the notch, and both of its ends are legitimately inside the
 * shape. It is the middle of that stroke that is outside, so the middle has to
 * be looked at.
 */
function sampled(d: string): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const sub of d.split('M').filter((s) => s.trim())) {
    const pts = pointsOf(sub);
    if (pts.length < 2) continue;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      for (let t = 0; t <= 1; t += 0.1) {
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
  }
  return out;
}

describe('the pen stays inside the shape', () => {
  it('shades a square, which is the case that always worked', () => {
    const d = fill(square);
    expect(d.length).toBeGreaterThan(0);
    // Two spans per row would mean the scanline is finding phantom crossings.
    expect((d.match(/M/g) ?? []).length).toBeGreaterThan(3);
  });

  it('does not cross the notch of a concave shape', () => {
    /**
     * The defect, stated as arithmetic: between y=0 and y=70 the region
     * 30 < x < 70 is outside the shape. A single `prevPoint` carried across
     * spans joined the end of the left leg to the start of the right one on
     * every row, so this count was one stroke per row rather than zero.
     *
     * The margin is what the turns are allowed: a hairpin bulges outward past
     * the end of its row on purpose, the same overshoot every corner in this
     * file gets, so the test asks that nothing reaches the *middle* of the gap
     * rather than that nothing leaves the outline at all.
     */
    const d = fill(notched);
    const inside = sampled(d).filter(
      (p) => p.y > 4 && p.y < 66 && p.x > 42 && p.x < 58
    );
    expect(inside, `${inside.length} samples crossed the notch`).toHaveLength(0);
  });

  it('shades both legs of it, rather than avoiding the problem by drawing less', () => {
    // The cheap way to pass the test above is to stop chaining at all, or to
    // shade only one span per row. Both legs must actually be filled.
    const pts = sampled(fill(notched));
    expect(pts.some((p) => p.x < 28 && p.y < 60), 'the left leg is unshaded').toBe(true);
    expect(pts.some((p) => p.x > 72 && p.y < 60), 'the right leg is unshaded').toBe(true);
  });

  it('still joins the rows where there is no gap to cross', () => {
    /**
     * The continuity is the point of the style, so it has to be asserted and
     * not merely not-broken. A chained row is joined by a quadratic; a fill of
     * nothing but separate strokes would have none.
     */
    expect(fill(square)).toContain('Q');
  });
});

describe('the turn between rows', () => {
  it('grows with the gap, so a dense scribble turns tightly', () => {
    /**
     * Density and amplitude in step. A turn sized absolutely would loop as far
     * on a dense fill as on a light one, and at 5.5 units of spacing that is a
     * loop bigger than the rows it joins.
     */
    const light = fill(square, { density: 'light' });
    const dense = fill(square, { density: 'dense' });
    const spread = (d: string) => {
      const xs = sampled(d).map((p) => p.x);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(spread(dense)).toBeLessThan(spread(light));
  });

  it('differs in character across the three levels', () => {
    const light = fill(square, { level: 'light' });
    const heavy = fill(square, { level: 'heavy' });
    expect(light).not.toBe(heavy);
  });
});

describe('the scribble is still shading', () => {
  it('answers the shared angle like every other style', () => {
    expect(fill(square, { angle: 0 })).not.toBe(fill(square, { angle: 45 }));
    expect(shapeFill(square, { seed: 11, style: 'zigzag', level: 'medium' })).toBe(
      shapeFill(square, { seed: 11, style: 'zigzag', level: 'medium', angle: HACHURE_ANGLE })
    );
  });

  it('is stable for one seed, because a sketch is drawn once and shared', () => {
    // The canvas and the exporter both call this. Two draws from the same
    // distribution would be two different objects, not one in two files.
    expect(fill(square)).toBe(fill(square));
  });

  it('draws nothing for a degenerate outline', () => {
    expect(fill([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe('');
  });
});

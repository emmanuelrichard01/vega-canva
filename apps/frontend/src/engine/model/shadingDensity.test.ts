import { describe, expect, it } from 'vitest';
import { shapeFill, SHADING_DENSITIES, type FillStyle } from './rough';

/**
 * The density control, checked at more than one shape size.
 *
 * `shading.test.ts` asserts that `dense` and `light` differ, on a 100-unit
 * square, and that assertion was true while the control was doing nothing on
 * most real shapes. Stipple derived a spacing floor from the shape's diagonal
 * and took the looser of that and the density's own gap — so the floor grew
 * with the shape and swallowed the control:
 *
 * ```text
 *              light   medium   dense
 *   200x140    23.10    15.26   15.26
 *   300x200    23.10    22.53   22.53
 *   600x400    40.00    40.00   40.00
 * ```
 *
 * A test that fixes the shape cannot see any of that. So these run over a
 * range of sizes, which is the only difference between them and the ones that
 * passed throughout.
 */

const box = (w: number, h: number) => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
];

const marks = (d: string) => (d.match(/M/g) ?? []).length;

const shade = (style: FillStyle, w: number, h: number, density: 'light' | 'medium' | 'dense') =>
  shapeFill(box(w, h), { seed: 3, style, level: 'medium', density, angle: 0 });

/** The sizes a board actually holds, not one convenient square. */
const SIZES: [number, number][] = [
  [100, 100],
  [200, 140],
  [300, 200],
  [600, 400],
];

describe('density is a real control at every shape size', () => {
  for (const style of ['hachure', 'crosshatch', 'zigzag', 'dots'] as FillStyle[]) {
    for (const [w, h] of SIZES) {
      it(`${style} at ${w}x${h} lays more marks as it gets denser`, () => {
        const light = marks(shade(style, w, h, 'light'));
        const medium = marks(shade(style, w, h, 'medium'));
        const dense = marks(shade(style, w, h, 'dense'));

        expect(light, 'nothing was drawn at all').toBeGreaterThan(0);
        // Strictly, at every size. `dots` returned exactly equal counts for
        // two of the three settings on three of these four shapes.
        expect(medium, `${style} ${w}x${h}: light ${light} medium ${medium}`).toBeGreaterThan(light);
        expect(dense, `${style} ${w}x${h}: medium ${medium} dense ${dense}`).toBeGreaterThan(medium);
      });
    }
  }
});

describe('the count stays bounded on a large shape', () => {
  it('opens the stipple spacing rather than drawing without limit', () => {
    /**
     * The cap the diagonal floor was there to provide, said as what it is: a
     * budget on the number of dots. It has to still exist — this is one path
     * parsed every frame — but it may only engage where the count is genuinely
     * a problem, which is the difference between a cap and an override.
     */
    const huge = marks(shade('dots', 4000, 3000, 'dense'));
    expect(huge).toBeLessThanOrEqual(2600);
    expect(huge).toBeGreaterThan(500);
  });

  it('leaves ordinary shapes well under it, so the cap never engages there', () => {
    // If the cap were engaging at these sizes it would be an override again.
    for (const [w, h] of SIZES) {
      expect(marks(shade('dots', w, h, 'dense')), `${w}x${h}`).toBeLessThan(2000);
    }
  });
});

describe('the strokes stay far enough apart to read as strokes', () => {
  /**
   * The other half of the coupling, at the opposite end of the range.
   *
   * Each hachure stroke is nudged off its scanline at both ends, and that
   * nudge was an absolute unit while the gap ranges from 5.5 to 14. At
   * `dense` a pair leaning toward each other closed to 3.5 units — under the
   * four the density docstring names as where strokes merge into a flat tone
   * and the drawn quality is lost.
   */
  const ys = (d: string) => {
    const out: number[] = [];
    // The first coordinate pair of each subpath, which is where the stroke
    // starts — enough to see the spacing between consecutive scanlines.
    for (const sub of d.split('M').filter((s) => s.trim())) {
      const m = /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/.exec(sub);
      if (m) out.push(Number(m[2]));
    }
    return out.sort((a, b) => a - b);
  };

  /**
   * The invariant, stated as the coupling rather than as a number.
   *
   * An absolute floor is the wrong bar and would be the same mistake again:
   * "no closer than four units" is satisfiable at `dense` only by removing the
   * wander altogether, which trades merged strokes for ruled ones. What has to
   * hold is that the wander is a *fraction* of the spacing, so the closest two
   * neighbours ever come is the same proportion of the gap at every density.
   *
   * Two thirds is what the construction gives: each end strays by `gap * 0.09`
   * plus half the tempered profile offset, itself capped at `gap * 0.16`, so a
   * pair leaning together closes at most a third of the gap between them.
   * Before the fix this read 0.44 at dense and 0.79 at light — one number
   * serving a range it could not span.
   */
  for (const density of SHADING_DENSITIES) {
    it(`keeps dense-packed ${density} strokes proportionally apart`, () => {
      const nominal = { light: 14, medium: 9, dense: 5.5 }[density];
      const seen = ys(shade('hachure', 300, 300, density));
      let closest = Infinity;
      for (let i = 1; i < seen.length; i++) {
        const d = seen[i] - seen[i - 1];
        if (d > 0.001) closest = Math.min(closest, d);
      }
      const share = closest / nominal;
      expect(share, `closest approach was ${share.toFixed(2)} of the gap`).toBeGreaterThan(0.6);
    });
  }

  it('still visibly wanders at the light end, where a fixed unit read as nothing', () => {
    // The same constant that was too large at `dense` was seven per cent of
    // the spacing at `light`, so the loosest setting looked ruled. A fraction
    // of the gap has to be *bigger* here, not merely smaller there.
    const seen = ys(shade('hachure', 300, 300, 'light'));
    const gaps: number[] = [];
    for (let i = 1; i < seen.length; i++) gaps.push(seen[i] - seen[i - 1]);
    const spread = Math.max(...gaps) - Math.min(...gaps);
    expect(spread, 'the scanlines are evenly ruled').toBeGreaterThan(1);
  });
});

import { describe, expect, it } from 'vitest';
import {
  cornerRadiiOf,
  fitRadii,
  isPerCorner,
  isUniform,
  packRadii,
  roundedRectPath,
  type CornerRadii,
} from './cornerRadii';

/**
 * One field, two forms, one reader.
 *
 * The alternative design — `cornerRadius: number` plus a separate
 * `cornerRadii?: [4]` — is two places to store one fact, and `DATA-MODEL.md`
 * opens with what that cost this project the last time: a size in three
 * places, read with different precedence in six modules. So everything goes
 * through `cornerRadiiOf`, and these are the properties that has to have.
 */

describe('cornerRadiiOf answers four, whatever it was given', () => {
  it('spreads a single number across all four', () => {
    expect(cornerRadiiOf(8)).toEqual([8, 8, 8, 8]);
  });

  it('treats absent as square', () => {
    expect(cornerRadiiOf(undefined)).toEqual([0, 0, 0, 0]);
  });

  it('passes the four through in order', () => {
    expect(cornerRadiiOf([1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
  });

  it('never returns a negative radius', () => {
    // A negative radius is not a shape; it is an argument the renderer would
    // pass straight to Konva, which draws something arbitrary rather than
    // refusing.
    expect(cornerRadiiOf(-5)).toEqual([0, 0, 0, 0]);
    expect(cornerRadiiOf([-1, 2, -3, 4])).toEqual([0, 2, 0, 4]);
  });
});

describe('packRadii keeps the simple form simple', () => {
  it('collapses four equal radii to one number', () => {
    /**
     * The reason nothing has to migrate: a document written before per-corner
     * existed holds a number, and a shape that never gets independent corners
     * keeps holding one. The array form only appears when it is doing work.
     */
    expect(packRadii([6, 6, 6, 6])).toBe(6);
  });

  it('drops the field entirely when every corner is square', () => {
    // Absent rather than zero, so a shape with no rounding carries no key —
    // which is what makes `Appearance` diffs small and the normalizer's job
    // "did anyone ever set this" rather than "is it zero".
    expect(packRadii([0, 0, 0, 0])).toBeUndefined();
  });

  it('keeps the four when they differ', () => {
    expect(packRadii([1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
  });

  it('round-trips through the reader', () => {
    for (const input of [[0, 0, 0, 0], [5, 5, 5, 5], [1, 2, 3, 4], [9, 0, 0, 9]] as CornerRadii[]) {
      expect(cornerRadiiOf(packRadii(input))).toEqual(input);
    }
  });
});

describe('isUniform is derived, never stored', () => {
  it('reads the value rather than a flag beside it', () => {
    /**
     * The link toggle in the panel reflects this, so a shape whose corners
     * differ shows as unlinked without anything having to remember that it
     * does. A stored flag would be a second fact to keep in step with the
     * geometry — which is the whole reason the model has one field.
     */
    expect(isUniform(8)).toBe(true);
    expect(isUniform(undefined)).toBe(true);
    expect(isUniform([4, 4, 4, 4])).toBe(true);
    expect(isUniform([4, 4, 4, 5])).toBe(false);
  });

  it('knows which form it is looking at', () => {
    expect(isPerCorner([1, 2, 3, 4])).toBe(true);
    expect(isPerCorner(6)).toBe(false);
    expect(isPerCorner(undefined)).toBe(false);
  });
});

describe('fitRadii scales a pair against the edge they share', () => {
  it('leaves radii that already fit alone', () => {
    expect(fitRadii([10, 10, 10, 10], 200, 100)).toEqual([10, 10, 10, 10]);
  });

  it('lets one corner be large when its neighbour is small', () => {
    /**
     * The rule `min(r, w/2, h/2)` is right for a *uniform* radius and too
     * strict once the four differ: a 200×40 box carries a 40-unit top-left
     * corner perfectly well as long as the top-right one is small, because
     * what competes is a **pair sharing an edge**, not each corner against the
     * whole box.
     */
    const [tl] = fitRadii([40, 0, 0, 0], 200, 40);
    expect(tl).toBe(40);
  });

  it('scales the whole set when a pair overflows its edge', () => {
    // Both scaled by the same ratio, as SVG's `rx` and CSS `border-radius`
    // both do. Capping each corner on its own gives a shape whose corners are
    // individually legal and whose edges have negative length — a bow-tie.
    const out = fitRadii([80, 80, 0, 0], 100, 100);
    expect(out[0]).toBeCloseTo(50, 6);
    expect(out[1]).toBeCloseTo(50, 6);
  });

  it('takes the worst edge, not the first one it finds', () => {
    const out = fitRadii([50, 50, 50, 50], 100, 40);
    // The vertical pairs are the tighter constraint here, and they govern all
    // four — otherwise the horizontal edges would still be legal and the
    // vertical ones would invert.
    expect(out[0]).toBeCloseTo(20, 6);
  });

  it('survives a zero-sized box', () => {
    expect(fitRadii([10, 10, 10, 10], 0, 0).every(Number.isFinite)).toBe(true);
  });
});

describe('roundedRectPath', () => {
  it('closes, and starts on the top edge', () => {
    const d = roundedRectPath(0, 0, 100, 60, [8, 8, 8, 8]);
    expect(d.startsWith('M8 0')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
  });

  it('omits the arc where a corner is square', () => {
    // A zero-radius arc is a degenerate command some renderers draw and others
    // ignore, so a square corner is simply a corner.
    const d = roundedRectPath(0, 0, 100, 60, [0, 0, 0, 0]);
    expect(d).not.toContain('A');
  });

  it('draws four different corners', () => {
    const d = roundedRectPath(0, 0, 100, 100, [4, 8, 12, 16]);
    for (const r of [4, 8, 12, 16]) expect(d).toContain(`A${r} ${r}`);
  });

  it('fits before it draws, so it cannot invert', () => {
    // Handed radii that cannot fit, it scales rather than producing an edge of
    // negative length.
    const d = roundedRectPath(0, 0, 40, 40, [100, 100, 100, 100]);
    expect(d).toContain('A20 20');
  });
});

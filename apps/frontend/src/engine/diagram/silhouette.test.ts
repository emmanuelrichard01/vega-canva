import { describe, it, expect } from 'vitest';
import { silhouetteFor, clampRadius } from './silhouette';
import { SHAPE_SPECS, type MermaidShape } from './mermaid';

const ALL = Object.keys(SHAPE_SPECS) as MermaidShape[];

describe('the preview cannot disagree with the board', () => {
  /**
   * Two things draw a diagram: `build.ts` makes canvas nodes and the modal
   * makes SVG. They shared geometry and sizes but not the silhouette -- the
   * preview carried its own `switch (shape)` ending in `case 'rect': default:`
   * and three of the fourteen shapes had no case. `trapezoid`, `trapezoid_inv`
   * and `flag` fell through, so for the same source, side by side, the board
   * drew a polygon and the preview drew a rectangle.
   *
   * This is the guard. Whatever `SHAPE_SPECS` gains, the preview draws.
   */
  it('draws every shape the board knows about', () => {
    expect(ALL.length).toBeGreaterThanOrEqual(14);
    for (const shape of ALL) {
      expect(silhouetteFor(shape), shape).toBeDefined();
    }
  });

  it('never silently turns a polygon into a rectangle', () => {
    // The exact defect. These three were the casualties.
    for (const shape of ['trapezoid', 'trapezoid_inv', 'flag'] as MermaidShape[]) {
      expect(silhouetteFor(shape).kind, shape).toBe('polygon');
    }
  });

  it('agrees with SHAPE_SPECS on the base kind of every shape', () => {
    for (const shape of ALL) {
      const spec = SHAPE_SPECS[shape];
      const sil = silhouetteFor(shape);
      expect(sil.kind, shape).toBe(spec.kind);
      if (sil.kind === 'polygon') {
        expect(sil.points, shape).toBe(spec.points ?? 4);
      }
      if (sil.kind === 'rect') {
        expect(sil.cornerRadius, shape).toBe(spec.cornerRadius ?? 0);
      }
    }
  });

  it('carries ornament only on top of the base the board draws', () => {
    /**
     * The preview draws things the canvas has no vocabulary for -- a ring, the
     * bars of a subroutine, a database lid. That is allowed, and it is why
     * ornament is a separate field: the outline underneath still has to be the
     * one the board renders, or the addition becomes a substitution.
     */
    const ring = silhouetteFor('double_circle');
    expect(ring.kind).toBe('ellipse');
    expect(ring.kind === 'ellipse' && ring.ornament).toBe('ring');

    const bars = silhouetteFor('subroutine');
    expect(bars.kind).toBe('rect');
    expect(bars.kind === 'rect' && bars.ornament).toBe('bars');

    const cyl = silhouetteFor('database');
    expect(cyl.kind).toBe('rect');
    expect(cyl.kind === 'rect' && cyl.ornament).toBe('cylinder');
  });

  it('leaves a plain rect plain', () => {
    const rect = silhouetteFor('rect');
    expect(rect).toEqual({ kind: 'rect', cornerRadius: 0 });
  });
});

describe('clampRadius', () => {
  it('resolves the stadium\'s deliberately absurd radius to semicircular ends', () => {
    // `SHAPE_SPECS.stadium` asks for 999 and means "as round as it goes". The
    // canvas renderer clamps it; so does this, or the two ends disagree about
    // what fully rounded means.
    expect(clampRadius(999, 200, 56)).toBe(28);
    expect(clampRadius(999, 56, 200)).toBe(28);
  });

  it('leaves a radius that already fits', () => {
    expect(clampRadius(10, 200, 56)).toBe(10);
    expect(clampRadius(0, 200, 56)).toBe(0);
  });
});

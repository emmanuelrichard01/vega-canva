import { describe, expect, it } from 'vitest';
import { seedFor, seedFrom } from './rough';
import { roughShape } from './roughShape';
import type { ShapeNode } from './schema';

/**
 * A sketch is stable *and* directable.
 *
 * The seed comes from the node id, and that is what stops an outline crawling
 * on every re-render — which here is every selection, drag and presence
 * update. `sketchSeed` adds a second way to ask for a different drawing
 * without giving any of that up, and these are the properties that has to
 * have.
 */

const shape = (id: string, sketchSeed?: number) =>
  ({
    id,
    geometry: { kind: 'rect' } as ShapeNode['geometry'],
    width: 120,
    height: 80,
    appearance: { sketch: 'medium' as const, sketchSeed },
  }) as Parameters<typeof roughShape>[0];

describe('seedFor mixes rather than replaces', () => {
  it('leaves the original drawing alone', () => {
    // Absent and zero both mean "the first one", so nothing drawn before this
    // field existed changes.
    expect(seedFor('node-1')).toBe(seedFrom('node-1'));
    expect(seedFor('node-1', 0)).toBe(seedFrom('node-1'));
  });

  it('gives a different seed for each variant', () => {
    const seen = new Set([1, 2, 3, 4, 5].map((v) => seedFor('node-1', v)));
    expect(seen.size).toBe(5);
    expect(seen.has(seedFrom('node-1'))).toBe(false);
  });

  it('keeps two shapes different at the same variant', () => {
    /**
     * The property the mixing exists for. Replacing the id's hash with the
     * variant would make every shape redrawn `n` times draw *identically* — so
     * redrawing a selection of six rectangles would turn them into six copies
     * of one rectangle, which is the opposite of a hand-drawn effect.
     */
    for (const v of [1, 2, 7]) {
      expect(seedFor('node-a', v)).not.toBe(seedFor('node-b', v));
    }
  });

  it('stays a 32-bit unsigned integer', () => {
    // It feeds a `>>> 0` PRNG; a float or a negative would still produce
    // *something*, which is how a seed silently stops being the seed.
    for (const v of [1, 99, 2 ** 31]) {
      const s = seedFor('node-1', v);
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('is deterministic', () => {
    // The whole point survives: for any given variant the drawing is exactly
    // as fixed as it ever was, across renders, reloads and machines.
    expect(seedFor('node-1', 3)).toBe(seedFor('node-1', 3));
  });
});

describe('a redraw reaches the drawing', () => {
  it('changes the outline', () => {
    const before = roughShape(shape('n1'), false).outline;
    const after = roughShape(shape('n1', 1), false).outline;
    expect(before).not.toBe(after);
    expect(before.length).toBeGreaterThan(0);
    expect(after.length).toBeGreaterThan(0);
  });

  it('draws the same thing twice for one variant', () => {
    expect(roughShape(shape('n1', 4), false).outline).toBe(
      roughShape(shape('n1', 4), false).outline,
    );
  });

  it('leaves an unredrawn shape exactly as it was', () => {
    expect(roughShape(shape('n1'), false).outline).toBe(
      roughShape(shape('n1', 0), false).outline,
    );
  });

  it('keeps two shapes distinct after the same number of redraws', () => {
    expect(roughShape(shape('n1', 2), false).outline).not.toBe(
      roughShape(shape('n2', 2), false).outline,
    );
  });
});

import { SHAPE_PARAMS } from './shapeParams';
import { DEFAULT_STAR_RATIO, type ShapeKind } from './schema';
import { describe, expect, it } from 'vitest';
import { swapShapeKind } from './shapeSwap';
import type { ShapeGeometry } from './schema';

const wavyArrow: ShapeGeometry = {
  kind: 'arrow',
  a: { x: 0, y: 0 },
  b: { x: 100, y: 0 },
  vertices: [{ x: 0, y: 0 }, { x: 50, y: 20 }, { x: 100, y: 0 }],
  bends: [{ u: 0.5, v: 0.3 }, null],
  lineProfile: 'wavy',
  lineWaves: 8,
  lineAmplitude: 1.4,
  endAlign: 'extend',
  endStart: 'circle',
  endEnd: 'arrow',
  endScale: 1.5,
};

describe('swapping a line to a closed shape', () => {
  it('leaves nothing of the run behind', () => {
    /**
     * The bug: `{ ...geometry, kind }` kept every line-only field on the
     * rectangle. It renders nowhere, so it looks harmless -- and then swapping
     * back restores endpoints that are local to a box which has since been
     * resized, putting the line somewhere it has never been.
     */
    const rect = swapShapeKind(wavyArrow, 'rect');
    expect(rect).toEqual({ kind: 'rect' });
  });

  it('drops a star\'s inner radius on the way to a plain shape', () => {
    const star: ShapeGeometry = { kind: 'star', points: 6, innerRatio: 0.3 };
    expect(swapShapeKind(star, 'ellipse')).toEqual({ kind: 'ellipse' });
  });
});

describe('swapping between counted shapes', () => {
  it('carries the count across, so a hexagon becomes a six-pointed star', () => {
    // Which is what keeps the swap feeling like a change of form rather than
    // a reset.
    const hexagon: ShapeGeometry = { kind: 'polygon', points: 6 };
    expect(swapShapeKind(hexagon, 'star')).toMatchObject({ kind: 'star', points: 6 });
  });

  it('gives a star an inner radius when it arrives without one', () => {
    expect(swapShapeKind({ kind: 'polygon', points: 5 }, 'star').innerRatio).toBe(
      DEFAULT_STAR_RATIO
    );
  });

  it('takes the caller\'s count over the stored one', () => {
    // The picker offers named counts -- "pentagon" -- and the model stores one
    // `polygon` with a number.
    expect(swapShapeKind({ kind: 'polygon', points: 6 }, 'polygon', 5).points).toBe(5);
  });
});

describe('swapping between line and arrow', () => {
  it('keeps the whole run, corners and curves included', () => {
    /**
     * They differ only in which cap they default to, which is the entire reason
     * they are one kind with a cap setting rather than two geometries. A swap
     * between them that moved the line would make that a lie.
     */
    const line = swapShapeKind(wavyArrow, 'line');
    expect(line.vertices).toEqual(wavyArrow.vertices);
    expect(line.bends).toEqual(wavyArrow.bends);
    expect(line.lineProfile).toBe('wavy');
    expect(line.lineWaves).toBe(8);
    expect(line.endScale).toBe(1.5);
  });

  it('copies rather than sharing the run', () => {
    // The geometry goes into a CRDT patch; handing it the caller's arrays would
    // let a later local edit mutate what was written.
    const line = swapShapeKind(wavyArrow, 'line');
    expect(line.vertices).not.toBe(wavyArrow.vertices);
    expect(line.vertices![0]).not.toBe(wavyArrow.vertices![0]);
  });

  it('gives an arrow a head when it has none', () => {
    // Picking "arrow" and getting a headless line would make the control look
    // broken.
    const plain: ShapeGeometry = { kind: 'line', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } };
    expect(swapShapeKind(plain, 'arrow').endEnd).toBe('arrow');
  });

  it('does not strip a cap on the way to a line', () => {
    /**
     * Deliberately asymmetric. Caps are independently editable, so silently
     * throwing away a chosen diamond terminator is a bigger surprise than a
     * line that happens to have one.
     */
    const diamond: ShapeGeometry = { kind: 'arrow', endEnd: 'diamond' };
    expect(swapShapeKind(diamond, 'line').endEnd).toBe('diamond');
  });
});

describe('swapping a closed shape to a line', () => {
  it('starts from nothing, so the box is what draws it', () => {
    /**
     * There is no run to carry. `localVertices` falls back to the legacy
     * corner-to-corner form, which is the honest reading of "make this
     * rectangle a line".
     */
    const line = swapShapeKind({ kind: 'rect' }, 'line');
    expect(line).toEqual({ kind: 'line' });
  });

  it('still gives an arrow its head', () => {
    expect(swapShapeKind({ kind: 'ellipse' }, 'arrow')).toEqual({ kind: 'arrow', endEnd: 'arrow' });
  });
});

describe('swapping to and from advanced parametric shapes', () => {
  it('swaps to donut with the hole the table describes', () => {
    const donut = swapShapeKind({ kind: 'rect' }, 'donut');
    expect(donut.innerRatio).toBe(SHAPE_PARAMS.donut!.params[0].fallback);
  });

  it('swaps to badge carrying count from polygon or star', () => {
    const fromStar = swapShapeKind({ kind: 'star', points: 16, innerRatio: 0.8 }, 'badge');
    expect(fromStar).toEqual({ kind: 'badge', points: 16, innerRatio: 0.8 });
  });

  it('swaps to callout with default tail configuration', () => {
    const callout = swapShapeKind({ kind: 'ellipse' }, 'callout');
    expect(callout).toEqual({ kind: 'callout', tailPosition: 'bottom-left', tailSize: 16 });
  });

  it('cleanses callout-specific fields when swapping away to rect or diamond', () => {
    const diamond = swapShapeKind({ kind: 'callout', tailPosition: 'top-left', tailSize: 0.3 }, 'diamond');
    expect(diamond).toEqual({ kind: 'diamond' });
  });

  /**
   * Against the table, not against a literal.
   *
   * These asserted the numbers by hand, and one of them had been wrong for as
   * long as it existed: it expected six pins where a freshly drawn chip got
   * three, so it *documented* the drift instead of catching it. A swap seeds
   * whatever `SHAPE_PARAMS` says the shape draws untouched — that is the whole
   * claim — and stating the number twice here would put the fourth copy back.
   */
  it.each(
    Object.entries(SHAPE_PARAMS).map(([kind, group]) => [kind, group] as const)
  )('seeds every dial %s declares, at the value the table gives', (kind, group) => {
    const swapped = swapShapeKind({ kind: 'rect' }, kind as ShapeKind);
    for (const dial of group.params) {
      expect(swapped[dial.field], `${kind}.${dial.field}`).toBe(dial.fallback);
    }
  });

  it('carries a dial across a swap rather than reseeding it', () => {
    const held = swapShapeKind({ kind: 'cylinder', rimRatio: 0.35 }, 'database');
    expect(held.rimRatio).toBe(0.35);
  });
});


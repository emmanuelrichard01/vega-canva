import { describe, expect, it } from 'vitest';
import { defaultSpec } from './gridLayout';
import { defaultStyle } from './gridStyle';
import {
  cellGeometry,
  cellPatch,
  recipeCells,
  variantsOf,
  VARIANT_MODES,
  withSpec,
  withStyle,
  type GridRecipe,
} from './gridBuild';

const recipe = (over: Partial<GridRecipe['spec']> = {}, style: Partial<GridRecipe['style']> = {}): GridRecipe => ({
  spec: { ...defaultSpec({ x: 0, y: 0, width: 300, height: 300 }), kind: 'modular', rows: 3, columns: 3, ...over },
  style: { ...defaultStyle(), ...style },
});

describe('cellPatch', () => {
  it('maps every cell shape onto a real shape kind', () => {
    for (const shape of ['rect', 'ellipse', 'triangle', 'hexagon', 'star', 'diamond'] as const) {
      const cells = recipeCells(recipe({ rows: 1, columns: 1 }, { shapes: [shape] }));
      const patch = cellPatch(cells[0], defaultStyle()) as { geometry: { kind: string; points?: number } };
      expect(patch.geometry.kind).toBeTruthy();
      if (shape !== 'rect' && shape !== 'ellipse') expect(patch.geometry.points).toBeGreaterThan(2);
    }
  });

  it('never writes id, zIndex or parentId', () => {
    // Those belong to the document. A builder that set them would make
    // re-laying a grid silently restack it.
    const patch = cellPatch(recipeCells(recipe())[0], defaultStyle());
    for (const key of ['id', 'zIndex', 'parentId']) expect(patch).not.toHaveProperty(key);
  });

  it('omits the stroke block entirely at zero width', () => {
    // A zero-width stroke is not a thin stroke, it is no stroke — and writing
    // one leaves the properties panel showing a stroke of nothing.
    const cells = recipeCells(recipe());
    const bare = cellPatch(cells[0], { ...defaultStyle(), strokeWidth: 0 }) as { appearance: Record<string, unknown> };
    expect(bare.appearance.stroke).toBeUndefined();

    const drawn = cellPatch(cells[0], { ...defaultStyle(), strokeWidth: 2, strokeColor: '#000' }) as {
      appearance: { stroke?: { width: number } };
    };
    expect(drawn.appearance.stroke?.width).toBe(2);
  });

  it('rounds corners only on rectangles', () => {
    // The radius comes from the *cell*, which is where it was clamped against
    // that cell's own size — reading it off the style again here would be a
    // second, unclamped answer to the same question.
    const rectStyle = { ...defaultStyle(), shapes: ['rect' as const], radius: 8 };
    const round = cellPatch(recipeCells({ ...recipe(), style: rectStyle })[0], rectStyle) as {
      appearance: { cornerRadius?: number };
    };
    expect(round.appearance.cornerRadius).toBe(8);

    const ovalStyle = { ...defaultStyle(), shapes: ['ellipse' as const], radius: 8 };
    const oval = cellPatch(recipeCells({ ...recipe(), style: ovalStyle })[0], ovalStyle) as {
      appearance: { cornerRadius?: number };
    };
    expect(oval.appearance.cornerRadius).toBeUndefined();
  });

  it('carries the fill the palette assigned', () => {
    const patch = cellPatch(recipeCells(recipe({}, { palette: ['#ABCDEF'], colorMode: 'solid' }))[0], defaultStyle()) as {
      appearance: { fill: { color: string }[] };
    };
    expect(patch.appearance.fill[0].color).toBe('#ABCDEF');
  });
});

describe('cellGeometry', () => {
  it('previews a cell as the shape the document will actually get', () => {
    /**
     * The picker drew every cell as a rectangle and special-cased the ellipse,
     * so a grid of hexagons previewed as a grid of squares -- you chose the
     * tile you liked and got something else. One mapping, read by both, is the
     * only thing that keeps a preview honest.
     */
    for (const shape of ['rect', 'ellipse', 'triangle', 'hexagon', 'star', 'diamond'] as const) {
      const cell = recipeCells(recipe({ rows: 1, columns: 1 }, { shapes: [shape] }))[0];
      const written = (cellPatch(cell, defaultStyle()) as { geometry: { kind: string; points?: number } }).geometry;
      const previewed = cellGeometry(cell);
      expect(previewed.kind, shape).toBe(written.kind);
      expect(previewed.points, shape).toBe(written.points);
    }
  });
});


describe('withSpec and withStyle', () => {
  it('changes one field and re-rolls nothing', () => {
    // A spread that forgets `seed` re-rolls the whole grid, invisibly, because
    // the change the user asked for also happened.
    const before = recipe({ seed: 42 }, { seed: 7 });
    const after = withSpec(before, { columns: 5 });
    expect(after.spec.seed).toBe(42);
    expect(after.style.seed).toBe(7);
    expect(after.spec.columns).toBe(5);
  });

  it('leaves the layout alone when only the style changes', () => {
    const before = recipe();
    const after = withStyle(before, { radius: 20 });
    expect(after.spec).toEqual(before.spec);
  });
});

describe('variantsOf', () => {
  const base = recipe({ kind: 'bento', rows: 4, columns: 4, variation: 0.7, seed: 1 }, { seed: 1 });

  it('offers a set to choose between, not one to accept', () => {
    // Re-rolling used to commit a change you could not see until it had
    // happened, so pressing twice lost the arrangement you liked.
    expect(variantsOf(base, 'arrangement', 1)).toHaveLength(5);
  });

  it('makes the tiles differ from each other, not just from the original', () => {
    /**
     * Incrementing a seed gives five consecutive draws, which on any decent
     * PRNG are unrelated but on a *layout* often land on similar arrangements.
     * Drawing all five from one stream spreads them, and a picker whose tiles
     * look alike is a picker worth nothing.
     */
    const seeds = variantsOf(base, 'arrangement', 4).map((v) => v.spec.seed);
    expect(new Set(seeds).size).toBe(5);
  });

  it('holds the layout exactly when only colour may vary', () => {
    // The point of the mode: you have settled the arrangement and you are
    // trying colour against it.
    for (const v of variantsOf(base, 'colour', 2)) {
      expect(v.spec).toEqual(base.spec);
    }
  });

  it('offers genuinely different layouts even where the seed does nothing', () => {
    /**
     * A modular grid has no randomness in it at all, so five re-seeds were five
     * identical tiles -- a picker showing one idea five times. Columns and
     * golden were the same. A layout variant may move the tracks and the dial,
     * which changes what the grid *is* while leaving it the same system.
     */
    for (const kind of ['modular', 'columns', 'golden'] as const) {
      const from = recipe({ kind });
      const shapes = variantsOf(from, 'arrangement', 5).map((v) => JSON.stringify(recipeCells(v)));
      expect(new Set(shapes).size, kind).toBeGreaterThan(1);
    }
  });

  it('keeps a layout variant inside its own system', () => {
    // Still a bento wall, genuinely a different bento wall.
    for (const v of variantsOf(recipe({ kind: 'bento' }), 'arrangement', 3)) {
      expect(v.spec.kind).toBe('bento');
    }
  });

  it('holds the palette when only the layout may vary', () => {
    for (const v of variantsOf(base, 'arrangement', 2)) {
      expect(v.style).toEqual(base.style);
    }
  });

  it('changes the system itself only in the broadest mode', () => {
    const kinds = new Set(variantsOf(base, 'everything', 6).map((v) => v.spec.kind));
    expect(kinds.size).toBeGreaterThan(1);
    for (const v of variantsOf(base, 'colour', 6)) expect(v.spec.kind).toBe(base.spec.kind);
  });

  it('is reproducible from its salt, so the tiles hold still', () => {
    // Regenerating on every render would move the tiles under the pointer:
    // you would go to click the third one and click something else.
    for (const mode of VARIANT_MODES) {
      expect(variantsOf(base, mode, 9)).toEqual(variantsOf(base, mode, 9));
    }
  });

  it('gives a different set for a different salt', () => {
    expect(variantsOf(base, 'arrangement', 1)).not.toEqual(variantsOf(base, 'arrangement', 2));
  });

  it('produces a drawable grid for every candidate', () => {
    // A blank tile in the picker is worse than no tile: it reads as a broken
    // option rather than an absent one.
    for (const mode of VARIANT_MODES) {
      for (const v of variantsOf(base, mode, 3)) {
        expect(recipeCells(v).length).toBeGreaterThan(0);
      }
    }
  });
});


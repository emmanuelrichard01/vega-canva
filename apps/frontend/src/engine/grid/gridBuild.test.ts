import { describe, expect, it } from 'vitest';
import { defaultSpec, gridBounds, layoutGrid } from './gridLayout';
import { defaultStyle } from './gridStyle';
import {
  cellGeometry,
  cellPatch,
  planGridUpdate,
  recipeCells,
  refitBox,
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

const ids = (n: number) => Array.from({ length: n }, (_, i) => `n${i}`);

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

describe('planGridUpdate', () => {
  it('updates in place when the count is unchanged', () => {
    // Recreating them would break connectors bound to those ids and turn one
    // adjustment into nine deletions in the history.
    const plan = planGridUpdate(recipe({ rows: 3, columns: 3 }), ids(9));
    expect(plan.update).toHaveLength(9);
    expect(plan.create).toHaveLength(0);
    expect(plan.remove).toHaveLength(0);
  });

  it('creates only the surplus when the grid grows', () => {
    const plan = planGridUpdate(recipe({ rows: 4, columns: 3 }), ids(9));
    expect(plan.update).toHaveLength(9);
    expect(plan.create).toHaveLength(3);
    expect(plan.remove).toHaveLength(0);
  });

  it('removes only the excess when the grid shrinks', () => {
    const plan = planGridUpdate(recipe({ rows: 2, columns: 3 }), ids(9));
    expect(plan.update).toHaveLength(6);
    expect(plan.remove).toEqual(['n6', 'n7', 'n8']);
  });

  it('builds the whole grid from nothing', () => {
    const plan = planGridUpdate(recipe(), []);
    expect(plan.create).toHaveLength(9);
    expect(plan.update).toHaveLength(0);
  });

  it('keeps cell order, so index n is always the same cell', () => {
    const plan = planGridUpdate(recipe({ rows: 2, columns: 2 }), ids(4));
    const xs = plan.update.map((u) => u.changes.x as number);
    expect(xs[0]).toBeLessThan(xs[1]);
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

describe('refitBox', () => {
  /** Where a recipe says its cells belong. */
  const expected = (r: GridRecipe) => gridBounds(layoutGrid(r.spec));

  it('returns the recipe unchanged when nothing moved', () => {
    // The property the measuring version could not have, and the reason the
    // grid used to shrink a little on every edit.
    const before = recipe();
    expect(refitBox(before, expected(before), expected(before))).toBe(before);
  });

  it('leaves a layout that does not fill its box alone', () => {
    // Manuscript stands its block in air, so its cells' bounds are *smaller*
    // than the spec's box. Re-deriving the box from them shrank the grid — and
    // then shrank it again on the next edit, and the next.
    const before = recipe({ kind: 'manuscript', variation: 1 });
    const cells = expected(before)!;
    expect(cells.width).toBeLessThan(before.spec.width);
    expect(refitBox(before, cells, cells).spec).toEqual(before.spec);
  });

  it('does not shrink under repeated edits', () => {
    // The bug, stated directly: four adjustments used to walk the grid in from
    // its own edges.
    let r = recipe({ kind: 'radial', rows: 2, columns: 8 });
    const started = r.spec.width;
    for (let i = 0; i < 5; i += 1) r = refitBox(r, expected(r), expected(r));
    expect(r.spec.width).toBeCloseTo(started, 6);
  });

  it('carries a move into the box', () => {
    const before = recipe();
    const cells = expected(before)!;
    const moved = { ...cells, x: cells.x + 120, y: cells.y - 40 };
    const after = refitBox(before, cells, moved);
    expect(after.spec.x).toBeCloseTo(before.spec.x + 120, 6);
    expect(after.spec.y).toBeCloseTo(before.spec.y - 40, 6);
    expect(after.spec.width).toBeCloseTo(before.spec.width, 6);
  });

  it('carries a resize into the box, by the same factor', () => {
    const before = recipe();
    const cells = expected(before)!;
    const scaled = { x: cells.x, y: cells.y, width: cells.width * 2, height: cells.height * 0.5 };
    const after = refitBox(before, cells, scaled);
    expect(after.spec.width).toBeCloseTo(before.spec.width * 2, 6);
    expect(after.spec.height).toBeCloseTo(before.spec.height * 0.5, 6);
  });

  it('round-trips exactly for a layout that scales affinely', () => {
    // What makes the transform the right answer rather than an approximation:
    // refit the box, re-lay the grid, and the cells are where they were put.
    const before = recipe({ kind: 'modular' });
    const cells = expected(before)!;
    const scaled = { x: cells.x + 30, y: cells.y, width: cells.width * 1.5, height: cells.height };
    const after = refitBox(before, cells, scaled);
    const now = expected(after)!;
    expect(now.x).toBeCloseTo(scaled.x, 4);
    expect(now.width).toBeCloseTo(scaled.width, 4);
  });

  it('is stable, not exact, for a layout that does not scale affinely', () => {
    /**
     * `manuscript` insets its block by a fraction of `min(width, height)`, so
     * stretching only the width does not stretch the inset with it. No affine
     * correction can round-trip that, and pretending otherwise would mean
     * inventing a per-kind inverse for every layout.
     *
     * What has to hold is the weaker and more important property: refitting an
     * untouched grid changes nothing, so repeated edits cannot accumulate a
     * drift. Exactness is a nicety; stability is the bug that was reported.
     */
    let r = recipe({ kind: 'manuscript', variation: 1 });
    const cells = expected(r)!;
    r = refitBox(r, cells, { ...cells, width: cells.width * 1.5 });
    const settled = { ...r.spec };
    for (let i = 0; i < 5; i += 1) r = refitBox(r, expected(r), expected(r));
    expect(r.spec.width).toBeCloseTo(settled.width, 6);
  });

  it('keeps everything but the box', () => {
    const before = recipe({ kind: 'bento', seed: 9 });
    const cells = expected(before)!;
    const after = refitBox(before, cells, { ...cells, x: cells.x + 100 });
    expect(after.spec.kind).toBe('bento');
    expect(after.spec.seed).toBe(9);
    expect(after.style).toEqual(before.style);
  });

  it('survives a grid with no cells at all', () => {
    const before = recipe();
    expect(refitBox(before, null, null)).toBe(before);
  });
});

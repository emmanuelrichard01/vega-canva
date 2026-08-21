import { describe, expect, it } from 'vitest';
import { defaultSpec, gridBounds, layoutGrid } from './gridLayout';
import { defaultStyle } from './gridStyle';
import {
  cellPatch,
  planGridUpdate,
  recipeCells,
  refitBox,
  reroll,
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

describe('reroll', () => {
  it('moves the layout without touching the palette', () => {
    // Keeping an arrangement you liked while trying colours against it is most
    // of what anyone does with a generator.
    const before = recipe({ seed: 1 }, { seed: 1 });
    const after = reroll(before, 'layout');
    expect(after.spec.seed).not.toBe(before.spec.seed);
    expect(after.style.seed).toBe(before.style.seed);
  });

  it('moves the palette without touching the layout', () => {
    const before = recipe({ seed: 1 }, { seed: 1 });
    const after = reroll(before, 'colour');
    expect(after.spec.seed).toBe(before.spec.seed);
    expect(after.style.seed).not.toBe(before.style.seed);
  });

  it('moves both when asked', () => {
    const after = reroll(recipe({ seed: 1 }, { seed: 1 }), 'both');
    expect(after.spec.seed).toBe(2);
    expect(after.style.seed).toBe(2);
  });

  it('actually produces a different arrangement', () => {
    const before = recipe({ kind: 'bento', rows: 5, columns: 5, variation: 1, seed: 1 });
    expect(recipeCells(reroll(before, 'layout'))).not.toEqual(recipeCells(before));
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

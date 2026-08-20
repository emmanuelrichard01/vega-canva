import { describe, expect, it } from 'vitest';
import { defaultSpec } from './gridLayout';
import { defaultStyle } from './gridStyle';
import {
  cellPatch,
  planGridUpdate,
  recipeCells,
  refit,
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

describe('refit', () => {
  it('rewrites the box so the recipe and the objects agree', () => {
    // The transformer scales the nodes; without this the next gutter change
    // snaps everything back to where the grid used to be.
    const after = refit(recipe(), { x: 100, y: 50, width: 800, height: 200 });
    expect(after.spec).toMatchObject({ x: 100, y: 50, width: 800, height: 200 });
    const cells = recipeCells(after);
    expect(Math.min(...cells.map((c) => c.x))).toBeCloseTo(100, 0);
  });

  it('keeps everything else', () => {
    const before = recipe({ kind: 'bento', seed: 9 });
    const after = refit(before, { x: 0, y: 0, width: 100, height: 100 });
    expect(after.spec.kind).toBe('bento');
    expect(after.spec.seed).toBe(9);
    expect(after.style).toEqual(before.style);
  });
});

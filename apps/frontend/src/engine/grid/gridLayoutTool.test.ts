import { describe, it, expect } from 'vitest';
import { layoutGrid, type GridSpec } from './gridLayout';
import { applySpans, mergeSpans, resolveTracks, spansFromModules, splitSpan, normalizeSpans, normalizeTracks } from './gridTracks';
import { normalizeRecipe, gridCellsOf } from './gridNode';
import { fitInCell, intrinsicHeight, isSlottable, planGridReflow, planGridUpdate, planHugRows } from './gridReflow';
import { clusterAxis, planArrangement, arrangementRecipe } from './arrangeInGrid';
import { assignSlots, freeCellsFrom } from './gridSlot';
import { DEFAULT_TYPOGRAPHY, type AnyNode, type GridNode } from '../model/schema';

function spec(over: Partial<GridSpec> = {}): GridSpec {
  return {
    kind: 'modular',
    x: 0,
    y: 0,
    width: 300,
    height: 200,
    rows: 2,
    columns: 3,
    gutterX: 0,
    gutterY: 0,
    margin: 0,
    variation: 0,
    seed: 1,
    ...over,
  };
}

function gridNode(specOver: Record<string, unknown> = {}, box = { width: 300, height: 200 }): GridNode {
  return {
    id: 'g',
    type: 'grid',
    x: 0,
    y: 0,
    ...box,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    zIndex: 0,
    locked: false,
    hidden: false,
    createdBy: 'u',
    createdAt: 0,
    updatedAt: 0,
    grid: normalizeRecipe(
      { spec: { kind: 'modular', rows: 2, columns: 3, gutterX: 0, gutterY: 0, margin: 0, variation: 0, seed: 1, ...specOver } },
      box.width,
      box.height
    ),
  };
}

function node(type: string, over: Record<string, unknown> = {}): AnyNode {
  return {
    id: over.id ?? type,
    type,
    x: 0,
    y: 0,
    width: 40,
    height: 30,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    zIndex: 1,
    locked: false,
    hidden: false,
    createdBy: 'u',
    createdAt: 0,
    updatedAt: 0,
    ...(type === 'shape' ? { geometry: { kind: 'rect' } } : null),
    ...(type === 'text' ? { text: 'hello', typography: { ...DEFAULT_TYPOGRAPHY }, resize: 'fixed' } : null),
    ...over,
  } as unknown as AnyNode;
}

describe('tracks', () => {
  it('honours fixed sizes and shares the rest by fraction', () => {
    const t = resolveTracks(300, 3, 0, [{ px: 100 }, { fr: 1 }, { fr: 3 }]);
    expect(t.map((x) => x.size)).toEqual([100, 50, 150]);
    expect(t.map((x) => x.offset)).toEqual([0, 100, 150]);
  });

  it('sizes auto tracks from measurements and falls back to a share', () => {
    const t = resolveTracks(300, 3, 10, ['auto', 'auto', { fr: 1 }], [80]);
    expect(t[0].size).toBe(80);
    expect(t[1].size).toBeCloseTo((300 - 20 - 80) / 2);
  });

  it('scales fixed tracks down together when they overflow', () => {
    const t = resolveTracks(100, 2, 0, [{ px: 150 }, { px: 50 }]);
    expect(t[0].size + t[1].size).toBeCloseTo(100);
    expect(t[0].size / t[1].size).toBeCloseTo(3);
  });

  it('a modular grid with explicit tracks lays out exactly those tracks', () => {
    const cells = layoutGrid(spec({ tracks: { cols: [{ px: 50 }, { fr: 1 }, { fr: 1 }] } }));
    expect(cells[0].width).toBe(50);
    expect(cells[1].width).toBe(125);
    expect(cells.map((c) => c.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('normalises malformed tracks to shares', () => {
    expect(normalizeTracks([{ px: -1 }, 'auto', { fr: 2 }, 'x'])).toEqual([{ fr: 1 }, 'auto', { fr: 2 }, { fr: 1 }]);
    expect(normalizeTracks([])).toBeUndefined();
  });
});

describe('spans', () => {
  it('covers every track position exactly once', () => {
    const cells = applySpans(3, 3, { '0:0': { rows: 2, cols: 2 }, '1:1': { rows: 2, cols: 2 } });
    const covered = new Set<string>();
    for (const c of cells) {
      for (let r = c.row; r < c.row + c.rows; r += 1) {
        for (let k = c.col; k < c.col + c.cols; k += 1) {
          const key = `${r}:${k}`;
          expect(covered.has(key)).toBe(false);
          covered.add(key);
        }
      }
    }
    expect(covered.size).toBe(9);
  });

  it('a merged module keeps its anchor identity and its neighbours keep theirs', () => {
    const cells = layoutGrid(spec({ spans: { '0:1': { rows: 2, cols: 2 } } }));
    expect(cells.map((c) => c.index)).toEqual([0, 1, 3]);
    const merged = cells.find((c) => c.index === 1)!;
    expect(merged.width).toBe(200);
    expect(merged.height).toBe(200);
  });

  it('merge removes intersecting spans and split restores single modules', () => {
    const merged = mergeSpans({ '0:0': { rows: 2, cols: 1 } }, { row: 0, col: 0, rows: 1, cols: 3 });
    expect(merged).toEqual({ '0:0': { rows: 1, cols: 3 } });
    expect(splitSpan(merged, 0, 0)).toEqual({});
    expect(spansFromModules([{ row: 0, col: 0, rows: 2, cols: 2 }, { row: 0, col: 2, rows: 1, cols: 1 }])).toEqual({
      '0:0': { rows: 2, cols: 2 },
    });
  });

  it('drops malformed span keys and one-by-one spans', () => {
    expect(normalizeSpans({ '0:0': { rows: 1, cols: 1 }, bad: { rows: 2, cols: 2 }, '1:2': { rows: 2, cols: 1 } })).toEqual({
      '1:2': { rows: 2, cols: 1 },
    });
  });

  it('fills walk the module identities, skipping those a span covers', () => {
    const ids = layoutGrid(spec({ spans: { '0:0': { rows: 1, cols: 2 } } })).map((c) => c.index!);
    expect(ids).toEqual([0, 2, 3, 4, 5]);
    expect(assignSlots(ids, ['a', 'b'], new Set([0])).placed.map((p) => p.cell)).toEqual([2, 3]);
    expect(freeCellsFrom(ids, new Set(), 1)).toEqual([2, 3, 4, 5, 0]);
  });
});

describe('padding', () => {
  it('insets each side separately', () => {
    const cells = layoutGrid(spec({ rows: 1, columns: 1, padding: { top: 10, right: 20, bottom: 30, left: 40 } }));
    expect(cells[0]).toMatchObject({ x: 40, y: 10, width: 240, height: 160 });
  });
});

describe('fitting content in a module', () => {
  const cell = { x: 0, y: 0, width: 100, height: 80 };

  it('pictures and text take the whole module whatever the alignment', () => {
    expect(fitInCell(node('image') as never, cell, { x: 'center', y: 'center' })).toEqual(cell);
    expect(fitInCell(node('text') as never, cell, { x: 'start', y: 'end' })).toEqual(cell);
  });

  it('stretched content fills; aligned content keeps its own size', () => {
    expect(fitInCell(node('shape') as never, cell)).toEqual(cell);
    expect(fitInCell(node('shape') as never, cell, { x: 'end', y: 'start' })).toEqual({ x: 60, y: 0, width: 40, height: 30 });
    expect(fitInCell(node('chart') as never, cell, { x: 'center', y: 'stretch' })).toEqual({ x: 30, y: 0, width: 40, height: 80 });
  });

  it('a sticky stays square and centred', () => {
    expect(fitInCell(node('sticky') as never, cell)).toEqual({ x: 10, y: 0, width: 80, height: 80 });
  });

  it('content larger than the module is clamped to it', () => {
    const big = node('shape', { width: 500, height: 500 });
    expect(fitInCell(big as never, cell, { x: 'center', y: 'center' })).toEqual(cell);
  });

  it('lines, connectors, frames and grids cannot sit in a module', () => {
    expect(isSlottable(node('shape', { geometry: { kind: 'line' } }))).toBe(false);
    expect(isSlottable(node('connector'))).toBe(false);
    expect(isSlottable(node('frame'))).toBe(false);
    expect(isSlottable(node('grid'))).toBe(false);
    expect(isSlottable(node('chart'))).toBe(true);
    expect(isSlottable(node('sticky'))).toBe(true);
  });

  it('reflows any slottable type onto its module', () => {
    const g = gridNode();
    const chart = node('chart', { id: 'c', gridSlot: { gridId: 'g', cell: 4 } });
    const patches = planGridReflow(g, [chart as never]);
    expect(patches[0].changes).toMatchObject({ x: 100, y: 100, width: 100, height: 100 });
    // Idempotent: applying the patch leaves nothing to do.
    const placed = { ...chart, ...patches[0].changes };
    expect(planGridReflow(g, [placed as never])).toEqual([]);
  });
});

describe('hug rows', () => {
  const measure = () => 150;

  it('rows grow to the tallest content and the grid height follows', () => {
    const g = gridNode({ sizing: 'hug', rows: 2, columns: 2, gutterY: 10 });
    const text = node('text', { id: 't', gridSlot: { gridId: 'g', cell: 0 } });
    const result = planHugRows(g, [text as never], measure);
    expect(result).not.toBeNull();
    const rows = result!.grid.grid.spec.tracks!.rows!;
    expect(rows[0]).toEqual({ px: 150 });
    // The empty row keeps the height it had (half of 200 less the gutter).
    expect((rows[1] as { px: number }).px).toBe(95);
    expect(result!.grid.height).toBe(150 + 95 + 10);
  });

  it('is stable once applied', () => {
    const g = gridNode({ sizing: 'hug', rows: 1, columns: 2 });
    const text = node('text', { id: 't', gridSlot: { gridId: 'g', cell: 0 } });
    const first = planHugRows(g, [text as never], measure)!;
    expect(planHugRows(first.grid, [text as never], measure)).toBeNull();
  });

  it('only content with a height of its own sizes a row', () => {
    const align = { x: 'stretch', y: 'stretch' } as const;
    expect(intrinsicHeight(node('shape') as never, 100, align)).toBeNull();
    expect(intrinsicHeight(node('shape') as never, 100, { x: 'center', y: 'center' })).toBe(30);
    expect(intrinsicHeight(node('sticky') as never, 120, align)).toBe(120);
  });

  it('the update patches the grid first, then places content against the new rows', () => {
    const g = gridNode({ sizing: 'hug', rows: 1, columns: 2 });
    const text = node('text', { id: 't', gridSlot: { gridId: 'g', cell: 1 } });
    const patches = planGridUpdate(g, [text as never], measure);
    expect(patches[0].id).toBe('g');
    expect(patches[1].changes).toMatchObject({ height: 150 });
  });

  it('a fixed grid never changes its own size', () => {
    expect(planHugRows(gridNode(), [], measure)).toBeNull();
  });
});

describe('arrange in grid', () => {
  it('clusters centres by gaps larger than half an object', () => {
    expect(clusterAxis([0, 5, 100, 104, 300], 40)).toEqual({ of: [0, 0, 1, 1, 2], count: 3 });
  });

  const items = [
    { id: 'a', cx: 50, cy: 50, width: 80, height: 60 },
    { id: 'b', cx: 160, cy: 52, width: 80, height: 60 },
    { id: 'c', cx: 48, cy: 150, width: 80, height: 60 },
    { id: 'd', cx: 158, cy: 148, width: 80, height: 60 },
  ];

  it('infers rows, columns and gutters from positions', () => {
    const plan = planArrangement(items)!;
    expect(plan.rows).toBe(2);
    expect(plan.columns).toBe(2);
    expect(plan.cells).toEqual({ a: 0, b: 1, c: 2, d: 3 });
    expect(plan.gutterX).toBe(28);
    expect(plan.gutterY).toBe(36);
  });

  it('does not depend on selection order', () => {
    expect(planArrangement([...items].reverse())).toEqual(planArrangement(items));
  });

  it('moves a contested object to the nearest free module', () => {
    const plan = planArrangement([...items, { id: 'e', cx: 52, cy: 49, width: 80, height: 60 }])!;
    const cells = Object.values(plan.cells);
    expect(new Set(cells).size).toBe(5);
    expect(plan.rows * plan.columns).toBeGreaterThanOrEqual(5);
  });

  it('lays out as a guide-mode modular grid whose modules hold each object', () => {
    const plan = planArrangement(items)!;
    const { box, recipe } = arrangementRecipe(plan);
    expect(recipe.style.mode).toBe('guide');
    expect(recipe.spec.contentAlign).toEqual({ x: 'center', y: 'center' });
    const cells = gridCellsOf({ width: box.width, height: box.height, grid: recipe });
    expect(cells).toHaveLength(4);
  });

  it('needs two objects', () => {
    expect(planArrangement([items[0]])).toBeNull();
  });
});

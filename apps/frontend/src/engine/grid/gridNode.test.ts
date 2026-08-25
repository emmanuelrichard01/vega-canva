import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { defaultSpec } from './gridLayout';
import { defaultStyle } from './gridStyle';
import { explodeGrid, gridCellsOf, gridSpecFor, normalizeRecipe } from './gridNode';
import { migrateGridGroups } from './gridMigrate';
import type { GridRecipe } from './gridBuild';

const recipe = (over: Partial<GridRecipe['spec']> = {}): GridRecipe => ({
  spec: { ...defaultSpec({ x: 0, y: 0, width: 300, height: 300 }), rows: 3, columns: 3, ...over },
  style: defaultStyle(),
});

const node = (over: Partial<{ x: number; y: number; width: number; height: number; grid: GridRecipe }> = {}) => ({
  x: 0,
  y: 0,
  width: 300,
  height: 300,
  grid: recipe(),
  ...over,
});

describe('gridSpecFor', () => {
  /**
   * The whole reason this node type exists.
   *
   * Under the group model a grid's box lived in two places -- on the recipe and
   * implicitly in the members' positions -- and every gesture had to keep them
   * equal by hand. This asserts that there is now no second copy to keep: give
   * the spec a box that flatly contradicts the node's and the node's wins,
   * without anyone having to reconcile anything.
   */
  it('takes its box from the node, never from the stored spec', () => {
    const n = node({
      x: 900,
      y: -400,
      width: 640,
      height: 200,
      grid: recipe({ x: 12, y: 34, width: 56, height: 78 }),
    });

    expect(gridSpecFor(n)).toMatchObject({ x: 0, y: 0, width: 640, height: 200 });
  });

  it('lays out in the node\'s own coordinates, so a move is not a re-lay', () => {
    const at = (x: number, y: number) => gridCellsOf(node({ x, y })).map((c) => [c.x, c.y]);
    expect(at(0, 0)).toEqual(at(5000, -3000));
  });
});

describe('gridCellsOf', () => {
  it('re-lays at the new size rather than scaling the modules', () => {
    const small = gridCellsOf(node({ width: 300, height: 300 }));
    const wide = gridCellsOf(node({ width: 600, height: 300 }));

    // The gutter is an absolute measurement chosen against the page. Doubling
    // the box must not double it -- that was the bug the old resize path
    // existed to work around, and it is now simply not reachable.
    const gapOf = (cells: typeof small) => {
      const row = cells.filter((c) => c.row === cells[0].row).sort((a, b) => a.x - b.x);
      return Math.round(row[1].x - (row[0].x + row[0].width));
    };
    expect(gapOf(wide)).toBe(gapOf(small));
    expect(wide[0].width).toBeGreaterThan(small[0].width);
  });

  it('stays inside the box it was given', () => {
    const n = node({ width: 400, height: 250 });
    for (const cell of gridCellsOf(n)) {
      expect(cell.x).toBeGreaterThanOrEqual(-0.001);
      expect(cell.y).toBeGreaterThanOrEqual(-0.001);
      expect(cell.x + cell.width).toBeLessThanOrEqual(400.001);
      expect(cell.y + cell.height).toBeLessThanOrEqual(250.001);
    }
  });
});

describe('explodeGrid', () => {
  it('places the shapes exactly where the grid drew them', () => {
    const n = node({ x: 120, y: -60 });
    const cells = gridCellsOf(n);
    const shapes = explodeGrid(n);

    expect(shapes).toHaveLength(cells.length);
    shapes.forEach((s, i) => {
      expect(s.type).toBe('shape');
      expect(s.x).toBeCloseTo(120 + cells[i].x, 6);
      expect(s.y).toBeCloseTo(-60 + cells[i].y, 6);
      expect(s.width).toBeCloseTo(cells[i].width, 6);
    });
  });
});

describe('normalizeRecipe', () => {
  it('produces a layable grid from nothing at all', () => {
    const r = normalizeRecipe(undefined, 300, 200);
    expect(gridCellsOf({ width: 300, height: 200, grid: r }).length).toBeGreaterThan(0);
  });

  it.each([
    ['zero columns', { columns: 0 }],
    ['a negative row count', { rows: -4 }],
    ['NaN gutters', { gutterX: NaN, gutterY: NaN }],
    ['an unknown system', { kind: 'spiral' }],
  ])('survives %s', (_label, spec) => {
    const r = normalizeRecipe({ spec }, 300, 200);
    const cells = gridCellsOf({ width: 300, height: 200, grid: r });
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) {
      expect(Number.isFinite(c.x) && Number.isFinite(c.width)).toBe(true);
    }
  });

  it('discards the box the stored spec claims', () => {
    const r = normalizeRecipe({ spec: { x: 9, y: 9, width: 9, height: 9 } }, 480, 360);
    expect(r.spec).toMatchObject({ x: 0, y: 0, width: 480, height: 360 });
  });
});

describe('migrateGridGroups', () => {
  /** A document in the old shape: one group carrying a recipe, four members. */
  function legacyDoc() {
    const doc = new Y.Doc();
    const nodes = doc.getMap<Y.Map<unknown>>('objects');
    const groups = doc.getMap<Record<string, unknown>>('groups');

    groups.set('g1', { id: 'g1', grid: recipe() });
    [
      { id: 'a', x: 100, y: 100, width: 90, height: 90 },
      { id: 'b', x: 200, y: 100, width: 90, height: 90 },
      { id: 'c', x: 100, y: 200, width: 90, height: 90 },
      { id: 'd', x: 200, y: 200, width: 90, height: 90 },
    ].forEach((m) => {
      const y = new Y.Map<unknown>();
      Object.entries({ ...m, type: 'shape', parentId: 'g1', zIndex: 3 }).forEach(([k, v]) => y.set(k, v));
      nodes.set(m.id, y);
    });
    return { doc, nodes, groups };
  }

  it('folds a grid group into one node that covers the same ground', () => {
    const { doc, nodes, groups } = legacyDoc();
    expect(migrateGridGroups(doc, nodes, groups)).toBe(1);

    expect(groups.size).toBe(0);
    expect(nodes.size).toBe(1);

    const grid = nodes.get('g1')!;
    expect(grid.get('type')).toBe('grid');
    // The members' bounds, not the recipe's own box: where they disagree, what
    // is on the screen is the truth.
    expect(grid.get('x')).toBe(100);
    expect(grid.get('y')).toBe(100);
    expect(grid.get('width')).toBe(190);
    expect(grid.get('height')).toBe(190);
  });

  it('is idempotent, because two peers may both run it', () => {
    const { doc, nodes, groups } = legacyDoc();
    migrateGridGroups(doc, nodes, groups);
    const after = nodes.get('g1')!.toJSON();

    expect(migrateGridGroups(doc, nodes, groups)).toBe(0);
    expect(nodes.get('g1')!.toJSON()).toEqual(after);
  });

  it('leaves a document with no grids untouched', () => {
    const doc = new Y.Doc();
    const nodes = doc.getMap<Y.Map<unknown>>('objects');
    const groups = doc.getMap<Record<string, unknown>>('groups');
    groups.set('plain', { id: 'plain' });

    expect(migrateGridGroups(doc, nodes, groups)).toBe(0);
    expect(groups.size).toBe(1);
  });

  it('clears away a grid group with nothing left in it', () => {
    const doc = new Y.Doc();
    const nodes = doc.getMap<Y.Map<unknown>>('objects');
    const groups = doc.getMap<Record<string, unknown>>('groups');
    groups.set('empty', { id: 'empty', grid: recipe() });

    migrateGridGroups(doc, nodes, groups);
    expect(groups.size).toBe(0);
    expect(nodes.size).toBe(0);
  });
});

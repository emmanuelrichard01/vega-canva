import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { normalizeRecipe, gridCellsOf } from './gridNode';
import { currentTrackSizes, pinnedRecipe, remapSlots, withBorderMoved, withEvenTracks, withTrack } from './gridEdit';
import { planGridUpdate } from './gridReflow';
import { blockBetween } from './gridEditMode';
import { axisBands, guideEdges } from '../model/layoutGuide';
import { DEFAULT_TYPOGRAPHY, type AnyNode, type GridNode } from '../model/schema';

function grid(spec: Record<string, unknown> = {}, box = { width: 300, height: 200 }): GridNode {
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
      { spec: { kind: 'modular', rows: 2, columns: 3, gutterX: 0, gutterY: 0, margin: 0, variation: 0, seed: 1, ...spec } },
      box.width,
      box.height
    ),
  };
}

describe('track edits', () => {
  it('reads the current track sizes off the layout', () => {
    expect(currentTrackSizes(grid(), 'cols')).toEqual([100, 100, 100]);
    expect(currentTrackSizes(grid(), 'rows')).toEqual([100, 100]);
  });

  it('changing one track pins the others to their current size', () => {
    const g = grid({ variation: 0.8 });
    const before = gridCellsOf(g).filter((c) => c.row === 0).map((c) => c.width);
    const recipe = withTrack(g, 'cols', 0, { px: 60 });
    const after = gridCellsOf({ ...g, grid: recipe }).filter((c) => c.row === 0).map((c) => c.width);
    expect(after[0]).toBe(60);
    // The other two keep their proportion to each other.
    expect(after[1] / after[2]).toBeCloseTo(before[1] / before[2], 1);
  });

  it('moving a border trades size between the two tracks only', () => {
    const recipe = withBorderMoved(grid(), 'cols', 0, 40);
    const widths = gridCellsOf({ ...grid(), grid: recipe }).filter((c) => c.row === 0).map((c) => c.width);
    expect(widths[0]).toBeCloseTo(140);
    expect(widths[1]).toBeCloseTo(60);
    expect(widths[2]).toBeCloseTo(100);
  });

  it('a border cannot squeeze a track below the minimum', () => {
    const recipe = withBorderMoved(grid(), 'cols', 0, 500);
    const widths = gridCellsOf({ ...grid(), grid: recipe }).filter((c) => c.row === 0).map((c) => c.width);
    expect(widths[1]).toBeGreaterThanOrEqual(8);
  });

  it('a border drag never writes NaN, zero or negative tracks and keeps the total', () => {
    const total = (r: ReturnType<typeof withBorderMoved>) =>
      (r.spec.tracks?.cols ?? []).reduce((a, t) => a + ('fr' in (t as object) ? (t as { fr: number }).fr : 0), 0);
    const before = currentTrackSizes(grid(), 'cols').reduce((a, b) => a + b, 0);
    for (const delta of [Infinity, -Infinity, 622, -622, 1e9, 0]) {
      const recipe = withBorderMoved(grid(), 'cols', 0, delta);
      for (const t of recipe.spec.tracks?.cols ?? []) {
        const fr = (t as { fr: number }).fr;
        expect(Number.isFinite(fr)).toBe(true);
        expect(fr).toBeGreaterThanOrEqual(1);
      }
      const widths = gridCellsOf({ ...grid(), grid: recipe }).filter((c) => c.row === 0).map((c) => c.width);
      widths.forEach((w) => expect(w).toBeGreaterThan(0));
      if (recipe.spec.tracks) expect(total(recipe)).toBeGreaterThan(0);
      expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(before, 0);
    }
  });

  it('a NaN delta changes nothing', () => {
    const g = grid();
    expect(withBorderMoved(g, 'rows', 0, NaN)).toBe(g.grid);
  });

  it('the recipe survives normalisation after a border drag', () => {
    const recipe = withBorderMoved(grid(), 'cols', 0, 622);
    const again = normalizeRecipe(recipe, 300, 200);
    expect(again.spec.tracks?.cols?.length).toBe(3);
    expect(again.spec.width).toBe(300);
  });

  it('even tracks removes the explicit sizes', () => {
    const g = { ...grid(), grid: withTrack(grid(), 'cols', 0, { px: 60 }) };
    expect(withEvenTracks(g, 'cols').spec.tracks).toBeUndefined();
  });
});

describe('keeping content in its module', () => {
  it('renumbers content by position when module identities change', () => {
    const before = [
      { index: 0, row: 0, col: 0 },
      { index: 1, row: 0, col: 1 },
      { index: 2, row: 1, col: 0 },
    ];
    // One more column: the second row now starts at 3.
    const after = [
      { index: 0, row: 0, col: 0 },
      { index: 1, row: 0, col: 1 },
      { index: 3, row: 1, col: 0 },
    ];
    expect(remapSlots(before, after, [{ id: 'a', cell: 2 }, { id: 'b', cell: 1 }])).toEqual([
      { id: 'a', changes: { cell: 3 } },
    ]);
  });

  it('a pinned bento grid draws the same modules as the seeded one', () => {
    const bento = grid({ kind: 'bento', rows: 4, columns: 4, variation: 0.9, seed: 7, gutterX: 8, gutterY: 8 });
    const pinned = { ...bento, grid: pinnedRecipe(bento) };
    expect(pinned.grid.spec.kind).toBe('modular');
    const a = gridCellsOf(bento).map((c) => [Math.round(c.x), Math.round(c.y), Math.round(c.width), Math.round(c.height)]);
    const b = gridCellsOf(pinned).map((c) => [Math.round(c.x), Math.round(c.y), Math.round(c.width), Math.round(c.height)]);
    expect(b).toEqual(a);
  });
});

describe('block selection', () => {
  it('extends to cover both corners, including spans', () => {
    expect(blockBetween({ row: 2, col: 3 }, { row: 0, col: 1, rows: 2, cols: 1 })).toEqual({ row: 0, col: 1, rows: 3, cols: 3 });
  });
});

describe('frame layout guides', () => {
  it('stretch divides the space between the margins', () => {
    const bands = axisBands(1000, { count: 4, gutter: 20, margin: 50 });
    expect(bands[0]).toEqual({ start: 50, size: 210 });
  });

  it('aligned guides use a fixed track size', () => {
    const axis = { count: 3, gutter: 10, margin: 20, size: 100 };
    expect(axisBands(1000, { ...axis, align: 'start' })[0].start).toBe(20);
    expect(axisBands(1000, { ...axis, align: 'end' })[2]).toEqual({ start: 880, size: 100 });
    expect(axisBands(1000, { ...axis, align: 'center' })[0].start).toBe(340);
  });

  it('snapping includes each column centre', () => {
    const edges = guideEdges({ x: 0, y: 0, width: 100, height: 100 }, { columns: { count: 1, gutter: 0, margin: 0 } });
    expect(edges.x).toEqual([0, 50, 100]);
  });
});

describe('convergence', () => {
  /**
   * Two clients each run the planner over the same document and write what it
   * returns. Because the plan is a pure function of the document, both write
   * the same values, and the merged document is the same whichever order the
   * updates arrive in.
   */
  it('two clients reflowing the same grid converge', () => {
    const g = grid({ sizing: 'hug', rows: 1, columns: 2 });
    const text = {
      id: 't',
      type: 'text',
      x: 500,
      y: 500,
      width: 10,
      height: 10,
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
      text: 'A caption',
      typography: { ...DEFAULT_TYPOGRAPHY },
      resize: 'height',
      gridSlot: { gridId: 'g', cell: 1 },
    } as unknown as AnyNode;
    const measure = () => 120;

    const write = (d: Y.Doc) => {
      const map = d.getMap<Y.Map<unknown>>('objects');
      d.transact(() => {
        for (const patch of planGridUpdate(g, [text as never], measure)) {
          let entry = map.get(patch.id);
          if (!entry) {
            entry = new Y.Map();
            map.set(patch.id, entry);
          }
          for (const [k, v] of Object.entries(patch.changes)) entry.set(k, v as never);
        }
      });
    };

    const a = new Y.Doc();
    const b = new Y.Doc();
    const seed = new Y.Doc();
    const seedMap = seed.getMap<Y.Map<unknown>>('objects');
    seed.transact(() => {
      seedMap.set('g', new Y.Map());
      seedMap.set('t', new Y.Map());
    });
    const initial = Y.encodeStateAsUpdate(seed);
    Y.applyUpdate(a, initial);
    Y.applyUpdate(b, initial);

    write(a);
    write(b);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    const json = (d: Y.Doc) => JSON.stringify(d.getMap('objects').toJSON());
    expect(json(a)).toBe(json(b));
    const t = (a.getMap('objects').get('t') as Y.Map<unknown>).toJSON();
    expect(t).toMatchObject({ x: 150, y: 0, width: 150, height: 120, resize: 'fixed' });
  });
});

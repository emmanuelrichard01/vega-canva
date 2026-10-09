import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createNode, groupsMap, objectsMap, readAllNodes, readNode } from '../document';
import { setRoomRole } from '../model/permissions';
import { useStore } from '../../hooks/useStore';
import { DEFAULT_TYPOGRAPHY, type AnyNode, type GridNode, type TextNode } from '../model/schema';
import { gridCellsOf, normalizeRecipe } from './gridNode';
import {
  MIN_TRACK,
  autoFitTrackSize,
  recipeWithTrackSizes,
  resolveBorderDrag,
  trackRuns,
} from './gridTrackDrag';
import { commitTrackSizes, currentTrackSizes, grownBox, mergeCells } from './gridEdit';
import type { SlottableNode } from './gridReflow';

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

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

describe('border drag maths', () => {
  it('a plain drag trades size between the two neighbours only, total unchanged', () => {
    const r = resolveBorderDrag({ sizes: [100, 100, 100], index: 0, delta: 37 });
    expect(r.sizes).toEqual([137, 63, 100]);
    expect(r.growth).toBe(0);
    expect(sum(r.sizes)).toBe(300);
  });

  it('no track goes below the minimum, and a tiny pair splits evenly instead of inverting', () => {
    expect(resolveBorderDrag({ sizes: [100, 100, 100], index: 0, delta: 1e6 }).sizes[1]).toBe(MIN_TRACK);
    expect(resolveBorderDrag({ sizes: [100, 100, 100], index: 1, delta: -1e6 }).sizes[1]).toBe(MIN_TRACK);
    expect(resolveBorderDrag({ sizes: [5, 5, 100], index: 0, delta: 50 }).sizes.slice(0, 2)).toEqual([5, 5]);
  });

  it('non-finite deltas and out-of-range borders change nothing', () => {
    for (const delta of [NaN, Infinity, -Infinity]) {
      expect(resolveBorderDrag({ sizes: [100, 100], index: 0, delta }).sizes).toEqual([100, 100]);
    }
    expect(resolveBorderDrag({ sizes: [100, 100], index: 1, delta: 10 }).sizes).toEqual([100, 100]);
    expect(resolveBorderDrag({ sizes: [100, 100], index: -1, delta: 10 }).sizes).toEqual([100, 100]);
  });

  it('Shift sets the track and shares the rest equally', () => {
    const r = resolveBorderDrag({ sizes: [100, 50, 150, 100], index: 0, delta: 50, mode: 'equalize' });
    expect(r.sizes[0]).toBe(150);
    expect(r.sizes.slice(1)).toEqual([250 / 3, 250 / 3, 250 / 3]);
    expect(sum(r.sizes)).toBeCloseTo(400);
    // Clamped so every other track keeps the minimum.
    const big = resolveBorderDrag({ sizes: [100, 100, 100], index: 0, delta: 1e6, mode: 'equalize' });
    expect(big.sizes.slice(1)).toEqual([MIN_TRACK, MIN_TRACK]);
  });

  it('Alt grows the one track and the grid, leaving the others alone', () => {
    const r = resolveBorderDrag({ sizes: [100, 100, 100], index: 1, delta: 40, mode: 'grow' });
    expect(r.sizes).toEqual([100, 140, 100]);
    expect(r.growth).toBe(40);
    const shrink = resolveBorderDrag({ sizes: [100, 100, 100], index: 1, delta: -1e6, mode: 'grow' });
    expect(shrink.sizes[1]).toBe(MIN_TRACK);
    expect(shrink.growth).toBe(MIN_TRACK - 100);
  });

  it('snaps to an equal size first, then to round numbers, and not at all with snap 0', () => {
    // 100 + 47 = 147 is 3 from the third track's 150: equal wins.
    const eq = resolveBorderDrag({ sizes: [100, 100, 150], index: 0, delta: 47, snap: 6 });
    expect(eq.sizes[0]).toBe(150);
    expect(eq.snapped).toBe('equal');
    // Equal split of the pair (100) is a candidate too.
    expect(resolveBorderDrag({ sizes: [80, 120], index: 0, delta: 17, snap: 6 }).sizes).toEqual([100, 100]);
    const round = resolveBorderDrag({ sizes: [100, 100, 100], index: 0, delta: 28, snap: 6 });
    expect(round.sizes[0]).toBe(130);
    expect(round.snapped).toBe('round');
    const free = resolveBorderDrag({ sizes: [100, 100, 150], index: 0, delta: 47, snap: 0 });
    expect(free.sizes[0]).toBe(147);
    expect(free.snapped).toBeNull();
  });
});

describe('track runs', () => {
  it('reads tracks from the layout, so merged modules do not hide them', () => {
    const g = grid({ spans: { '0:0': { rows: 2, cols: 2 } } });
    // Only column 2 has a single-column module; the old module-reading guess
    // gave columns 0 and 1 a made-up size and both the same start.
    expect(currentTrackSizes(g, 'cols')).toEqual([100, 100, 100]);
    expect(trackRuns(g, 'cols').map((r) => r.start)).toEqual([0, 100, 200]);
    expect(trackRuns(g, 'rows').map((r) => r.start)).toEqual([0, 100]);
  });

  it('includes gutters and margins in where tracks start', () => {
    const g = grid({ gutterX: 10, margin: 5 });
    const runs = trackRuns(g, 'cols');
    expect(runs[0].start).toBe(5);
    expect(runs[1].start).toBeCloseTo(5 + runs[0].size + 10);
  });

  it('a border drag next to a merged module resizes the module with its tracks', () => {
    const g = grid({ spans: { '0:0': { rows: 1, cols: 2 } } });
    const sizes = resolveBorderDrag({ sizes: currentTrackSizes(g, 'cols'), index: 1, delta: 30 }).sizes;
    const next = { ...g, grid: recipeWithTrackSizes(g.grid, 'cols', sizes) };
    const merged = gridCellsOf(next).find((c) => c.row === 0 && c.col === 0)!;
    expect(merged.width).toBeCloseTo(230);
  });

  it('writes shares that survive normalisation on a very wide grid', () => {
    const wide = grid({ columns: 2, rows: 1 }, { width: 6000, height: 100 });
    const recipe = recipeWithTrackSizes(wide.grid, 'cols', [4500, 1500]);
    const again = normalizeRecipe(recipe, 6000, 100);
    const widths = gridCellsOf({ ...wide, grid: again }).map((c) => c.width);
    expect(widths[0]).toBeCloseTo(4500, 0);
    expect(widths[1]).toBeCloseTo(1500, 0);
  });
});

describe('auto-fit', () => {
  const text = (cell: number, body: string): SlottableNode =>
    ({
      id: `t${cell}`,
      type: 'text',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      text: body,
      resize: 'fixed',
      typography: { ...DEFAULT_TYPOGRAPHY },
      gridSlot: { gridId: 'g', cell },
    }) as unknown as SlottableNode;

  it('fits a column to its widest text and a row to its tallest', () => {
    const g = grid();
    const measure = {
      textWidth: (n: TextNode) => n.text.length * 10,
      textHeight: (n: TextNode) => n.text.split('\n').length * 20,
    };
    const items = [text(0, 'abcdefghijklmnop'), text(3, 'abc'), text(1, 'x\ny\nz')];
    expect(autoFitTrackSize(g, 'cols', 0, items, measure)).toBe(160);
    expect(autoFitTrackSize(g, 'rows', 0, items, measure)).toBe(60);
    // Nothing in column 2.
    expect(autoFitTrackSize(g, 'cols', 2, items, measure)).toBeNull();
  });

  it('ignores content in a merged module, which belongs to several tracks', () => {
    const g = grid({ spans: { '0:0': { rows: 1, cols: 2 } } });
    const measure = { textWidth: () => 500 };
    expect(autoFitTrackSize(g, 'cols', 0, [text(0, 'wide')], measure)).toBeNull();
  });

  it('fits a picture by its proportions', () => {
    const g = grid();
    const img = {
      id: 'i',
      type: 'image',
      naturalWidth: 400,
      naturalHeight: 200,
      gridSlot: { gridId: 'g', cell: 0 },
    } as unknown as SlottableNode;
    // A 100-tall row wants a 200-wide column for a 2:1 picture.
    expect(autoFitTrackSize(g, 'cols', 0, [img])).toBe(200);
  });
});

describe('growing the grid', () => {
  it('pins the top-left corner, also when turned', () => {
    expect(grownBox({ x: 10, y: 20, width: 100, height: 50, rotation: 0 }, 'cols', 30)).toEqual({
      x: 10,
      y: 20,
      width: 130,
      height: 50,
    });
    const turned = { x: 0, y: 0, width: 100, height: 50, rotation: 90 };
    const corner = (b: { x: number; y: number; width: number; height: number }) => {
      // Top-left after a 90° turn about the centre.
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      return { x: cx + b.height / 2, y: cy - b.width / 2 };
    };
    const after = grownBox(turned, 'cols', 40);
    expect(corner(after).x).toBeCloseTo(corner(turned).x);
    expect(corner(after).y).toBeCloseTo(corner(turned).y);
  });
});

describe('writing a border drag', () => {
  const sync = () => useStore.setState({ objects: readAllNodes() as unknown as Record<string, AnyNode> });
  beforeEach(() => {
    setRoomRole('editor');
    Array.from(objectsMap.keys()).forEach((k) => objectsMap.delete(k));
    sync();
  });

  const place = (spec: Record<string, unknown>) => {
    const g = grid(spec);
    createNode({ ...g, id: 'g' } as never);
    sync();
  };

  it('is one undo step, and never moves the grid', () => {
    place({});
    const undo = new Y.UndoManager([objectsMap, groupsMap], { captureTimeout: 0 });
    commitTrackSizes('g', 'cols', [150, 50, 100]);
    expect(undo.undoStack.length).toBe(1);
    const after = readNode('g') as unknown as GridNode;
    expect([after.x, after.y, after.width, after.height]).toEqual([0, 0, 300, 200]);
    sync();
    expect(currentTrackSizes(useStore.getState().objects.g as GridNode, 'cols').map(Math.round)).toEqual([150, 50, 100]);
    undo.destroy();
  });

  it('Alt growth writes the box and the tracks in the same step', () => {
    place({});
    const undo = new Y.UndoManager([objectsMap, groupsMap], { captureTimeout: 0 });
    commitTrackSizes('g', 'cols', [140, 100, 100], 40);
    expect(undo.undoStack.length).toBe(1);
    const after = readNode('g') as unknown as GridNode;
    expect(after.width).toBe(340);
    expect(after.x).toBe(0);
    undo.destroy();
  });

  it('pins a bento grid and merges in one undo step', () => {
    place({ kind: 'bento', rows: 3, columns: 3 });
    const undo = new Y.UndoManager([objectsMap, groupsMap], { captureTimeout: 0 });
    mergeCells('g', { row: 0, col: 0, rows: 1, cols: 2 });
    expect(undo.undoStack.length).toBe(1);
    expect((readNode('g') as unknown as GridNode).grid.spec.kind).toBe('modular');
    commitTrackSizes('g', 'cols', [150, 75, 75]);
    expect(undo.undoStack.length).toBe(2);
    undo.destroy();
  });
});

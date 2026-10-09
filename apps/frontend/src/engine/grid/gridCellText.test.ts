import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createNode, groupsMap, normalizeNode, objectsMap, readAllNodes, readNode } from '../document';
import { setRoomRole } from '../model/permissions';
import { useStore } from '../../hooks/useStore';
import { DEFAULT_TYPOGRAPHY, type AnyNode, type TextNode } from '../model/schema';
import { gridCellsOf, normalizeRecipe } from './gridNode';
import { addTextToCell, reassignGridSlot, setItemPlacement } from './gridSlotApply';
import { textAlignIn } from './gridReflow';

/**
 * Text in a grid cell has one model: a real text object adopted into the
 * module. Typing into an empty module and dropping a text object on it go
 * through the same placement, so they must come out the same in the document.
 */

const sync = () => useStore.setState({ objects: readAllNodes() as unknown as Record<string, AnyNode> });

const GRID = {
  id: 'g',
  type: 'grid',
  x: 0,
  y: 0,
  width: 300,
  height: 200,
  rotation: 0,
  grid: normalizeRecipe(
    { spec: { kind: 'modular', rows: 2, columns: 3, gutterX: 0, gutterY: 0, margin: 0, variation: 0, seed: 1 } },
    300,
    200
  ),
};

beforeEach(() => {
  setRoomRole('editor');
  Array.from(objectsMap.keys()).forEach((k) => objectsMap.delete(k));
  createNode(GRID as never);
  sync();
});

/** The fields that make text "in a cell": everything but identity, words and z. */
function cellShape(id: string) {
  const n = readNode(id) as unknown as TextNode;
  return {
    x: n.x,
    y: n.y,
    width: n.width,
    height: n.height,
    rotation: n.rotation,
    resize: n.resize,
    align: n.typography.align,
    verticalAlign: n.typography.verticalAlign,
    gridSlot: n.gridSlot,
  };
}

/** A text object made on open board, top-left aligned, then dropped with its centre in `cell`. */
function dropText(cell: number): string {
  const target = gridCellsOf(GRID as never).find((c) => c.index === cell)!;
  const id = createNode({
    type: 'text',
    x: target.x + target.width / 2 - 30,
    y: target.y + target.height / 2 - 10,
    width: 60,
    height: 20,
    text: 'Dropped',
    resize: 'width',
    typography: { ...DEFAULT_TYPOGRAPHY, align: 'left', verticalAlign: 'top' },
  } as never);
  sync();
  reassignGridSlot(id);
  sync();
  return id;
}

describe('one model for text in a cell', () => {
  it('typing into a module creates an adopted text object', () => {
    const id = addTextToCell('g', 1)!;
    sync();
    const n = readNode(id) as unknown as TextNode;
    expect(n.type).toBe('text');
    expect(n.gridSlot).toEqual({ gridId: 'g', cell: 1 });
    expect(n.resize).toBe('fixed');
    expect([n.x, n.y, n.width, n.height]).toEqual([100, 0, 100, 100]);
  });

  it('dropping a text object adopts it identically to typing in', () => {
    const typed = addTextToCell('g', 4)!;
    // Moved aside so the drop can land on the same module.
    objectsMap.delete(typed);
    sync();
    const dropped = dropText(4);
    const again = addTextToCell('g', 5)!;
    sync();
    const shapeDropped = cellShape(dropped);
    const shapeTyped = cellShape(again);
    // Same rule, different module: compare everything but position.
    expect({ ...shapeDropped, x: 0, gridSlot: undefined }).toEqual({ ...shapeTyped, x: 0, gridSlot: undefined });
    expect(shapeDropped.gridSlot).toEqual({ gridId: 'g', cell: 4 });
  });

  it('both follow the grid Item placement', () => {
    setItemPlacement('g', { x: 'start', y: 'end' });
    sync();
    const typed = addTextToCell('g', 0)!;
    sync();
    const dropped = dropText(2);
    for (const id of [typed, dropped]) {
      const t = (readNode(id) as unknown as TextNode).typography;
      expect([t.align, t.verticalAlign]).toEqual(['left', 'bottom']);
    }
  });

  it('changing Item placement re-sets the text in the grid, in one undo step', () => {
    const a = addTextToCell('g', 0)!;
    sync();
    const undo = new Y.UndoManager([objectsMap, groupsMap], { captureTimeout: 0 });
    setItemPlacement('g', { x: 'end', y: 'start' });
    expect(undo.undoStack.length).toBe(1);
    const t = (readNode(a) as unknown as TextNode).typography;
    expect([t.align, t.verticalAlign]).toEqual(['right', 'top']);
    expect((readNode('g') as unknown as { grid: { spec: { contentAlign?: unknown } } }).grid.spec.contentAlign).toEqual({
      x: 'end',
      y: 'start',
    });
    // Back to stretch clears the stored placement and centres the text.
    sync();
    setItemPlacement('g', { x: 'stretch', y: 'stretch' });
    expect((readNode('g') as unknown as { grid: { spec: { contentAlign?: unknown } } }).grid.spec.contentAlign).toBeUndefined();
    expect((readNode(a) as unknown as TextNode).typography.align).toBe('center');
    undo.destroy();
  });

  it('typing in is one undo step', () => {
    const undo = new Y.UndoManager([objectsMap, groupsMap], { captureTimeout: 0 });
    addTextToCell('g', 3);
    expect(undo.undoStack.length).toBe(1);
    undo.destroy();
  });

  it('dropping is one undo step', () => {
    const target = gridCellsOf(GRID as never)[3];
    const id = createNode({
      type: 'text',
      x: target.x + 20,
      y: target.y + 20,
      width: 40,
      height: 20,
      text: 'x',
      typography: { ...DEFAULT_TYPOGRAPHY },
    } as never);
    sync();
    const undo = new Y.UndoManager([objectsMap, groupsMap], { captureTimeout: 0 });
    reassignGridSlot(id);
    expect(undo.undoStack.length).toBe(1);
    undo.destroy();
  });

  it('a stretched axis centres, start and end set flush', () => {
    expect(textAlignIn(undefined)).toEqual({ align: 'center', verticalAlign: 'middle' });
    expect(textAlignIn({ x: 'start', y: 'center' })).toEqual({ align: 'left', verticalAlign: 'middle' });
    expect(textAlignIn({ x: 'end', y: 'end' })).toEqual({ align: 'right', verticalAlign: 'bottom' });
  });
});

describe('text placed by older clients', () => {
  it('normalises unchanged: the slot, the box and its own alignment are kept', () => {
    // A caption typed in before the unification (centred both ways) and one
    // dropped in before it (top-left) are both already real text objects in a
    // slot; there is no other cell-text storage to migrate. Nothing is
    // rewritten on load, so nobody's words or styling move under them.
    const legacy = {
      id: 'old',
      type: 'text',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      text: 'Kept',
      resize: 'fixed',
      typography: { ...DEFAULT_TYPOGRAPHY, align: 'left', verticalAlign: 'top' },
      gridSlot: { gridId: 'g', cell: 0 },
    };
    const n = normalizeNode(legacy as never) as unknown as TextNode;
    expect(n.text).toBe('Kept');
    expect(n.gridSlot).toEqual({ gridId: 'g', cell: 0 });
    expect([n.typography.align, n.typography.verticalAlign]).toEqual(['left', 'top']);
  });
});

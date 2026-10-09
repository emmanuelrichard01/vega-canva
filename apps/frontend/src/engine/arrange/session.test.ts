// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const writes: Array<Array<{ id: string; changes: Record<string, unknown> }>> = [];
const breaks = { count: 0 };

vi.mock('../document', () => ({
  applyNodePatches: (patches: Array<{ id: string; changes: Record<string, unknown> }>) => void writes.push([...patches]),
  undoManager: { stopCapturing: () => void (breaks.count += 1) },
}));
vi.mock('../model/permissions', () => ({ canEditObjects: () => editable.value }));
const editable = { value: true };

import { normalizeNode } from '../document/normalize';
import { liveTransformStore } from '../model/liveTransformStore';
import type { AnyNode } from '../model/schema';
import { arrangeSession } from './session';

const box = (id: string, x: number, y: number, w = 100, h = 60, extra: Record<string, unknown> = {}): AnyNode =>
  normalizeNode({ id, type: 'shape', x, y, width: w, height: h, geometry: { kind: 'rect' }, ...extra });

const nodes = [box('a', 0, 0), box('b', 130, 4), box('c', 2, 100), box('d', 133, 98)];
const table = Object.fromEntries(nodes.map((n) => [n.id, n]));

beforeEach(() => {
  writes.length = 0;
  breaks.count = 0;
  editable.value = true;
});
afterEach(() => {
  arrangeSession.cancel();
  liveTransformStore.clear();
});

describe('live grid session', () => {
  it('starts from the grid the selection already is, live and unwritten', () => {
    expect(arrangeSession.start(nodes, table)).toBe(true);
    const s = arrangeSession.get()!;
    expect(s.spec.columns).toBe(2);
    expect(s.order).toEqual(['a', 'b', 'c', 'd']);
    expect(writes).toHaveLength(0);
    // Snapped onto the grid on the board, through the live channel.
    expect(liveTransformStore.get('b')).toMatchObject({ y: 0 });
  });

  it('reflows as columns and gaps change, still without writing', () => {
    arrangeSession.start(nodes, table);
    arrangeSession.update({ columns: 4, colGap: 10 });
    expect(arrangeSession.get()!.layout.rows).toBe(1);
    expect(liveTransformStore.get('d')).toMatchObject({ x: 330, y: 0 });
    expect(writes).toHaveLength(0);
  });

  it('settles as one write between two capture breaks, and leaves nothing live', () => {
    arrangeSession.start(nodes, table);
    arrangeSession.update({ columns: 1, rowGap: 8 });
    arrangeSession.update({ rowGap: 12 });
    arrangeSession.commit();
    expect(writes).toHaveLength(1);
    expect(breaks.count).toBe(2);
    const byId = Object.fromEntries(writes[0].map((p) => [p.id, p.changes]));
    expect(byId.b).toMatchObject({ x: 0, y: 72 });
    expect(byId.d).toMatchObject({ x: 0, y: 216 });
    expect(liveTransformStore.size).toBe(0);
    expect(arrangeSession.get()).toBeNull();
  });

  it('reorders by dragging an item to another slot', () => {
    arrangeSession.start(nodes, table);
    const cell = arrangeSession.get()!.layout.cells.find((c) => c.key === 'a')!;
    arrangeSession.beginDrag('a', { x: cell.place.x + 10, y: cell.place.y + 10 });
    const last = arrangeSession.get()!.layout.cells.find((c) => c.key === 'd')!;
    arrangeSession.moveDrag({ x: last.cell.x + 20, y: last.cell.y + 20 });
    expect(arrangeSession.get()!.drag?.to).toBe(3);
    arrangeSession.endDrag();
    expect(arrangeSession.get()!.order).toEqual(['b', 'c', 'd', 'a']);
    expect(writes).toHaveLength(0);
  });

  it('puts everything back on Escape and writes nothing', () => {
    arrangeSession.start(nodes, table);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(arrangeSession.get()).toBeNull();
    expect(writes).toHaveLength(0);
    expect(liveTransformStore.size).toBe(0);
  });

  it('settles before any other key, so an undo takes the whole grid back', () => {
    arrangeSession.start(nodes, table);
    arrangeSession.update({ columns: 4 });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
    expect(writes).toHaveLength(1);
    expect(arrangeSession.get()).toBeNull();
  });

  it('does not start for someone who cannot edit, or for one object', () => {
    editable.value = false;
    expect(arrangeSession.start(nodes, table)).toBe(false);
    editable.value = true;
    expect(arrangeSession.start([nodes[0]], table)).toBe(false);
    expect(liveTransformStore.size).toBe(0);
  });
});

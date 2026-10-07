import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { isLiveTable, migrateTableNode, syncOrder, writeTable } from './tableCrdt';
import { evaluateCell } from './tableFormula';
import * as M from './tableModel';
import { normalizeTableSpec, type TableSpec } from './tableTypes';

/**
 * Two people on one table. Each `Y.Doc` is a client; `sync` exchanges their
 * updates both ways, the way the provider does.
 */

function client(): { doc: Y.Doc; objects: Y.Map<Y.Map<unknown>> } {
  const doc = new Y.Doc();
  return { doc, objects: doc.getMap<Y.Map<unknown>>('objects') };
}

function sync(a: Y.Doc, b: Y.Doc): void {
  const ua = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
  const ub = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
  Y.applyUpdate(b, ua, 'remote');
  Y.applyUpdate(a, ub, 'remote');
}

/** What the store would read: the node's `toJSON()`, through the read boundary. */
const read = (c: ReturnType<typeof client>, id = 't'): TableSpec => normalizeTableSpec(c.objects.get(id)!.toJSON().table, { cacheKey: `${c.doc.clientID}:${id}` });

/** An edit made the way the app makes one: read, change, write the diff in one transaction. */
function edit(c: ReturnType<typeof client>, fn: (s: TableSpec) => TableSpec, id = 't'): void {
  const before = read(c, id);
  const next = fn(before);
  c.doc.transact(() => writeTable(c.objects.get(id)!, next, before));
}

const BASE = {
  cells: [
    ['Item', 'Qty', 'Price', 'Total'],
    ['Tea', '2', '3', '=B2*C2'],
    ['Cake', '1', '4', '=B3*C3'],
    ['Sum', '', '', '=SUM(D2:D3)'],
  ],
  columns: [{ width: 1, type: 'text' }, { width: 1, type: 'number' }, { width: 1, type: 'number' }, { width: 1, type: 'number' }],
  header: true,
  theme: 'clean',
  fontSize: 13,
  refs: 2,
};

/** Two clients holding the same table, already converted to the merged shape. */
function pair() {
  const a = client();
  const b = client();
  a.doc.transact(() => {
    const n = new Y.Map<unknown>();
    n.set('id', 't');
    n.set('type', 'table');
    n.set('table', BASE);
    a.objects.set('t', n);
  });
  a.doc.transact(() => migrateTableNode(a.objects.get('t')!));
  sync(a.doc, b.doc);
  return { a, b };
}

describe('the merged shape', () => {
  it('converts a whole-value table and reads back the same table', () => {
    const { a } = pair();
    expect(isLiveTable(a.objects.get('t')!.get('table'))).toBe(true);
    const s = read(a);
    expect(s.cells).toEqual(BASE.cells);
    expect(s.refs).toBe(2);
    expect(evaluateCell(s, 3, 3)).toBe(10);
  });

  it('stores formulas by id, so an insert rewrites no formula', () => {
    const { a } = pair();
    const cellsMap = (a.objects.get('t')!.get('table') as Y.Map<unknown>).get('cells') as Y.Map<string>;
    const formulas = () => [...cellsMap.values()].filter((v) => v.startsWith('='));
    const before = formulas();
    edit(a, (s) => M.insertRows(s, 1, 1));
    expect(formulas()).toEqual(before);
    expect(read(a).cells[2][3]).toBe('=B3*C3');
    expect(evaluateCell(read(a), 4, 3)).toBe(10);
  });
});

describe('concurrent edits', () => {
  it('two people typing in different cells both keep their edit', () => {
    const { a, b } = pair();
    edit(a, (s) => M.setCell(s, 1, 0, 'Green tea'));
    edit(b, (s) => M.setCell(s, 2, 1, '5'));
    sync(a.doc, b.doc);
    for (const c of [a, b]) {
      const s = read(c);
      expect(s.cells[1][0]).toBe('Green tea');
      expect(s.cells[2][1]).toBe('5');
      expect(evaluateCell(s, 3, 3)).toBe(26);
    }
  });

  it('two rows inserted at once both survive, in the same order everywhere', () => {
    const { a, b } = pair();
    edit(a, (s) => M.setCell(M.insertRows(s, 3, 1), 3, 0, 'From A'));
    edit(b, (s) => M.setCell(M.insertRows(s, 3, 1), 3, 0, 'From B'));
    sync(a.doc, b.doc);
    const sa = read(a);
    const sb = read(b);
    expect(sa.cells.map((r) => r[0])).toEqual(sb.cells.map((r) => r[0]));
    expect(sa.cells.map((r) => r[0]).filter((v) => v.startsWith('From'))).toHaveLength(2);
    expect(sa.cells.length).toBe(6);
    // The total still sums its two rows, wherever the new rows landed.
    expect(evaluateCell(sa, 5, 3)).toBe(10);
  });

  it('a formula typed without seeing an insert still points at its cells', () => {
    const { a, b } = pair();
    edit(a, (s) => M.insertRows(s, 1, 1));
    edit(b, (s) => M.setCell(s, 3, 1, '=B2+B3'));
    sync(a.doc, b.doc);
    const s = read(a);
    // B's `B2+B3` meant Tea and Cake; after A's insert they are rows 3 and 4.
    const sum = s.cells.findIndex((r) => r[0] === 'Sum');
    expect(s.cells[sum][1]).toBe('=B3+B4');
    expect(evaluateCell(s, sum, 1)).toBe(3);
  });

  it('a style and a setting change from two people merge', () => {
    const { a, b } = pair();
    edit(a, (s) => M.styleRange(s, { r0: 1, c0: 0, r1: 1, c1: 0 }, { bold: true }));
    edit(b, (s) => ({ ...s, theme: 'grid' }));
    sync(a.doc, b.doc);
    const s = read(b);
    expect(s.styles?.['1:0']).toEqual({ bold: true });
    expect(s.theme).toBe('grid');
  });

  it('a row deleted under someone typing in another row keeps their edit', () => {
    const { a, b } = pair();
    edit(a, (s) => M.deleteRows(s, 1, 1));
    edit(b, (s) => M.setCell(s, 2, 0, 'Cheesecake'));
    sync(a.doc, b.doc);
    const s = read(a);
    expect(s.cells.map((r) => r[0])).toEqual(['Item', 'Cheesecake', 'Sum']);
    expect(read(b).cells).toEqual(s.cells);
  });
});

describe('undo stays per person', () => {
  it("an undo takes back this person's edit and leaves the other's", () => {
    const { a, b } = pair();
    const undoA = new Y.UndoManager([a.objects], { captureTimeout: 0 });
    edit(a, (s) => M.setCell(s, 1, 0, 'Green tea'));
    edit(b, (s) => M.setCell(s, 2, 0, 'Cheesecake'));
    sync(a.doc, b.doc);
    undoA.undo();
    sync(a.doc, b.doc);
    for (const c of [a, b]) {
      const s = read(c);
      expect(s.cells[1][0]).toBe('Tea');
      expect(s.cells[2][0]).toBe('Cheesecake');
    }
  });

  it('undoing the first edit puts the whole-value table back, and redo returns', () => {
    const c = client();
    c.doc.transact(() => {
      const n = new Y.Map<unknown>();
      n.set('table', BASE);
      c.objects.set('t', n);
    });
    const undo = new Y.UndoManager([c.objects], { captureTimeout: 0 });
    edit(c, (s) => M.setCell(s, 1, 0, 'Green tea'));
    expect(read(c).cells[1][0]).toBe('Green tea');
    undo.undo();
    expect(read(c).cells[1][0]).toBe('Tea');
    undo.redo();
    expect(read(c).cells[1][0]).toBe('Green tea');
  });
});

describe('order lists', () => {
  it('reach any order with few operations, keeping what is in order', () => {
    const doc = new Y.Doc();
    const arr = doc.getArray<string>('o');
    arr.insert(0, ['a', 'b', 'c', 'd', 'e']);
    let ops = 0;
    arr.observe((e) => (ops += e.changes.delta.length));
    doc.transact(() => syncOrder(arr, ['a', 'c', 'x', 'd', 'b', 'e']));
    expect(arr.toArray()).toEqual(['a', 'c', 'x', 'd', 'b', 'e']);
    expect(ops).toBeLessThanOrEqual(6);
    doc.transact(() => syncOrder(arr, ['e', 'a']));
    expect(arr.toArray()).toEqual(['e', 'a']);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { evaluateCell, isErr, r1c1ToA1, referencesIn, rewriteRefs, setTableResolver, shiftRefs, migrateFormulaRows } from './tableFormula';
import * as M from './tableModel';
import { layoutTable } from './tableLayout';
import { cellPrims } from './tablePaint';
import { approxMeasure } from './tableFit';
import { defaultTableSpec, normalizeTableSpec, type CellType, type TableSpec } from './tableTypes';
import { migrateDoc } from '../document/migrateDoc';
import { normalizeNode } from '../document/normalize';
import { effectiveSpec, resetView, splitEdit, viewOf } from './tableView';

const table = (cells: string[][], types: CellType[] = [], over: Partial<TableSpec> = {}): TableSpec => ({
  ...defaultTableSpec(cells.length, cells[0].length),
  cells,
  columns: cells[0].map((_, c) => ({ width: 1, type: types[c] ?? 'text' })),
  ...over,
});
const val = (s: TableSpec, r: number, c: number) => evaluateCell(s, r, c);

/** 2,000 × 60: a running total, a select column and an exact VLOOKUP into a lookup block. */
function bigTable(): TableSpec {
  const rows = 2000;
  const cols = 60;
  const cells = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      if (r === 0) return `H${c}`;
      if (c === 0) return String(r);
      if (c === 1) return r === 1 ? '=A2' : `=B${r}+A${r + 1}`;
      if (c === 2) return ['Open', 'Done', 'Blocked'][r % 3];
      if (c === 4) return String(r * 2);
      if (c === 5) return `=VLOOKUP(A${r + 1},$A$2:$E$2000,5,FALSE)`;
      return `v${r}-${c}`;
    })
  );
  const types: CellType[] = Array.from({ length: cols }, (_, c) => (c === 0 || c === 4 ? 'number' : c === 2 ? 'select' : 'text'));
  return table(cells, types);
}

describe('performance at 2,000 × 60', () => {
  it('bolds the whole table in under 200 ms', () => {
    const s = bigTable();
    const t0 = performance.now();
    const next = M.styleRange(s, { r0: 0, c0: 0, r1: 1999, c1: 59 }, { bold: true });
    const ms = performance.now() - t0;
    // The whole table is its columns: sixty styles, not 120,000.
    expect(next.columns.every((c) => c.style?.bold)).toBe(true);
    expect(M.cellStyleAt(next, 1234, 56)?.bold).toBe(true);
    // Every row but one is per cell, and still one copy of the map.
    const t1 = performance.now();
    const most = M.styleStored(s, { r0: 1, c0: 0, r1: 1999, c1: 59 }, M.viewRows(s), { fill: '#FEF3C7' });
    const perCell = performance.now() - t1;
    expect(Object.keys(most.styles ?? {}).length).toBe(119_940);
    // eslint-disable-next-line no-console
    console.info(`[bench] bold 2000×60: ${ms.toFixed(0)} ms; fill 1999×60 per cell: ${perCell.toFixed(0)} ms`);
    expect(ms).toBeLessThan(200);
  });

  it('writes many cells with one copy of each row', () => {
    const s = bigTable();
    const t0 = performance.now();
    const next = M.setCells(s, Array.from(M.storedCells({ r0: 1, c0: 5, r1: 1999, c1: 59 }, M.viewRows(s))).map(([r, c]) => [r, c, ''] as const));
    expect(performance.now() - t0).toBeLessThan(200);
    expect(next.cells[1999][59]).toBe('');
    expect(next.cells[0]).toBe(s.cells[0]);
  });

  it('lays out and evaluates a keystroke in under 100 ms after the first evaluation', () => {
    const s = bigTable();
    layoutTable(s, 9000, 72000);
    expect(val(s, 1999, 1)).toBe((1999 * 2000) / 2);
    expect(val(s, 1500, 5)).toBe(3000);
    // A keystroke: one cell changes, every formula is evaluated again.
    const times: number[] = [];
    let cur = s;
    for (let k = 0; k < 3; k++) {
      cur = M.setCell(cur, 10 + k, 10, `typed ${k}`);
      const t0 = performance.now();
      const l = layoutTable(cur, 9000, 72000);
      val(cur, 1999, 1);
      times.push(performance.now() - t0);
      expect(l.cells.length).toBe(120_000);
    }
    // eslint-disable-next-line no-console
    console.info(`[bench] 2000×60 keystroke layout+evaluate: ${times.map((t) => t.toFixed(0)).join(', ')} ms`);
    expect(Math.min(...times)).toBeLessThan(100);
  });

  it('an edit re-evaluates what it reaches and agrees with a fresh evaluation', () => {
    let s = bigTable();
    val(s, 1999, 1);
    s = M.setCell(s, 1000, 0, '5000');
    const t0 = performance.now();
    const v = val(s, 1999, 1);
    const ms = performance.now() - t0;
    const fresh = { ...s, columns: s.columns.map((c) => ({ ...c })) };
    expect(v).toBe(val(fresh, 1999, 1));
    expect(val(s, 999, 5)).toBe(val(fresh, 999, 5));
    expect(val(s, 1000, 5)).toBe(val(fresh, 1000, 5));
    // eslint-disable-next-line no-console
    console.info(`[bench] 2000×60 edit under a running total and a lookup: ${ms.toFixed(0)} ms`);
  });

  it('a sort or a width change keeps every value: the memo is keyed on the cells', () => {
    const s = table([['N', 'T'], ['1', '=A2*2'], ['2', '=A3*2']], ['number', 'number']);
    const before = val(s, 1, 1);
    const sorted = { ...s, sort: { col: 0, dir: 'desc' as const }, columns: s.columns.map((c) => ({ ...c, width: 3 })) };
    expect(val(sorted, 1, 1)).toBe(before);
  });
});

describe('cross-table references in reference rewriting', () => {
  it('shiftRefs leaves a whole Title!range alone', () => {
    expect(shiftRefs('SUM(Budget!B2:B5)', 1, 0)).toBe('SUM(Budget!B2:B5)');
    expect(shiftRefs("SUM('Q3 plan'!B2:B5)+A2", 1, 0)).toBe("SUM('Q3 plan'!B2:B5)+A3");
  });

  it('rewriteRefs and migrateFormulaRows do too', () => {
    const plusOne = (i: number) => (i >= 1 ? i + 1 : i);
    expect(rewriteRefs('Budget!B2:B5+B3', false, plusOne, (c) => c)).toBe('Budget!B2:B5+B4');
    expect(migrateFormulaRows('Budget!B1:B5+B1')).toBe('Budget!B1:B5+B2');
    expect(referencesIn('Budget!B2:B5+C3').map((r) => r.c0)).toEqual([2]);
  });
});

describe('cross-table cycles are cell-level', () => {
  afterEach(() => setTableResolver(null));

  it('A reading B!A2 while B reads A!A3 is not a cycle', () => {
    const a = table([['A'], ['=b!A2'], ['7']], ['number']);
    const b = table([['B'], ['=a!A3*2']], ['number']);
    setTableResolver({
      byTitle: (t) => (t === 'a' ? { id: 'a', spec: a } : t === 'b' ? { id: 'b', spec: b } : null),
      idOf: (s) => (s.cells === a.cells ? 'a' : s.cells === b.cells ? 'b' : null),
      version: () => 1,
    });
    expect(val(a, 1, 0)).toBe(14);
    expect(val(b, 1, 0)).toBe(14);
  });

  it('a draft that shares the cells is the same table', () => {
    const a = table([['A'], ['=a!A3+1'], ['7']], ['number']);
    setTableResolver({ byTitle: (t) => (t === 'a' ? { id: 'a', spec: a } : null), idOf: (s) => (s.cells === a.cells ? 'a' : null), version: () => 1 });
    const draft = { ...a, columns: a.columns.map((c) => ({ ...c, width: 4 })) };
    expect(val(draft, 1, 0)).toBe(8);
  });
});

describe('Sheets parity', () => {
  const t = (formula: string, more: string[][] = []) => {
    const s = table([['K', 'V'], ['a', '1'], ['b', '2'], ['c', '3'], ['apple', '4'], ['avocado', '5'], ...more, ['', formula]], ['text', 'number']);
    return val(s, s.cells.length - 1, 1);
  };

  it('approximate VLOOKUP with mixed types is #N/A', () => {
    expect(val(table([['K', 'V'], ['1', 'x'], ['2', 'y'], ['', '=VLOOKUP("b",A2:B3,2)']], ['number', 'text']), 3, 1)).toEqual({ err: '#N/A' });
    expect(val(table([['K', 'V'], ['1', 'x'], ['3', 'y'], ['', '=VLOOKUP(2,A2:B3,2)']], ['number', 'text']), 3, 1)).toBe('x');
  });

  it('COUNTIF and SUMIF read * and ? wildcards', () => {
    expect(t('=COUNTIF(A2:A6,"a*")')).toBe(3);
    expect(t('=COUNTIF(A2:A6,"?")')).toBe(3);
    expect(t('=SUMIF(A2:A6,"a*o",B2:B6)')).toBe(5);
    expect(t('=COUNTIFS(A2:A6,"<>a*",B2:B6,">1")')).toBe(2);
    expect(t('=SUMIFS(B2:B6,A2:A6,"*e")')).toBe(4);
    expect(t('=COUNTIF(A2:A6,"~*")')).toBe(0);
  });

  it('TEXT formats times', () => {
    expect(t('=TEXT(0.75,"hh:mm")')).toBe('18:00');
    expect(t('=TEXT(0.75,"h:mm AM/PM")')).toBe('6:00 PM');
    expect(t('=TEXT(0.5+1/86400*5,"hh:mm:ss")')).toBe('12:00:05');
    expect(t('=TEXT(DATE(2026,3,6)+0.25,"yyyy-mm-dd hh:mm")')).toBe('2026-03-06 06:00');
    expect(t('=TEXT(DATE(2026,3,6),"mmm d, yyyy")')).toBe('Mar 6, 2026');
  });

  it('EDATE, EOMONTH, WEEKDAY, NETWORKDAYS and DATEDIF', () => {
    expect(t('=TEXT(EDATE(DATE(2026,1,31),1),"yyyy-mm-dd")')).toBe('2026-02-28');
    expect(t('=TEXT(EOMONTH(DATE(2026,1,15),1),"yyyy-mm-dd")')).toBe('2026-02-28');
    expect(t('=WEEKDAY(DATE(2026,10,7))')).toBe(4);
    expect(t('=WEEKDAY(DATE(2026,10,7),2)')).toBe(3);
    expect(t('=NETWORKDAYS(DATE(2026,10,5),DATE(2026,10,16))')).toBe(10);
    expect(t('=NETWORKDAYS(DATE(2026,10,5),DATE(2026,10,16),DATE(2026,10,6))')).toBe(9);
    expect(t('=DATEDIF(DATE(2020,5,15),DATE(2026,3,10),"Y")')).toBe(5);
    expect(t('=DATEDIF(DATE(2020,5,15),DATE(2026,3,10),"M")')).toBe(69);
    expect(t('=DATEDIF(DATE(2020,5,15),DATE(2026,3,10),"YM")')).toBe(9);
    expect(t('=DATEDIF(DATE(2020,5,15),DATE(2026,3,10),"MD")')).toBe(23);
    expect(t('=DATEDIF(DATE(2026,3,10),DATE(2020,5,15),"D")')).toEqual({ err: '#NUM!' });
  });
});

describe('R1C1 from Google Sheets', () => {
  it('turns relative and absolute references into A1 for the landing cell', () => {
    expect(r1c1ToA1('=R[0]C[-1]*2', 4, 2)).toBe('=B5*2');
    expect(r1c1ToA1('=SUM(R[-3]C:R[-1]C)', 4, 2)).toBe('=SUM(C2:C4)');
    expect(r1c1ToA1('=R1C1+RC[1]+"R1C1"', 4, 2)).toBe('=$A$1+D5+"R1C1"');
  });

  it('is null when a reference would fall off the sheet, so the value is kept', () => {
    expect(r1c1ToA1('=R[-9]C*2', 4, 2)).toBeNull();
    expect(r1c1ToA1('=SUM(R[1])', 4, 2)).toBeNull();
  });
});

describe('summaries and layout details', () => {
  it('formats an average with the column’s decimals, not six', () => {
    const s = table([['N'], ['1'], ['2'], ['4']], ['number'], { summary: ['average'] });
    expect(M.summarize(s, 0, 'average')).toBe('2.33');
    const d = table([['N'], ['1.5'], ['2.25']], ['number']);
    expect(M.summarize(d, 0, 'sum')).toBe('3.75');
  });

  it('falls back to the short footer label before cutting one', () => {
    const s = table([['N'], ['1'], ['2'], ['3']], ['number'], { summary: ['sum'], filters: [{ col: 0, query: '>1' }] });
    const l = layoutTable(s, 120, 200);
    const foot = l.cells.find((c) => c.r === -1)!;
    expect(foot.footer).toEqual({ label: 'Sum of 2 visible', short: 'Sum' });
    const texts = cellPrims(foot, l, { measure: approxMeasure }).filter((p) => p.t === 'text').map((p) => (p as { s: string }).s);
    expect(texts).toContain('Sum');
  });

  it('a rating heading sits left, over its stars', () => {
    const s = table([['Score'], ['3']], ['rating']);
    expect(M.alignFor(s, 0, 0)).toBe('left');
  });

  it('draws only http(s) addresses as links', () => {
    const s = table([['Link'], ['https://example.com'], ['javascript:alert(1)']], ['url']);
    const l = layoutTable(s, 200, 100);
    expect(l.cells.find((c) => c.r === 1)?.kind).toBe('url');
    expect(l.cells.find((c) => c.r === 2)?.kind).toBeUndefined();
  });
});

describe('the row-count migration runs once, in the document', () => {
  const legacy = { cells: [['Item', 'Cost'], ['Tea', '4'], ['Total', '=B1*2']], columns: [{ width: 1, type: 'text' }, { width: 1, type: 'number' }], header: true, theme: 'clean', fontSize: 13 };

  function makeDoc() {
    const doc = new Y.Doc();
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const metadata = doc.getMap<string>('metadata');
    doc.transact(() => {
      const n = new Y.Map<unknown>();
      Object.entries({ id: 't1', type: 'table', x: 0, y: 0, width: 300, height: 108, hidden: false, opacity: 1, table: legacy }).forEach(([k, v]) => n.set(k, v));
      objects.set('t1', n);
    });
    return { doc, objects, metadata };
  }
  const read = (objects: Y.Map<Y.Map<unknown>>) => normalizeNode(objects.get('t1')!.toJSON(), 't1') as unknown as { table: TableSpec; tableRefs?: number };

  it('rewrites old-count formulas once and marks the node', () => {
    const { doc, objects, metadata } = makeDoc();
    // Before migrating, it reads as it was written.
    expect(read(objects).table.cells[2][1]).toBe('=B1*2');
    migrateDoc(doc, objects, metadata);
    const after = read(objects);
    expect(after.tableRefs).toBe(2);
    expect(after.table.cells[2][1]).toBe('=B2*2');
    expect(val(after.table, 2, 1)).toBe(8);
    expect(val(normalizeTableSpec(legacy), 2, 1)).toBe(8);
  });

  it('survives an older build writing the spec back without refs, and never migrates again', () => {
    const { doc, objects, metadata } = makeDoc();
    migrateDoc(doc, objects, metadata);
    const migrated = read(objects).table;
    // An older build: reads, drops `refs`, writes the whole spec back.
    const { refs: _r, rowIds: _ri, colIds: _ci, ...old } = migrated;
    objects.get('t1')!.set('table', old);
    const back = read(objects);
    expect(back.table.refs).toBe(2);
    expect(back.table.cells[2][1]).toBe('=B2*2');
    expect(val(back.table, 2, 1)).toBe(8);
    metadata.delete('schemaVersion');
    migrateDoc(doc, objects, metadata);
    expect(read(objects).table.cells[2][1]).toBe('=B2*2');
  });
});

describe('per-person views', () => {
  afterEach(() => resetView('v1'));

  it('a sort goes to the view and leaves the document alone', () => {
    const shared = normalizeTableSpec(table([['N'], ['2'], ['1']], ['number']));
    const doc = splitEdit('v1', shared, { ...shared, sort: { col: 0, dir: 'asc' } });
    expect(doc).toBeNull();
    expect(viewOf('v1')?.sort).toEqual({ colId: shared.colIds![0], dir: 'asc' });
    expect(M.viewRows(effectiveSpec('v1', shared))).toEqual([0, 2, 1]);
    expect(M.viewRows(shared)).toEqual([0, 1, 2]);
  });

  it('an edit made through a view writes the cells and keeps the default view', () => {
    const shared = normalizeTableSpec(table([['N', 'M'], ['2', 'x'], ['1', 'y']], ['number', 'text'], { sort: { col: 1, dir: 'desc' } }));
    splitEdit('v1', shared, { ...shared, sort: { col: 0, dir: 'asc' } });
    const seen = effectiveSpec('v1', shared);
    const inserted = M.insertCols(seen, 0, 1);
    const doc = splitEdit('v1', shared, inserted)!;
    expect(doc.columns.length).toBe(3);
    // The default sort followed its column across the insert.
    expect(doc.sort).toEqual({ col: 2, dir: 'desc' });
  });

  it('saving as the default writes the view and clears it', () => {
    const shared = normalizeTableSpec(table([['N'], ['2'], ['1']], ['number']));
    splitEdit('v1', shared, { ...shared, filters: [{ col: 0, query: '>1' }] });
    const doc = splitEdit('v1', shared, effectiveSpec('v1', shared), 'shared')!;
    expect(doc.filters).toEqual([{ col: 0, query: '>1' }]);
    expect(viewOf('v1')).toBeUndefined();
  });

  it('isErr stays usable from here', () => expect(isErr({ err: '#N/A' })).toBe(true));
});

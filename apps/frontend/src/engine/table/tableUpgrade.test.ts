import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  dateSerial,
  evaluateCell,
  formatSerial,
  isErr,
  migrateFormulaRows,
  refNameIn,
  setTableResolver,
  shiftRefs,
} from './tableFormula';
import * as M from './tableModel';
import { drawnWeight, layoutTable, wrapLines } from './tableLayout';
import { approxMeasure, fitColumns, fitRows } from './tableFit';
import { cellPrims } from './tablePaint';
import { tableToSvg } from './tableSvg';
import { clipForPaste, clipToHtml, copyCells, decodeClip, encodeClip } from './tableClipboard';
import { defaultTableSpec, migrateTableRefs, normalizeTableSpec, TAG_PAINTS, type CellType, type TableSpec } from './tableTypes';

/** A table counted the spreadsheet's way: the header is row 1, data starts at row 2. */
const table = (cells: string[][], types: CellType[] = [], over: Partial<TableSpec> = {}): TableSpec => ({
  ...defaultTableSpec(cells.length, cells[0].length),
  cells,
  columns: cells[0].map((_, c) => ({ width: 1, type: types[c] ?? 'text' })),
  ...over,
});

const val = (s: TableSpec, r: number, c: number) => evaluateCell(s, r, c);

// ---------------------------------------------------------------------------

describe('spreadsheet-true row numbers', () => {
  it('names the header row 1 and the first data row 2', () => {
    const s = table([['Item', 'Cost'], ['Tea', '4'], ['Cake', '6'], ['Total', '=SUM(B2:B3)']]);
    expect(refNameIn(s, 0, 0)).toBe('A1');
    expect(refNameIn(s, 1, 1)).toBe('B2');
    expect(val(s, 3, 1)).toBe(10);
    // The header is a cell like any other.
    expect(val({ ...s, cells: [...s.cells.slice(0, 3), ['', '=A1']] }, 3, 1)).toBe('Item');
  });

  it('migrates older formulas once, and only when there is a header', () => {
    expect(migrateFormulaRows('SUM(B1:B5)+$C$2*"A1"')).toBe('SUM(B2:B6)+$C$3*"A1"');
    const legacy = { ...table([['A', 'B'], ['2', '=A1*10']]), refs: undefined };
    const once = migrateTableRefs(legacy);
    expect(once.cells[1][1]).toBe('=A2*10');
    expect(once.refs).toBe(2);
    expect(migrateTableRefs(once)).toBe(once);
    const headless = migrateTableRefs({ ...legacy, header: false });
    expect(headless.cells[1][1]).toBe('=A1*10');
  });

  it('reads an unmarked spec the old way, so nothing written before changes meaning', () => {
    const legacy = { ...table([['Item', 'Cost'], ['Tea', '4'], ['Cake', '6'], ['Total', '=SUM(B1:B2)']]), refs: undefined };
    expect(val(legacy, 3, 1)).toBe(10);
    // Read as written: the rewrite is the document migration's, done once.
    const read = normalizeTableSpec(legacy);
    expect(read.cells[3][1]).toBe('=SUM(B1:B2)');
    expect(read.refs).toBeUndefined();
    expect(val(read, 3, 1)).toBe(10);
    // A node marked as migrated reads the spreadsheet count even without `refs`.
    const marked = normalizeTableSpec({ ...legacy, cells: [...legacy.cells.slice(0, 3), ['Total', '=SUM(B2:B3)']] }, { refsMarked: true });
    expect(marked.refs).toBe(2);
    expect(val(marked, 3, 1)).toBe(10);
  });

  it('keeps an armed filter with nothing typed, and folds the older single filter in', () => {
    const n = normalizeTableSpec({ ...table([['A'], ['x']]), filter: { col: 0, query: '' } });
    expect(n.filters).toEqual([{ col: 0, query: '' }]);
    expect(M.viewRows(n)).toEqual([0, 1]);
  });
});

describe('shiftRefs', () => {
  it('moves relative parts and pins $ parts', () => {
    expect(shiftRefs('A2*$B$1+B$3+$C4', 2, 1)).toBe('B4*$B$1+C$3+$C6');
    expect(shiftRefs('SUM(A2:A5)', 1, 0)).toBe('SUM(A3:A6)');
    expect(shiftRefs('A1+"A1"', 0, 1)).toBe('B1+"A1"');
  });

  it('is #REF! when pushed off the top or left', () => {
    expect(shiftRefs('A1', -1, 0)).toBe('#REF!');
    expect(shiftRefs('A1', 0, -1)).toBe('#REF!');
  });
});

describe('new functions', () => {
  const s = table(
    [
      ['Name', 'Team', 'Score', 'Due'],
      ['Ada', 'Red', '10', '2026-03-06'],
      ['Ben', 'Blue', '7', '2026-03-09'],
      ['Cy', 'Red', '4', '2026-04-01'],
    ],
    ['text', 'text', 'number', 'date']
  );
  const f = (formula: string) => val(table([...s.cells, [formula, '', '', '']], s.columns.map((c) => c.type)), 4, 0);

  it.each([
    ['=XLOOKUP("Ben",A2:A4,C2:C4)', 7],
    ['=XLOOKUP("Zed",A2:A4,C2:C4,"none")', 'none'],
    ['=INDEX(A2:C4,2,3)', 7],
    ['=MATCH("Cy",A2:A4,0)', 3],
    ['=VLOOKUP("Ada",A2:C4,3,FALSE)', 10],
    ['=SUMIFS(C2:C4,B2:B4,"Red",C2:C4,">5")', 10],
    ['=COUNTIFS(B2:B4,"Red")', 2],
    ['=IFS(C2>8,"high",TRUE,"low")', 'high'],
    ['=MID("spreadsheet",3,4)', 'read'],
    ['=TEXT(1234.5,"#,##0.00")', '1,234.50'],
    ['=TEXT(0.256,"0.0%")', '25.6%'],
    ['=TEXT(DATE(2026,3,6),"yyyy-mm-dd")', '2026-03-06'],
    ['=YEAR(D2)', 2026],
    ['=D3-D2', 3],
  ])('%s', (formula, want) => expect(f(formula)).toEqual(want));

  it('reads a date column as serial numbers, as Excel counts them', () => {
    expect(dateSerial(1900, 3, 1)).toBe(61);
    expect(val(s, 1, 3)).toBe(dateSerial(2026, 3, 6));
    expect(formatSerial(dateSerial(2026, 3, 6))).toBe('Mar 6, 2026');
  });

  it('TODAY is a whole day number, never stored', () => {
    const v = f('=TODAY()');
    expect(typeof v).toBe('number');
    expect(Number.isInteger(v)).toBe(true);
  });
});

describe('references to other tables', () => {
  afterEach(() => setTableResolver(null));

  const install = (tables: Record<string, TableSpec>) => {
    const ids = new Map(Object.entries(tables).map(([k, v]) => [v, k]));
    let version = 1;
    setTableResolver({
      byTitle: (t) => (tables[t] ? { id: t, spec: tables[t] } : null),
      idOf: (spec) => ids.get(spec) ?? null,
      version: () => version++,
    });
  };

  it("reads 'Title'!range from another table", () => {
    const revenue = table([['Q', 'Amount'], ['Q1', '10'], ['Q2', '15']], ['text', 'number']);
    const summary = table([['Total'], ["='q3 revenue'!B2:B3"], ["=SUM('q3 revenue'!B2:B3)"]]);
    install({ 'q3 revenue': revenue, summary });
    expect(val(summary, 2, 0)).toBe(25);
  });

  it('an unknown title is #REF!, and two tables reading each other are #CYCLE! in either order', () => {
    const a = table([['A'], ['=b!A2']]);
    const b = table([['B'], ['=a!A2']]);
    const lone = table([['C'], ['=nowhere!A2']]);
    install({ a, b, lone });
    expect(val(lone, 1, 0)).toEqual({ err: '#REF!' });
    expect(val(b, 1, 0)).toEqual({ err: '#CYCLE!' });
    expect(val(a, 1, 0)).toEqual({ err: '#CYCLE!' });
  });
});

// ---------------------------------------------------------------------------

describe('series fill', () => {
  const run = (values: string[], n = 3) => {
    const gen = M.seriesFor(values, (k) => ({ dr: k + 1, dc: 0 }));
    return Array.from({ length: n }, (_, k) => gen(k));
  };

  it.each([
    [['1', '3'], ['5', '7', '9']],
    [['10%', '20%'], ['30%', '40%', '50%']],
    [['Item 1', 'Item 2'], ['Item 3', 'Item 4', 'Item 5']],
    [['Q01', 'Q02'], ['Q03', 'Q04', 'Q05']],
    [['Mon'], ['Tue', 'Wed', 'Thu']],
    [['January', 'March'], ['May', 'July', 'September']],
    [['2026-01-31', '2026-02-28'], ['2026-03-31', '2026-04-30', '2026-05-31']],
    [['2026-03-01', '2026-03-08'], ['2026-03-15', '2026-03-22', '2026-03-29']],
    [['x'], ['x', 'x', 'x']],
  ])('%j continues as %j', (from, want) => expect(run(from)).toEqual(want));

  it('copies a formula with its references moved, as a spreadsheet fills', () => {
    const s = table([['A', 'B'], ['1', '=A2*2'], ['2', ''], ['3', '']]);
    const next = M.fillRange(s, { r0: 1, c0: 1, r1: 1, c1: 1 }, { r0: 1, c0: 1, r1: 3, c1: 1 });
    expect(next.cells.map((r) => r[1])).toEqual(['B', '=A2*2', '=A3*2', '=A4*2']);
    expect(val(next, 3, 1)).toBe(6);
  });

  it('fills right and upward too', () => {
    const s = table([['1', '2', '', '']], [], { header: false });
    expect(M.fillRange(s, { r0: 0, c0: 0, r1: 0, c1: 1 }, { r0: 0, c0: 0, r1: 0, c1: 3 }).cells[0]).toEqual(['1', '2', '3', '4']);
    const up = table([[''], [''], ['5'], ['6']], [], { header: false });
    expect(M.fillRange(up, { r0: 2, c0: 0, r1: 3, c1: 0 }, { r0: 0, c0: 0, r1: 3, c1: 0 }).cells.map((r) => r[0])).toEqual(['3', '4', '5', '6']);
  });
});

describe('filters, summaries and rich columns', () => {
  const s = table(
    [
      ['Task', 'Status', 'Points', 'Done'],
      ['Write', 'Doing', '3', 'FALSE'],
      ['Ship', 'Done', '5', 'TRUE'],
      ['Plan', 'Done', '2', 'TRUE'],
      ['Test', 'Blocked', '', 'FALSE'],
    ],
    ['text', 'select', 'number', 'checkbox']
  );

  it('a pick-list filter keeps the rows holding a picked value', () => {
    const f = M.setFilter(s, 1, { query: '', values: ['Done', 'Blocked'] });
    expect(M.viewRows(f)).toEqual([0, 2, 3, 4]);
    expect(M.distinctValues(s, 1)[0]).toEqual({ value: 'Done', count: 2 });
  });

  it('conditions understand comparisons and ranges, and an empty one hides nothing', () => {
    expect(M.viewRows(M.setFilter(s, 2, { query: '>=3' }))).toEqual([0, 1, 2]);
    expect(M.viewRows(M.setFilter(s, 2, { query: '2..3' }))).toEqual([0, 1, 3]);
    expect(M.viewRows(M.setFilter(s, 2, { query: ' ' }))).toEqual([0, 1, 2, 3, 4]);
    expect(M.isIdentityView(M.setFilter(s, 2, { query: '' }))).toBe(true);
  });

  it('summaries cover only the rows a filter shows, and say so', () => {
    const f = M.setFilter(s, 1, { query: '', values: ['Done'] });
    expect(M.summarize(s, 2, 'sum')).toBe('10');
    expect(M.summarize(f, 2, 'sum')).toBe('7');
    expect(M.summaryLabel(f, 'sum')).toBe('Sum of 2 visible');
    expect(M.summarize(s, 3, 'checked')).toBe('2 of 4');
    expect(M.summarize(s, 2, 'filled')).toBe('75%');
  });

  it('turning a column into a select gives each value it holds an option', () => {
    const t = M.setColumnType({ ...s, columns: s.columns.map((c, i) => (i === 1 ? { ...c, type: 'text' as const } : c)) }, 1, 'select');
    expect(t.columns[1].options?.map((o) => o.label)).toEqual(['Doing', 'Done', 'Blocked']);
  });

  it('sorts a select column in the order of its options', () => {
    const t = M.setColumnType(s, 1, 'select');
    expect(M.viewRows({ ...t, sort: { col: 1, dir: 'asc' } })).toEqual([0, 1, 2, 3, 4]);
  });

  it('duplicates a column with its formulas moved across', () => {
    const d = M.duplicateCol(table([['A', 'B'], ['2', '=A2*2']]), 1);
    expect(d.cells[0]).toEqual(['A', 'B', 'B copy']);
    expect(d.cells[1][2]).toBe('=B2*2');
  });

  it('counts what lowering the size would remove', () => {
    expect(M.filledRowsFrom(s, 3)).toBe(2);
    expect(M.filledColsFrom(s, 2)).toBe(2);
  });
});

// ---------------------------------------------------------------------------

describe('layout', () => {
  it('shares the height by row weight, with the footer as one standard row', () => {
    const s = table([['A'], ['x'], ['y']], [], { rowHeights: [1, 2, 1], summary: ['count'] });
    expect(drawnWeight(s)).toBe(5);
    const l = layoutTable(s, 100, 200);
    expect(l.rowHs).toEqual([40, 80, 40]);
    expect(l.footer).toEqual({ y: 160, h: 40 });
    const foot = l.cells.find((c) => c.r === -1)!;
    expect(foot.text).toBe('2');
    expect(foot.footer?.label).toBe('Count');
  });

  it('gives a hidden column no width and draws none of its cells', () => {
    const s = table([['A', 'B', 'C'], ['1', '2', '3']]);
    const hidden = M.setHidden(s, 1, true);
    const l = layoutTable(hidden, 300, 60);
    expect(l.colW[1]).toBe(0);
    expect(l.colW[0]).toBeCloseTo(150);
    expect(l.cells.some((c) => c.c === 1)).toBe(false);
    // The last shown column cannot be hidden.
    expect(M.setHidden(M.setHidden(hidden, 0, true), 2, true).columns[2].hidden).toBeUndefined();
  });

  it('marks rich cells with what they draw', () => {
    const s = table([['Done', 'Tag', 'Stars'], ['TRUE', 'a; b', '4']], ['checkbox', 'select', 'rating']);
    const l = layoutTable(s, 300, 60);
    const at = (c: number) => l.cells.find((x) => x.r === 1 && x.c === c)!;
    expect(at(0)).toMatchObject({ kind: 'checkbox', checked: true, text: '' });
    expect(at(1).tags?.map((t) => t.label)).toEqual(['a', 'b']);
    expect(at(2)).toMatchObject({ kind: 'rating', rating: 4 });
  });

  it('paints data bars to the column largest, and scales between their ends', () => {
    const s = table([['N'], ['5'], ['10']], ['number'], { bars: [{ col: 0, color: '#2563EB' }], scales: [{ col: 0, from: '#FFFFFF', to: '#000000' }] });
    const l = layoutTable(s, 100, 90);
    const five = l.cells.find((c) => c.r === 1)!;
    const ten = l.cells.find((c) => c.r === 2)!;
    expect(five.bar?.t).toBeCloseTo(0.5);
    expect(ten.bar?.t).toBe(1);
    expect(five.fill).toBe('#ffffff');
    expect(ten.fill).toBe('#000000');
  });

  it('paints a whole row when a whole-row rule matches', () => {
    const s = table([['Status', 'Note'], ['Late', 'x'], ['Fine', 'y']], [], { rules: [{ col: 0, when: 'Late', fill: '#FEE2E2', wholeRow: true }] });
    const l = layoutTable(s, 200, 90);
    expect(l.cells.filter((c) => c.r === 1).map((c) => c.fill)).toEqual(['#FEE2E2', '#FEE2E2']);
    expect(l.cells.filter((c) => c.r === 2).every((c) => c.fill !== '#FEE2E2')).toBe(true);
  });

  it('wraps by words and breaks a word wider than the room', () => {
    const m = (t: string) => t.length * 10;
    expect(wrapLines('one two three', 80, m)).toEqual(['one two', 'three']);
    expect(wrapLines('abcdefghij', 40, m)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('grows a wrapped row to its lines, and grows the table with it', () => {
    const s = table([['Note'], ['a long sentence that needs several lines to show']], [], {
      styles: { '1:0': { wrap: true } },
    });
    const fit = fitRows(s, { width: 120, height: 72 }, approxMeasure)!;
    expect(fit.spec.rowHeights![1]).toBeGreaterThan(1);
    expect(fit.height).toBeGreaterThan(72);
    // A wrapped column grows downwards, never across.
    expect(fitColumns(s, { width: 120, rowH: 36 }, approxMeasure)).toBeNull();
  });
});

describe('painting', () => {
  it('draws a ticked box, five stars and pills from the plan', () => {
    const s = table([['D', 'R', 'S'], ['TRUE', '3', 'x;y']], ['checkbox', 'rating', 'select']);
    const l = layoutTable(s, 600, 72);
    const plan = (c: number) => cellPrims(l.cells.find((x) => x.r === 1 && x.c === c)!, l, { measure: approxMeasure });
    expect(plan(0).filter((p) => p.t === 'path')).toHaveLength(1);
    expect(plan(1).filter((p) => p.t === 'path')).toHaveLength(5);
    expect(plan(2).filter((p) => p.t === 'text').map((p) => (p as { s: string }).s)).toEqual(['x', 'y']);
  });

  it('exports every kind, escaped', () => {
    const s = table([['D', 'P', 'S'], ['TRUE', '<b>Ann</b>', '"x"']], ['checkbox', 'person', 'select'], { summary: [null, 'count', null] });
    const svg = tableToSvg(s, 400, 108, { id: 't' });
    expect(svg).toContain('&lt;b&gt;Ann&lt;/b&gt;');
    expect(svg).not.toContain('<b>');
    expect(svg).toContain('Count');
  });
});

describe('clipboard', () => {
  it('carries formulas and moves them by how far the paste travels', () => {
    const s = table([['A', 'B'], ['2', '=A2*2'], ['3', '']]);
    const clip = decodeClip(encodeClip(copyCells(s, [1], { c0: 1, c1: 1 })))!;
    expect(clip.values).toEqual([['4']]);
    expect(clipForPaste(clip, { r: 2, c: 1 }, false).cells).toEqual([['=A3*2']]);
    expect(clipForPaste(clip, { r: 2, c: 1 }, true).cells).toEqual([['4']]);
  });

  it('writes an HTML table with formatting and formulas', () => {
    const s = table([['A', 'B'], ['2', '=A2*2']], [], { styles: { '1:1': { bold: true, fill: '#FEF3C7' } } });
    const html = clipToHtml(copyCells(s, [0, 1], { c0: 0, c1: 1 }));
    expect(html).toContain('font-weight:bold');
    expect(html).toContain('data-sheets-formula="=A2*2"');
  });
});

describe('tag colours', () => {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const contrast = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };

  it('every board tag holds its label at AA', () => {
    for (const t of TAG_PAINTS) expect(contrast(t.paper, t.ink), t.name).toBeGreaterThanOrEqual(4.5);
  });

  it('every chrome tag token pair, light and dark, holds AA', () => {
    const css = readFileSync(fileURLToPath(new URL('../../components/table/tableTools.css', import.meta.url)), 'utf8');
    const blocks = [/:root \{([^}]*)\}/.exec(css)![1], /\.dark-theme \{([^}]*)\}/.exec(css)![1]];
    for (const block of blocks) {
      const pairs = [...block.matchAll(/--tag-(\d)-paper: (#[0-9A-F]{6}); --tag-\1-ink: (#[0-9A-F]{6});/gi)];
      expect(pairs).toHaveLength(8);
      for (const [, n, paper, ink] of pairs) expect(contrast(paper, ink), `tag ${n}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

it('no example in the gallery computes an error after the move to spreadsheet numbering', async () => {
  const { TABLE_EXAMPLES } = await import('./tableExamples');
  for (const e of TABLE_EXAMPLES) {
    const spec = normalizeTableSpec(e.spec);
    spec.cells.forEach((row, r) =>
      row.forEach((raw, c) => {
        if (raw[0] === '=') expect(isErr(val(spec, r, c)), `${e.id} ${r}:${c} ${raw}`).toBe(false);
      })
    );
  }
});

describe('renaming a table', () => {
  it('rewrites references to it, quoted or not, and nothing else', async () => {
    const { renameTableRefs } = await import('./tableFormula');
    expect(renameTableRefs("SUM('Q3'!B2:B9)+q3!C2+\"Q3!B2\"+Other!A1", 'Q3', 'Q3 final')).toBe(
      "SUM('Q3 final'!B2:B9)+'Q3 final'!C2+\"Q3!B2\"+Other!A1"
    );
    expect(renameTableRefs("'Old name'!A1", 'old name', 'Budget')).toBe('Budget!A1');
  });
});

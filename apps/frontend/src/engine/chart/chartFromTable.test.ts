import { describe, expect, it } from 'vitest';
import { defaultTableSpec, normalizeTableSpec, type TableSpec } from '../table/tableTypes';
import { deleteRows, insertRows, setCell } from '../table/tableModel';
import {
  anchoredLink,
  changedReadings,
  currentRange,
  parseRangeLabel,
  planWriteBack,
  rangeLabel,
  recommendKind,
  relinkedSpec,
  resolveChartSpec,
  resolveTableLink,
  restyleNumber,
  tweenValues,
  unlinkedSpec,
} from './chartFromTable';
import type { ChartSpec } from './chartTypes';

function revenueTable(): TableSpec {
  let t = defaultTableSpec(4, 3);
  const rows = [
    ['Quarter', 'Revenue', 'Cost'],
    ['Q1', '120', '80'],
    ['Q2', '150', '=B3*0.6'],
    ['Q3', '$1,200', '90'],
  ];
  rows.forEach((row, r) => row.forEach((text, c) => (t = setCell(t, r, c, text))));
  return t;
}

const link = { tableId: 't1', r0: 0, c0: 0, r1: 3, c1: 2 };

describe('chart from a table range', () => {
  it('reads the header row as series names and the first column as categories', () => {
    const data = resolveTableLink(revenueTable(), link);
    expect(data.categories).toEqual(['Q1', 'Q2', 'Q3']);
    expect(data.series.map((s) => s.name)).toEqual(['Revenue', 'Cost']);
    expect(data.series[0].values).toEqual([120, 150, 1200]);
    // A formula is read as its result.
    expect(data.series[1].values[1]).toBeCloseTo(90);
  });

  it('follows an edit to a source cell', () => {
    const chart: ChartSpec = { kind: 'bar', categories: [], series: [{ name: 'Revenue', values: [], color: '#123456' }], link };
    const before = resolveChartSpec(chart, revenueTable());
    const after = resolveChartSpec(chart, setCell(revenueTable(), 1, 1, '999'));
    expect(before.series[0].values[0]).toBe(120);
    expect(after.series[0].values[0]).toBe(999);
    // The chart's own colour stays with the series.
    expect(after.series[0].color).toBe('#123456');
  });

  it('keeps the stored values when the table is gone', () => {
    const chart: ChartSpec = { kind: 'bar', categories: ['a'], series: [{ name: 'x', values: [7] }], link };
    expect(resolveChartSpec(chart, null)).toBe(chart);
  });

  it('reads across rows when asked', () => {
    const data = resolveTableLink(revenueTable(), { ...link, seriesIn: 'rows' });
    expect(data.categories).toEqual(['Revenue', 'Cost']);
    expect(data.series.map((s) => s.name)).toEqual(['Q1', 'Q2', 'Q3']);
  });

  it('copies the current values in on unlink', () => {
    const chart: ChartSpec = { kind: 'bar', categories: [], series: [], link };
    const out = unlinkedSpec(chart, revenueTable());
    expect(out.link).toBeUndefined();
    expect(out.categories).toEqual(['Q1', 'Q2', 'Q3']);
  });

  it('writes and reads range labels spreadsheet-style', () => {
    expect(rangeLabel({ r0: 0, c0: 0, r1: 8, c1: 3 })).toBe('A1:D9');
    expect(parseRangeLabel('a1:d9')).toEqual({ r0: 0, c0: 0, r1: 8, c1: 3 });
    expect(parseRangeLabel('D9:A1')).toEqual({ r0: 0, c0: 0, r1: 8, c1: 3 });
    expect(parseRangeLabel('nonsense')).toBeNull();
  });

  it('recommends a line for time and bars for things', () => {
    expect(recommendKind({ categories: ['Jan', 'Feb', 'Mar', 'Apr'], series: [{ name: 'a', values: [1, 2, 3, 4] }] })).toBe('line');
    expect(recommendKind({ categories: ['Apples', 'Pears'], series: [{ name: 'a', values: [1, 2] }] })).toBe('bar');
  });
});

/** A table with row and column ids, as the document hands it over. */
function sales(rows: string[][]): TableSpec {
  let t = normalizeTableSpec(defaultTableSpec(rows.length, rows[0].length));
  rows.forEach((row, r) => row.forEach((text, c) => (t = setCell(t, r, c, text))));
  return t;
}

const deals = () =>
  sales([
    ['Region', 'Stage', 'Amount'],
    ['West', 'Won', '100'],
    ['East', 'Lost', '40'],
    ['West', 'Won', '60'],
    ['North', 'Open', ''],
  ]);

describe('a link that follows its table', () => {
  it('keeps its cells when a row is inserted above it, and takes a row inserted inside it', () => {
    const t = sales([
      ['Month', 'Sales'],
      ['Jan', '1'],
      ['Feb', '2'],
      ['Mar', '3'],
    ]);
    const l = anchoredLink(t, 't', { r0: 1, c0: 0, r1: 2, c1: 1 });
    // It stops short of the last row, so it was chosen to: it does not grow.
    expect(l.grow).toBeUndefined();
    expect(currentRange(insertRows(t, 0), l)).toEqual({ r0: 2, c0: 0, r1: 3, c1: 1 });
    const inside = setCell(setCell(insertRows(t, 2), 2, 0, 'Mid'), 2, 1, '9');
    expect(resolveTableLink(inside, { ...l, header: false }).categories).toEqual(['Jan', 'Mid', 'Feb']);
  });

  it('grows to take rows filled in directly under it, as a Sheets table does', () => {
    const t = sales([
      ['Month', 'Sales'],
      ['Jan', '1'],
      ['Feb', '2'],
    ]);
    const l = anchoredLink(t, 't', { r0: 0, c0: 0, r1: 2, c1: 1 });
    expect(l.grow).toBe(true);
    const appended = setCell(setCell(insertRows(t, 3), 3, 0, 'Mar'), 3, 1, '3');
    expect(resolveTableLink(appended, l).categories).toEqual(['Jan', 'Feb', 'Mar']);
    // An empty row under it is not data yet.
    expect(resolveTableLink(insertRows(t, 3), l).categories).toEqual(['Jan', 'Feb']);
    // Charts sharing a named range read the grown range alike.
    expect(currentRange(appended, { ...l, name: 'Sales by month' })).toEqual(currentRange(appended, l));
  });

  it('falls back to its stored corner when that row is deleted', () => {
    const t = deals();
    const l = anchoredLink(t, 't', { r0: 0, c0: 0, r1: 4, c1: 2 });
    expect(currentRange(deleteRows(t, 4), l)).toEqual({ r0: 0, c0: 0, r1: 3, c1: 2 });
  });
});

describe('reading a range', () => {
  const whole = { r0: 0, c0: 0, r1: 4, c1: 2 };

  it('maps the category line and the series lines by id', () => {
    const t = deals();
    const [, stage, amount] = t.colIds!;
    const data = resolveTableLink(t, { ...whole, categoryLine: stage, seriesLines: [amount] });
    expect(data.categories).toEqual(['Won', 'Lost', 'Won', 'Open']);
    expect(data.series.map((s) => s.name)).toEqual(['Amount']);
  });

  it('sums, averages and counts readings that share a category', () => {
    const t = deals();
    const amount = t.colIds![2];
    const sum = resolveTableLink(t, { ...whole, seriesLines: [amount], aggregate: 'sum' });
    expect(sum.categories).toEqual(['West', 'East', 'North']);
    expect(sum.series[0].values).toEqual([160, 40, null]);
    expect(sum.sources).toEqual([null, 2, 4]);
    expect(resolveTableLink(t, { ...whole, seriesLines: [amount], aggregate: 'avg' }).series[0].values).toEqual([80, 40, null]);
    const count = resolveTableLink(t, { ...whole, seriesLines: [t.colIds![1]], aggregate: 'count' });
    expect(count.series[0].values).toEqual([2, 1, 1]);
  });

  it('keeps only the readings every filter passes', () => {
    const t = deals();
    const [, stage, amount] = t.colIds!;
    const won = resolveTableLink(t, { ...whole, seriesLines: [amount], filters: [{ line: stage, op: 'eq', value: 'won' }] });
    expect(won.categories).toEqual(['West', 'West']);
    const big = resolveTableLink(t, { ...whole, seriesLines: [amount], filters: [{ line: amount, op: 'gt', value: '50' }] });
    expect(big.series[0].values).toEqual([100, 60]);
    const filled = resolveTableLink(t, { ...whole, seriesLines: [amount], filters: [{ line: amount, op: 'filled', value: '' }] });
    expect(filled.categories).toHaveLength(3);
  });
});

describe('writing a chart value back to its cell', () => {
  it('finds the cell and keeps its look', () => {
    expect(planWriteBack(revenueTable(), link, 0, 2, 1500)).toEqual({ ok: true, r: 3, c: 1, cell: 'B4', before: '$1,200', after: '$1,500' });
  });

  it('finds the cell when the series run across the rows', () => {
    expect(planWriteBack(revenueTable(), { ...link, seriesIn: 'rows' }, 1, 0, 7)).toMatchObject({ ok: true, r: 2, c: 1, cell: 'B3' });
  });

  it('refuses a formula and a combined value, and says why', () => {
    expect(planWriteBack(revenueTable(), link, 1, 1, 10)).toEqual({ ok: false, reason: 'C3 is a formula; change it in the table' });
    const t = deals();
    const combined = planWriteBack(t, { r0: 0, c0: 0, r1: 4, c1: 2, seriesLines: [t.colIds![2]], aggregate: 'sum' }, 0, 0, 1);
    expect(combined).toEqual({ ok: false, reason: 'This value combines 2 rows; change them in the table' });
  });

  it('writes numbers the way the cell wrote them', () => {
    expect(restyleNumber('12%', 15)).toBe('15%');
    expect(restyleNumber('1,200.50', 1500)).toBe('1,500.00');
    expect(restyleNumber('', 3.5)).toBe('3.5');
    expect(restyleNumber('n/a', 4)).toBe('4');
  });
});

describe('a deleted source and a relink', () => {
  it('draws the last values with no table, and the new table once relinked', () => {
    const chart: ChartSpec = {
      kind: 'bar',
      categories: ['Q1'],
      series: [{ name: 'Revenue', values: [5], color: '#123456' }],
      link: { ...link, tableId: 'gone' },
    };
    expect(resolveChartSpec(chart, null).series[0].values).toEqual([5]);
    const t = deals();
    const relinked = relinkedSpec(chart, t, anchoredLink(t, 'new', { r0: 0, c0: 0, r1: 4, c1: 2 }));
    expect(relinked.link?.tableId).toBe('new');
    expect(relinked.categories).toEqual(['West', 'East', 'West', 'North']);
    expect(relinked.series[0].color).toBe('#123456');
  });
});

describe('a source change on the chart', () => {
  it('names the readings that changed and eases between them', () => {
    const chart: ChartSpec = { kind: 'bar', categories: [], series: [], link };
    const before = resolveChartSpec(chart, revenueTable());
    const after = resolveChartSpec(chart, setCell(revenueTable(), 1, 1, '220'));
    expect(changedReadings(before, after)).toEqual([[0, 0]]);
    expect(tweenValues(before, after, 0.5).series[0].values[0]).toBe(170);
    expect(tweenValues(before, after, 1)).toBe(after);
  });
});

import { describe, expect, it } from 'vitest';
import { defaultTableSpec, type TableSpec } from '../table/tableTypes';
import { setCell } from '../table/tableModel';
import {
  parseRangeLabel,
  rangeLabel,
  recommendKind,
  resolveChartSpec,
  resolveTableLink,
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

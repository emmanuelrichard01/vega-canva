import { describe, expect, it } from 'vitest';
import { defaultTableSpec, normalizeTableSpec, type TableSpec } from '../table/tableTypes';
import { setCell } from '../table/tableModel';
import { blockAround, guessChart, trimRange } from './chartFromTableGuess';

function grid(rows: string[][], size = { rows: rows.length, cols: rows[0].length }): TableSpec {
  let t = normalizeTableSpec(defaultTableSpec(size.rows, size.cols));
  for (let r = 0; r < size.rows; r += 1) for (let c = 0; c < size.cols; c += 1) t = setCell(t, r, c, rows[r]?.[c] ?? '');
  return t;
}

describe('"Chart this" inference', () => {
  it('reads a header row, series in columns, and a line for months', () => {
    const g = guessChart(
      grid([
        ['Month', 'Revenue', 'Cost'],
        ['Jan', '10', '6'],
        ['Feb', '12', '7'],
        ['Mar', '15', '8'],
      ])
    )!;
    expect(g.seriesIn).toBe('columns');
    expect(g.kind).toBe('line');
    expect(g.data.header).toBe(true);
    expect(g.data.series.map((s) => s.name)).toEqual(['Revenue', 'Cost']);
    expect(g.why).toMatch(/time/);
  });

  it('turns to rows when the times run across the top', () => {
    const g = guessChart(
      grid([
        ['Region', 'Q1', 'Q2', 'Q3', 'Q4'],
        ['West', '1', '2', '3', '4'],
        ['East', '2', '2', '1', '5'],
      ])
    )!;
    expect(g.seriesIn).toBe('rows');
    expect(g.data.categories).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
    expect(g.data.series.map((s) => s.name)).toEqual(['West', 'East']);
    expect(g.kind).toBe('line');
  });

  it('picks a donut for parts of a whole and bars for plain categories', () => {
    const share = guessChart(grid([['Channel', 'Share'], ['Search', '45'], ['Social', '30'], ['Email', '25']]))!;
    expect(share.kind).toBe('donut');
    const plain = guessChart(grid([['Team', 'Headcount'], ['Design', '4'], ['Sales', '9']]))!;
    expect(plain.kind).toBe('bar');
  });

  it('trims empty edges and finds the block around one cell', () => {
    const t = grid(
      [
        ['', '', ''],
        ['', 'Fruit', 'Kg'],
        ['', 'Apples', '3'],
        ['', '', ''],
      ],
      { rows: 4, cols: 3 }
    );
    expect(trimRange(t, { r0: 0, c0: 0, r1: 3, c1: 2 })).toEqual({ r0: 1, c0: 1, r1: 2, c1: 2 });
    expect(blockAround(t, 2, 2)).toEqual({ r0: 1, c0: 1, r1: 2, c1: 2 });
    expect(guessChart(t, { r0: 2, c0: 2, r1: 2, c1: 2 })!.range).toEqual({ r0: 1, c0: 1, r1: 2, c1: 2 });
  });

  it('declines a range with no numbers', () => {
    expect(guessChart(grid([['Name', 'Owner'], ['Ada', 'Grace']]))).toBeNull();
  });
});

describe('what reads as a time', () => {
  it('takes periods on their own and names that only start like one as names', async () => {
    const { looksLikeTime } = await import('./chartFromTable');
    for (const t of ['Jan', 'March 2024', 'Q3', 'Q3 FY24', 'Wk 12', 'Sunday', '2024', '2024-03-01', '3/1/24', 'Mar 3, 2024']) expect(looksLikeTime(t), t).toBe(true);
    for (const t of ['Q3 revenue', 'Marketing', 'May Chen', 'Decision', 'West', '42']) expect(looksLikeTime(t), t).toBe(false);
  });
});

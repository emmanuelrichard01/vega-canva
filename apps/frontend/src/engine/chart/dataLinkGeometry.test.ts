import { describe, expect, it } from 'vitest';
import { defaultTableSpec, type TableSpec } from '../table/tableTypes';
import { setCell } from '../table/tableModel';
import { bridge, crossRefsIn, crossTableLinks, rangeBox, type TableNodeLike } from './dataLinkGeometry';

function grid(rows: string[][]): TableSpec {
  let t = { ...defaultTableSpec(rows.length, rows[0].length), refs: 2 } as TableSpec;
  rows.forEach((row, r) => row.forEach((text, c) => (t = setCell(t, r, c, text))));
  return t;
}

const revenue: TableNodeLike = {
  id: 'a',
  title: 'Q3 revenue',
  x: 0,
  y: 0,
  width: 300,
  height: 150,
  table: grid([
    ['Quarter', 'Revenue'],
    ['Q1', '120'],
    ['Q2', '150'],
  ]),
};

const summary: TableNodeLike = {
  id: 'b',
  title: 'Summary',
  x: 500,
  y: 0,
  width: 200,
  height: 100,
  table: grid([
    ['Total', "='Q3 revenue'!B2:B3"],
    ['Note', '="Q3 revenue!B2"'],
  ]),
};

describe('data link geometry', () => {
  it('outlines a range inside its table, in board space', () => {
    const box = rangeBox(revenue, { r0: 1, c0: 1, r1: 2, c1: 1 })!;
    expect(box.x).toBeGreaterThan(revenue.x);
    expect(box.x + box.width).toBeLessThanOrEqual(revenue.x + revenue.width + 0.5);
    expect(box.y + box.height).toBeLessThanOrEqual(revenue.y + revenue.height + 0.5);
  });

  it('bridges facing edges', () => {
    expect(bridge({ x: 0, y: 0, width: 10, height: 10 }, { x: 100, y: 0, width: 10, height: 10 })).toEqual([10, 5, 100, 5]);
  });

  it('reads references into other tables, and ignores text that only looks like one', () => {
    expect(crossRefsIn("='Q3 revenue'!B2:B3")).toEqual([{ title: 'Q3 revenue', r0: 2, r1: 3, c0: 1, c1: 1 }]);
    expect(crossRefsIn('="Q3 revenue!B2"')).toEqual([]);
    expect(crossRefsIn('plain text')).toEqual([]);
  });

  it('links each reading cell to the range it reads', () => {
    const links = crossTableLinks(summary, [revenue, summary]);
    expect(links).toHaveLength(1);
    const expected = rangeBox(revenue, { r0: 1, c0: 1, r1: 2, c1: 1 });
    expect(links[0].source).toEqual(expected);
    expect(links[0].cell.x).toBeGreaterThanOrEqual(summary.x);
  });
});

import { describe, expect, it } from 'vitest';
import { approxMeasure, fitColumns, FIT_MIN, GROW_MAX } from './tableFit';
import { moveCols, moveOrder, moveRows } from './tableModel';
import { defaultTableSpec, type TableSpec } from './tableTypes';

const box = { width: 600, rowH: 36 };

const table = (cells: string[][], over: Partial<TableSpec> = {}): TableSpec => ({
  ...defaultTableSpec(cells.length, cells[0].length),
  cells,
  columns: cells[0].map(() => ({ width: 1, type: 'text' as const })),
  ...over,
});

describe('fitColumns', () => {
  it('widens a column whose text is cut, and the table with it', () => {
    const spec = table([
      ['Name', 'Note'],
      ['A', 'A sentence far too long for a column one hundred and fifty wide'],
    ]);
    const fit = fitColumns(spec, { width: 300, rowH: 36 }, approxMeasure)!;
    expect(fit).not.toBeNull();
    const [a, b] = fit.spec.columns.map((c) => c.width);
    expect(b).toBeGreaterThan(a);
    expect(fit.width).toBeGreaterThan(300);
  });

  it('narrows as well as widens, but never below FIT_MIN', () => {
    const spec = table([['#'], ['1']]);
    const fit = fitColumns(spec, { width: 400, rowH: 36 }, approxMeasure)!;
    expect(fit.width).toBe(FIT_MIN);
  });

  it('leaves a column with nothing in it alone', () => {
    const spec = table([
      ['Name', ''],
      ['Ada', ''],
    ]);
    const fit = fitColumns(spec, box, approxMeasure)!;
    expect(fit.spec.columns[1].width * 150).toBeCloseTo(300, 0);
  });

  it('grow never narrows, and stops at GROW_MAX', () => {
    const wide = table([['x'], ['short']]);
    expect(fitColumns(wide, box, approxMeasure, { mode: 'grow' })).toBeNull();
    const long = table([['x'], ['y'.repeat(400)]]);
    const grown = fitColumns(long, { width: 100, rowH: 36 }, approxMeasure, { mode: 'grow' })!;
    expect(grown.width).toBe(GROW_MAX);
  });

  it('changes only the columns it is asked to', () => {
    const spec = table([
      ['a'.repeat(60), 'b'.repeat(60)],
      ['', ''],
    ]);
    const fit = fitColumns(spec, box, approxMeasure, { columns: [1] })!;
    expect(fit.spec.columns[0].width * 150).toBeCloseTo(300, 0);
    expect(fit.spec.columns[1].width * 150).toBeGreaterThan(300);
  });

  it('reports nothing to do as null, so no empty undo step is written', () => {
    const spec = table([['abc'], ['def']]);
    const once = fitColumns(spec, box, approxMeasure)!;
    expect(fitColumns(once.spec, { width: once.width, rowH: 36 }, approxMeasure)).toBeNull();
  });
});

describe('moving rows and columns', () => {
  it('moveOrder refuses a move onto itself', () => {
    expect(moveOrder(5, 1, 2, 1)).toBeNull();
    expect(moveOrder(5, 1, 2, 3)).toBeNull();
    expect(moveOrder(5, 1, 2, 5)).toEqual([0, 3, 4, 1, 2]);
    expect(moveOrder(5, 3, 4, 0)).toEqual([3, 4, 0, 1, 2]);
  });

  it('carries styles, the sort and intact merges with a column', () => {
    const spec = table(
      [
        ['A', 'B', 'C', 'D'],
        ['1', '2', '3', '4'],
      ],
      {
        styles: { '1:0': { bold: true } },
        sort: { col: 0, dir: 'asc' },
        merges: [{ r: 0, c: 2, rs: 1, cs: 2 }],
      }
    );
    const next = moveCols(spec, 0, 0, 4);
    expect(next.cells[0]).toEqual(['B', 'C', 'D', 'A']);
    expect(next.styles).toEqual({ '1:3': { bold: true } });
    expect(next.sort).toEqual({ col: 3, dir: 'asc' });
    expect(next.merges).toEqual([{ r: 0, c: 1, rs: 1, cs: 2 }]);
  });

  it('drops a merge a move splits apart', () => {
    const spec = table([['A', 'B', 'C']], { merges: [{ r: 0, c: 0, rs: 1, cs: 2 }] });
    expect(moveCols(spec, 1, 1, 3).merges).toBeUndefined();
  });

  it('keeps the header row on top', () => {
    const spec = table([['H'], ['1'], ['2'], ['3']]);
    expect(moveRows(spec, 3, 3, 0)).toBe(spec);
    expect(moveRows(spec, 3, 3, 1).cells.map((r) => r[0])).toEqual(['H', '3', '1', '2']);
    expect(moveRows(spec, 0, 0, 3)).toBe(spec);
  });
});

import { describe, expect, it } from 'vitest';
import { evaluateCell, referencesIn, rewriteRefs } from './tableFormula';
import { deleteRows, formatCell, insertCols, insertRows, moveCols, viewRows } from './tableModel';
import { defaultTableSpec, type TableSpec } from './tableTypes';

/** A table with a header row, so B1 is the first row of data. */
const table = (cells: string[][], over: Partial<TableSpec> = {}): TableSpec => ({
  ...defaultTableSpec(cells.length, cells[0].length),
  cells,
  columns: cells[0].map(() => ({ width: 1, type: 'text' as const })),
  ...over,
});

const one = (formula: string, cells: string[][] = [['A', 'B'], ['', '']]) => {
  const spec = table([...cells, [formula, '']]);
  return evaluateCell(spec, spec.cells.length - 1, 0);
};

describe('formula arithmetic', () => {
  it.each([
    ['=1+2*3', 7],
    ['=(1+2)*3', 9],
    ['=-2^2', 4],
    ['=2^3^2', 64],
    ['=50%', 0.5],
    ['=10/4', 2.5],
    ['=0.1+0.2=0.3', false],
    ['="a"&"b"', 'ab'],
    ['=3>2', true],
    ['="abc"="ABC"', true],
  ])('%s', (f, want) => expect(one(f)).toEqual(want));

  it('reports errors by name', () => {
    expect(one('=1/0')).toEqual({ err: '#DIV/0!' });
    expect(one('=NOPE(1)')).toEqual({ err: '#NAME?' });
    expect(one('=1+')).toEqual({ err: '#ERROR!' });
    expect(one('=A99')).toEqual({ err: '#REF!' });
    expect(one('="x"*2')).toEqual({ err: '#VALUE!' });
  });
});

describe('references', () => {
  const sheet = table([
    ['Item', 'Price', 'Share'],
    ['Tea', '$4.50', '25%'],
    ['Cake', '$6.00', '75%'],
    ['Total', '=SUM(B1:B2)', '=C1+C2'],
  ]);

  it('reads currency and percentages as a spreadsheet would', () => {
    expect(evaluateCell(sheet, 3, 1)).toBe(10.5);
    expect(evaluateCell(sheet, 3, 2)).toBeCloseTo(1);
  });

  it('shows a computed share as a percentage in a percent column', () => {
    const typed = { ...sheet, columns: sheet.columns.map((c, i) => ({ ...c, type: i === 2 ? ('percent' as const) : c.type })) };
    expect(formatCell(typed, 3, 2)).toBe('100%');
  });

  it('catches a cycle instead of hanging', () => {
    const s = table([['A', 'B'], ['=B1', '=A1']]);
    expect(evaluateCell(s, 1, 0)).toEqual({ err: '#CYCLE!' });
  });

  it('evaluates only the IF branch it takes', () => {
    const s = table([['A', 'B'], ['0', '=IF(A1=0, 0, 1/A1)']]);
    expect(evaluateCell(s, 1, 1)).toBe(0);
  });

  it('COUNTIF and SUMIF read criteria', () => {
    const s = table([
      ['Status', 'Points'],
      ['Done', '5'],
      ['Open', '3'],
      ['Done', '8'],
      ['=COUNTIF(A1:A3,"done")', '=SUMIF(A1:A3,"Done",B1:B3)'],
    ]);
    expect(evaluateCell(s, 4, 0)).toBe(2);
    expect(evaluateCell(s, 4, 1)).toBe(13);
  });

  it('sorts a formula column by its results', () => {
    const s = table([['N', 'Double'], ['3', '=A1*2'], ['1', '=A2*2'], ['2', '=A3*2']], { sort: { col: 1, dir: 'asc' } });
    const typed = { ...s, columns: [{ width: 1, type: 'number' as const }, { width: 1, type: 'number' as const }] };
    expect(viewRows(typed)).toEqual([0, 2, 3, 1]);
  });
});

describe('references follow their cells', () => {
  it('finds references outside strings, not inside names', () => {
    expect(referencesIn('=SUM(B1:C3)+LOG10(2)&"A1"').map((r) => [r.c0, r.r0, r.c1, r.r1])).toEqual([[1, 1, 2, 3]]);
  });

  it('shifts past an inserted row and shrinks past a deleted one', () => {
    const s = table([['A'], ['1'], ['2'], ['3'], ['=SUM(A1:A3)']]);
    expect(insertRows(s, 1, 1).cells[5][0]).toBe('=SUM(A2:A4)');
    expect(deleteRows(s, 3, 1).cells[3][0]).toBe('=SUM(A1:A2)');
    expect(deleteRows(table([['A'], ['1'], ['=A1']]), 1, 1).cells[1][0]).toBe('=#REF!');
  });

  it('follows a column across an insert and a move', () => {
    const s = table([['A', 'B'], ['2', '=A1*10']]);
    expect(insertCols(s, 0, 1).cells[1][2]).toBe('=B1*10');
    expect(moveCols(s, 0, 0, 2).cells[1][0]).toBe('=B1*10');
  });

  it('leaves text in quotes alone', () => {
    expect(rewriteRefs('"A1"&A1', true, (r) => r + 1, (c) => c)).toBe('"A1"&A2');
  });
});

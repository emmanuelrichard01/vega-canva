import { describe, expect, it } from 'vitest';
import { evaluateCell, MAX_FORMULA_LENGTH } from './tableFormula';
import { defaultTableSpec, type TableSpec } from './tableTypes';

/**
 * The evaluator's guarantees under hostile or merely large tables: a cycle is
 * `#CYCLE!` for every cell in it regardless of which is read first, a long
 * chain of references does not become call-stack depth, and no number cell
 * ever shows Infinity or NaN.
 */

/** No header row, so A1 is stored row 0. */
const table = (cells: string[][]): TableSpec => ({
  ...defaultTableSpec(cells.length, cells[0].length),
  header: false,
  cells,
  columns: cells[0].map(() => ({ width: 1, type: 'text' as const })),
});

const CYCLE = { err: '#CYCLE!' };

describe('cycles are a property of the table', () => {
  it('IFERROR around a cycle gives the same answer in either evaluation order', () => {
    const cells = [['=IFERROR(B1,0)', '=A1+1']];
    const aFirst = table(cells.map((r) => [...r]));
    const bFirst = table(cells.map((r) => [...r]));

    const a1 = evaluateCell(aFirst, 0, 0);
    const b1 = evaluateCell(aFirst, 0, 1);
    const b2 = evaluateCell(bFirst, 0, 1);
    const a2 = evaluateCell(bFirst, 0, 0);

    expect(a1).toEqual(a2);
    expect(b1).toEqual(b2);
    expect(a1).toEqual(CYCLE);
    expect(b1).toEqual(CYCLE);
  });

  it('every member of a longer cycle is #CYCLE!, and cells outside it are not', () => {
    const spec = table([['=B1', '=C1', '=A1', '=5', '=D1*2']]);
    expect(evaluateCell(spec, 0, 0)).toEqual(CYCLE);
    expect(evaluateCell(spec, 0, 1)).toEqual(CYCLE);
    expect(evaluateCell(spec, 0, 2)).toEqual(CYCLE);
    expect(evaluateCell(spec, 0, 3)).toBe(5);
    expect(evaluateCell(spec, 0, 4)).toBe(10);
  });

  it('a cell naming itself, directly or through a range, is a cycle', () => {
    expect(evaluateCell(table([['=A1+1']]), 0, 0)).toEqual(CYCLE);
    expect(evaluateCell(table([['=SUM(A1:B1)', '3']]), 0, 0)).toEqual(CYCLE);
  });

  it('a cell that reads a cycle carries its error', () => {
    const spec = table([['=B1', '=A1', '=A1+1']]);
    expect(evaluateCell(spec, 0, 2)).toEqual(CYCLE);
  });
});

describe('deep chains', () => {
  const chain = (n: number): TableSpec =>
    table(Array.from({ length: n }, (_, i) => [i === 0 ? '1' : `=A${i}+1`]));

  it('a 2000-row running total evaluates from the bottom cell first', () => {
    const spec = chain(2000);
    expect(evaluateCell(spec, 1999, 0)).toBe(2000);
    expect(evaluateCell(spec, 0, 0)).toBe(1);
  });

  it('a 60-column chain evaluates from its last cell', () => {
    const row = Array.from({ length: 60 }, () => '1');
    // Columns past Z take two letters.
    const letters = (c: number) => (c < 26 ? String.fromCharCode(65 + c) : String.fromCharCode(64 + Math.floor(c / 26)) + String.fromCharCode(65 + (c % 26)));
    for (let c = 1; c < 60; c++) row[c] = `=${letters(c - 1)}1+1`;
    const spec = table([row]);
    expect(evaluateCell(spec, 0, 59)).toBe(60);
  });

  it('a header cell summing the far end of a long chain', () => {
    const cells = Array.from({ length: 1500 }, (_, i) => [i === 0 ? '=A1500' : i === 1 ? '1' : `=A${i}+1`]);
    expect(evaluateCell(table(cells), 0, 0)).toBe(1499);
  });
});

describe('formula limits', () => {
  it('a 200,000-term sum is an error, not a stack overflow', () => {
    const f = '=' + Array.from({ length: 100_000 }, () => '1').join('+');
    expect(() => evaluateCell(table([[f]]), 0, 0)).not.toThrow();
    expect(evaluateCell(table([[f]]), 0, 0)).toEqual({ err: '#ERROR!' });
  });

  it('deep nesting is an error, not a stack overflow', () => {
    const f = '=' + '('.repeat(5000) + '1' + ')'.repeat(5000);
    expect(evaluateCell(table([[f]]), 0, 0)).toEqual({ err: '#ERROR!' });
    const calls = '=' + 'ABS('.repeat(500) + '1' + ')'.repeat(500);
    expect(evaluateCell(table([[calls]]), 0, 0)).toEqual({ err: '#ERROR!' });
  });

  it('ordinary nesting still works', () => {
    expect(evaluateCell(table([['=((((1+2))))*ABS(ABS(-3))']]), 0, 0)).toBe(9);
  });

  it('an over-long formula is an error', () => {
    const f = '="' + 'x'.repeat(MAX_FORMULA_LENGTH) + '"';
    expect(evaluateCell(table([[f]]), 0, 0)).toEqual({ err: '#ERROR!' });
  });
});

describe('non-finite results are #NUM!', () => {
  it.each([
    ['=1e308*10'],
    ['=-1e308*10'],
    ['=1e999'],
    ['=SQRT(-1)'],
  ])('%s', (f) => expect(evaluateCell(table([[f]]), 0, 0)).toEqual({ err: '#NUM!' }));

  it('ROUND with extreme digit counts is defined', () => {
    expect(evaluateCell(table([['=ROUND(1.5,400)']]), 0, 0)).toBe(1.5);
    expect(evaluateCell(table([['=ROUND(1,-400)']]), 0, 0)).toBe(0);
  });
});

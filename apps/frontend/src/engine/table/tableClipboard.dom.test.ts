// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseHtmlTable, PASTE_CELL_LIMIT } from './tableClipboard';

describe('pasting an HTML table', () => {
  it('survives the spans that used to exhaust memory', () => {
    const cell = '<td rowspan="65534" colspan="1000">x</td>';
    const html = `<table>${Array.from({ length: 50 }, () => `<tr>${cell.repeat(50)}</tr>`).join('')}</table>`;
    const t0 = performance.now();
    const block = parseHtmlTable(html)!;
    expect(performance.now() - t0).toBeLessThan(5000);
    expect(block.cells.length).toBeLessThanOrEqual(2000);
    expect(Math.max(...block.cells.map((r) => r.length))).toBeLessThanOrEqual(60);
    expect(block.cells.length * block.cells[0].length).toBeLessThanOrEqual(PASTE_CELL_LIMIT);
    // Every span is clamped to the box from where it starts.
    for (const m of block.merges) {
      expect(m.r + m.rs).toBeLessThanOrEqual(2000);
      expect(m.c + m.cs).toBeLessThanOrEqual(60);
    }
  });

  it('reads only the outer table, not one nested in a cell', () => {
    const html = '<table><tr><td>A</td><td><table><tr><td>in1</td></tr><tr><td>in2</td></tr></table></td></tr><tr><td>B</td><td>C</td></tr></table>';
    const block = parseHtmlTable(html)!;
    expect(block.cells.length).toBe(2);
    expect(block.cells[0][0]).toBe('A');
    expect(block.cells[1]).toEqual(['B', 'C']);
  });

  it('turns a Sheets R1C1 formula into A1 for where it lands, or keeps the value', () => {
    const html =
      '<table><tr><td>2</td><td data-sheets-formula="=R[0]C[-1]*2">4</td><td data-sheets-formula="=R[-5]C[0]">9</td></tr></table>';
    const block = parseHtmlTable(html, { r: 3, c: 1 })!;
    expect(block.cells[0][1]).toBe('=B4*2');
    // R[-5] from row 4 is above the sheet: the value it showed is kept.
    expect(block.cells[0][2]).toBe('9');
  });
});

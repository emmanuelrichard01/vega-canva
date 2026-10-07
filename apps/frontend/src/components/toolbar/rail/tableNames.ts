import type { TableSpec } from '../../../engine/table/tableTypes';

/** "A", "B" … "AA": a column's name when the header row does not give it one. */
export function columnLetter(c: number): string {
  let n = c + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** What a column is called on the rail: its header text, or its letter. */
export function columnName(spec: TableSpec, c: number): string {
  return (spec.header ? spec.cells[0]?.[c]?.trim() : '') || `Column ${columnLetter(c)}`;
}

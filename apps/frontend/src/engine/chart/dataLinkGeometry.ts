import { layoutTable } from '../table/tableLayout';
import { colFromLetters, isFormula, storedOf } from '../table/tableFormula';
import type { TableSpec } from '../table/tableTypes';

/**
 * Where the board draws a data link: a chart to the table range it reads, and
 * a table cell to another table's range its formula reads. Pure, so the
 * geometry is testable without Konva.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TableNodeLike extends Box {
  id: string;
  title?: string;
  table: TableSpec;
}

export interface CellRange {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

/** A range's box in board space, from the table's own layout. Null when none of it is drawn. */
export function rangeBox(table: TableNodeLike, range: CellRange): Box | null {
  const layout = layoutTable(table.table, table.width, table.height);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const cell of layout.cells) {
    if (cell.r < range.r0 || cell.r > range.r1 || cell.c < range.c0 || cell.c > range.c1) continue;
    x0 = Math.min(x0, cell.x);
    y0 = Math.min(y0, cell.y);
    x1 = Math.max(x1, cell.x + cell.w);
    y1 = Math.max(y1, cell.y + cell.h);
  }
  if (!Number.isFinite(x0)) return null;
  return { x: table.x + x0, y: table.y + y0, width: x1 - x0, height: y1 - y0 };
}

/** The line between two boxes, from the nearer edge midpoints. */
export function bridge(a: Box, b: Box): [number, number, number, number] {
  const ac = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  const bc = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const dx = bc.x - ac.x;
  const dy = bc.y - ac.y;
  if (Math.abs(dx) * (a.height + b.height) >= Math.abs(dy) * (a.width + b.width)) {
    const from = dx >= 0 ? a.x + a.width : a.x;
    const to = dx >= 0 ? b.x : b.x + b.width;
    return [from, ac.y, to, bc.y];
  }
  const from = dy >= 0 ? a.y + a.height : a.y;
  const to = dy >= 0 ? b.y : b.y + b.height;
  return [ac.x, from, bc.x, to];
}

/** `'Title'!B2:C9` or `Title!B2`, outside string literals. */
const CROSS_REF = /(?:'((?:[^']|'')+)'|([A-Za-z_][\w.]*))!\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?/g;

export interface CrossRef {
  title: string;
  /** Written row numbers and column indices, low to high, as typed. */
  r0: number;
  r1: number;
  c0: number;
  c1: number;
}

/** Every reference into another table in one formula. */
export function crossRefsIn(formula: string): CrossRef[] {
  if (!isFormula(formula) || !formula.includes('!')) return [];
  const body = formula.replace(/"(?:[^"]|"")*"?/g, (m) => ' '.repeat(m.length));
  const out: CrossRef[] = [];
  for (const m of body.matchAll(CROSS_REF)) {
    const title = (m[1] ?? m[2] ?? '').replace(/''/g, "'").trim();
    if (!title) continue;
    const ca = colFromLetters(m[3]);
    const ra = Number(m[4]);
    const cb = m[5] ? colFromLetters(m[5]) : ca;
    const rb = m[6] ? Number(m[6]) : ra;
    out.push({ title, r0: Math.min(ra, rb), r1: Math.max(ra, rb), c0: Math.min(ca, cb), c1: Math.max(ca, cb) });
  }
  return out;
}

/** The written-number count a table uses: the older one skips the header row. */
const skipsHeader = (spec: TableSpec) => spec.header && (spec as { refs?: number }).refs !== 2;

export interface CrossLink {
  /** The range read, in the other table. */
  source: Box;
  /** The cell whose formula reads it. */
  cell: Box;
}

/**
 * The links out of one table: for each formula cell reading another table, the
 * range it reads and the cell itself. A title names the table with that title,
 * lowest id first when two share one, as the formula engine resolves it.
 */
export function crossTableLinks(table: TableNodeLike, tables: readonly TableNodeLike[]): CrossLink[] {
  const byTitle = new Map<string, TableNodeLike>();
  for (const t of [...tables].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const title = t.title?.trim().toLowerCase();
    if (title && !byTitle.has(title)) byTitle.set(title, t);
  }
  const out: CrossLink[] = [];
  table.table.cells.forEach((row, r) =>
    row.forEach((raw, c) => {
      for (const ref of crossRefsIn(String(raw ?? ''))) {
        const src = byTitle.get(ref.title.toLowerCase());
        if (!src || src.id === table.id) continue;
        const skip = skipsHeader(src.table);
        const source = rangeBox(src, {
          r0: storedOf(skip, ref.r0),
          r1: storedOf(skip, ref.r1),
          c0: ref.c0,
          c1: ref.c1,
        });
        const cell = rangeBox(table, { r0: r, r1: r, c0: c, c1: c });
        if (source && cell) out.push({ source, cell });
      }
    })
  );
  return out;
}

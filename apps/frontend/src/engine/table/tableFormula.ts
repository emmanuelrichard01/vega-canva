import type { CellType, TableSpec } from './tableTypes';

/**
 * Formulas in table cells.
 *
 * ## Spreadsheet grammar, and no `eval`
 *
 * A cell whose text starts with `=` is a formula: `=SUM(C2:C7)`,
 * `=B3*1.2`, `=IF(D2>100,"Over","OK")`. It is parsed here by a small
 * recursive-descent parser and evaluated over the table — never with `eval`
 * or `new Function`. A table lives in the CRDT and replicates to everyone in
 * the room, so a formula is text somebody else wrote, and it must not be able
 * to run anything. That is the chart's expression parser's rule too.
 *
 * ## References are what a spreadsheet would say
 *
 * `B3` is column B, row 3, counted the way Sheets and Excel count: with a
 * header row on, the header is row 1 and the first row of data is row 2, so a
 * formula copied out to a spreadsheet means the same cells (`refs: 2` on the
 * spec). A spec without that marker still reads with the older count, where
 * the header had no number; `normalizeTableSpec` rewrites those once
 * (`migrateFormulaRows`). Every helper here that converts between a written
 * row and a stored one takes that as its `skip` flag (`refsSkipHeader`).
 *
 * References follow their cells when rows and columns are inserted, deleted or
 * moved (`rewriteRefs`, called from `tableModel`); one whose cell is deleted
 * becomes `#REF!`, and a range that loses an end shrinks to what is left. A
 * reference written `'Other table'!B2:B9` reads a different table on the
 * board, found by its title (`setTableResolver`).
 *
 * ## Values
 *
 * Evaluation never rewrites the stored text. A cell reads as a spreadsheet
 * would read it: `$1,250` is 1250, `12%` is 0.12, a bare number in a percent
 * column is the percentage it displays, `TRUE` is true, a date is its serial
 * number (days since 30 December 1899, as Excel counts), and a blank is
 * empty — 0 in arithmetic, skipped by AVERAGE and COUNT.
 *
 * ## Cost
 *
 * Results are memoised on the table's `cells` array and its column types —
 * not on the spec object — so a sort, a filter, a resized column or the
 * editor's live drag reuses the values instead of evaluating again. Specs are
 * immutable and the read boundary keeps `cells` stable while no text changes
 * (`normalizeTableSpec`). Parses are cached by source text. A cycle is found
 * before evaluation, and every cell in it shows `#CYCLE!` rather than hanging
 * the board. TODAY and NOW are evaluated when the table is laid out, never
 * stored; a memo holding them goes stale when the minute turns, and the
 * shared minute timer (`tableVolatile.ts`) redraws the tables that use them.
 */

export type FErrCode = '#REF!' | '#DIV/0!' | '#NAME?' | '#VALUE!' | '#CYCLE!' | '#ERROR!' | '#NUM!' | '#N/A';
export interface FErr {
  err: FErrCode;
}
export type FValue = number | string | boolean | null | FErr;

export const isErr = (v: unknown): v is FErr => typeof v === 'object' && v !== null && 'err' in v;
const fail = (code: FErrCode): FErr => ({ err: code });

/** A formula is text that starts with `=` and has something after it. */
export const isFormula = (raw: string): boolean => typeof raw === 'string' && raw.length > 1 && raw.charCodeAt(0) === 61;

/** Whether written row numbers skip the header — the count before `refs: 2`. */
const skipOf = (spec: Pick<TableSpec, 'header' | 'refs'>) => spec.header && spec.refs !== 2;

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

export function colFromLetters(s: string): number {
  let n = 0;
  for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function lettersOf(c: number): string {
  let n = c + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * The number a reference is written with for a stored row. `skip` is the
 * older count, in which the header (stored row 0) had no number.
 */
export const rowLabel = (skip: boolean, r: number) => (skip ? r : r + 1);
/** The stored row a written row number means. */
export const storedOf = (skip: boolean, label: number) => (skip ? label : label - 1);

/** A reference to one stored cell, as it would be typed — null only for an unnumbered header. */
export function refName(skip: boolean, r: number, c: number): string | null {
  if (skip && r === 0) return null;
  return `${lettersOf(c)}${rowLabel(skip, r)}`;
}

/** `refName` for a spec, honouring its row count. */
export const refNameIn = (spec: Pick<TableSpec, 'header' | 'refs'>, r: number, c: number) => refName(skipOf(spec), r, c);

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
/** Excel's day 0 is 30 December 1899, which makes 1 March 1900 day 61 as Excel has it. */
const EPOCH_OFFSET = 25569;

/** The serial number of a calendar day. */
export function dateSerial(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d) / DAY_MS + EPOCH_OFFSET;
}

/** The calendar date of a serial number, read in UTC so a day never shifts with the time zone. */
export function serialToDate(serial: number): Date {
  return new Date(Math.round((serial - EPOCH_OFFSET) * DAY_MS));
}

/**
 * A serial number from typed text that looks like a date — `2026-03-06`,
 * `3/6/2026`, `Mar 6, 2026` — or null. A bare number is a year or a count, not
 * a date, and `Item 1` is a label, so text without a date separator or a
 * month's name is never read as one.
 */
export function parseDateText(text: string): number | null {
  const t = text.trim();
  if (!/[-/.]|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i.test(t)) return null;
  // A date has a number in it somewhere: "Tuesday" alone is a word.
  if (!/\d/.test(t)) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (iso) return dateSerial(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const ms = Date.parse(t);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return dateSerial(d.getFullYear(), d.getMonth() + 1, d.getDate()) + (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** A serial number as the table shows a date: `Mar 6, 2026`. */
export function formatSerial(serial: number): string {
  const d = serialToDate(serial);
  return `${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

type Tok =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'id'; v: string }
  | { t: 'sheet'; v: string }
  | { t: 'op'; v: string }
  | { t: 'err'; v: FErrCode }
  | { t: '(' }
  | { t: ')' }
  | { t: ',' }
  | { t: ':' }
  | { t: 'end' };

type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'blank' }
  | { k: 'err'; e: FErr }
  /** `row` is the written label, not the stored index: the parse is shared across specs. */
  | { k: 'ref'; row: number; col: number; table?: string }
  | { k: 'range'; r0: number; c0: number; r1: number; c1: number; table?: string }
  | { k: 'neg'; a: Node }
  | { k: 'pct'; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'call'; name: string; args: Node[] };

const ERR_LITERALS: FErrCode[] = ['#REF!', '#DIV/0!', '#NAME?', '#VALUE!', '#CYCLE!', '#ERROR!', '#NUM!', '#N/A'];

function tokenize(src: string): Tok[] | FErr {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) return fail('#ERROR!');
      out.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let s = '';
      for (;;) {
        if (j >= src.length) return fail('#ERROR!');
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            s += '"';
            j += 2;
            continue;
          }
          break;
        }
        s += src[j++];
      }
      out.push({ t: 'str', v: s });
      i = j + 1;
      continue;
    }
    // 'Table name'! — another table's title, quoted as a spreadsheet quotes a sheet.
    if (ch === "'") {
      let j = i + 1;
      let s = '';
      for (;;) {
        if (j >= src.length) return fail('#ERROR!');
        if (src[j] === "'") {
          if (src[j + 1] === "'") {
            s += "'";
            j += 2;
            continue;
          }
          break;
        }
        s += src[j++];
      }
      if (src[j + 1] !== '!' || !s.trim()) return fail('#ERROR!');
      out.push({ t: 'sheet', v: s });
      i = j + 2;
      continue;
    }
    if (ch === '#') {
      const lit = ERR_LITERALS.find((e) => src.startsWith(e, i));
      if (!lit) return fail('#ERROR!');
      out.push({ t: 'err', v: lit });
      i += lit.length;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_.$]*/.exec(src.slice(i))!;
      i += m[0].length;
      // An unquoted title followed by `!`: `Budget!B2`.
      if (src[i] === '!') {
        out.push({ t: 'sheet', v: m[0] });
        i++;
        continue;
      }
      out.push({ t: 'id', v: m[0] });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '<=' || two === '>=' || two === '<>') {
      out.push({ t: 'op', v: two });
      i += 2;
      continue;
    }
    if ('+-*/^&=<>%'.includes(ch)) {
      out.push({ t: 'op', v: ch });
      i++;
      continue;
    }
    if (ch === '(' || ch === ')' || ch === ',' || ch === ':') {
      out.push({ t: ch });
      i++;
      continue;
    }
    // A semicolon separates arguments in the locales whose decimal mark is a comma.
    if (ch === ';') {
      out.push({ t: ',' });
      i++;
      continue;
    }
    return fail('#ERROR!');
  }
  out.push({ t: 'end' });
  return out;
}

const REF = /^\$?([A-Za-z]{1,3})\$?(\d+)$/;

function parseRef(s: string): { row: number; col: number } | null {
  const m = REF.exec(s);
  return m ? { col: colFromLetters(m[1]), row: Number(m[2]) } : null;
}

const SYNTAX = new Error('formula syntax');

/**
 * Bounds on one formula. A formula is text somebody else typed into a shared
 * board, and both the parser and the evaluator recurse on its shape: without a
 * ceiling, `=((((…` or a 200,000-term sum overflows the stack of everyone who
 * draws the table. No formula a person writes comes near these.
 */
export const MAX_FORMULA_LENGTH = 8192;
const MAX_TOKENS = 2000;
const MAX_NESTING = 64;

function parseUncached(src: string): Node {
  if (src.length > MAX_FORMULA_LENGTH) return { k: 'err', e: fail('#ERROR!') };
  const toks = tokenize(src);
  if (isErr(toks)) return { k: 'err', e: toks };
  if (toks.length > MAX_TOKENS) return { k: 'err', e: fail('#ERROR!') };
  let i = 0;
  let depth = 0;
  const enter = () => {
    if (++depth > MAX_NESTING) throw SYNTAX;
  };
  const isOp = (...ops: string[]) => {
    const t = toks[i];
    return t.t === 'op' && ops.includes(t.v);
  };
  const take = (): string => (toks[i++] as { v: string }).v;
  const expect = (t: Tok['t']) => {
    if (toks[i].t !== t) throw SYNTAX;
    i++;
  };

  // Excel's precedence, loosest first: comparison, &, + -, * /, ^, unary
  // minus, %. Unary minus binding tighter than ^ is Excel's (-2^2 is 4).
  const comparison = (): Node => {
    let a = concat();
    while (isOp('=', '<>', '<', '>', '<=', '>=')) a = { k: 'bin', op: take(), a, b: concat() };
    return a;
  };
  const concat = (): Node => {
    let a = additive();
    while (isOp('&')) a = { k: 'bin', op: take(), a, b: additive() };
    return a;
  };
  const additive = (): Node => {
    let a = multiplicative();
    while (isOp('+', '-')) a = { k: 'bin', op: take(), a, b: multiplicative() };
    return a;
  };
  const multiplicative = (): Node => {
    let a = power();
    while (isOp('*', '/')) a = { k: 'bin', op: take(), a, b: power() };
    return a;
  };
  const power = (): Node => {
    let a = unary();
    while (isOp('^')) a = { k: 'bin', op: take(), a, b: unary() };
    return a;
  };
  const unary = (): Node => {
    if (isOp('-')) {
      i++;
      return { k: 'neg', a: unary() };
    }
    if (isOp('+')) {
      i++;
      return unary();
    }
    let a = primary();
    while (isOp('%')) {
      i++;
      a = { k: 'pct', a };
    }
    return a;
  };
  /** A reference or range, optionally in another table. */
  const reference = (first: string, table?: string): Node => {
    const ref = parseRef(first);
    if (!ref) return table ? { k: 'err', e: fail('#REF!') } : { k: 'err', e: fail('#NAME?') };
    if (toks[i].t === ':') {
      i++;
      const t2 = toks[i++];
      const ref2 = t2.t === 'id' ? parseRef(t2.v) : null;
      if (!ref2) throw SYNTAX;
      return { k: 'range', r0: ref.row, c0: ref.col, r1: ref2.row, c1: ref2.col, ...(table ? { table } : null) };
    }
    return { k: 'ref', row: ref.row, col: ref.col, ...(table ? { table } : null) };
  };
  const primary = (): Node => {
    const t = toks[i++];
    switch (t.t) {
      case 'num':
        return { k: 'num', v: t.v };
      case 'str':
        return { k: 'str', v: t.v };
      case 'err':
        return { k: 'err', e: fail(t.v) };
      case 'sheet': {
        const t2 = toks[i++];
        if (t2.t !== 'id') throw SYNTAX;
        return reference(t2.v, t.v);
      }
      case '(': {
        enter();
        const e = comparison();
        expect(')');
        depth--;
        return e;
      }
      case 'id': {
        if (toks[i].t === '(') {
          i++;
          enter();
          const args: Node[] = [];
          if (toks[i].t !== ')') {
            for (;;) {
              args.push(toks[i].t === ',' || toks[i].t === ')' ? { k: 'blank' } : comparison());
              if (toks[i].t === ',') {
                i++;
                continue;
              }
              break;
            }
          }
          expect(')');
          depth--;
          return { k: 'call', name: t.v.toUpperCase(), args };
        }
        const up = t.v.toUpperCase();
        if (up === 'TRUE' || up === 'FALSE') return { k: 'bool', v: up === 'TRUE' };
        return reference(t.v);
      }
      default:
        throw SYNTAX;
    }
  };

  try {
    const node = comparison();
    if (toks[i].t !== 'end') throw SYNTAX;
    return node;
  } catch (e) {
    // Only a syntax error is an answer about the formula. Anything else is a
    // fault in this process and must not be cached as the formula's meaning.
    if (e !== SYNTAX) throw e;
    return { k: 'err', e: fail('#ERROR!') };
  }
}

const astCache = new Map<string, Node>();
/**
 * Enough for a large table's formulas to stay parsed between edits: a running
 * total down 2,000 rows is 2,000 distinct texts, and a cache smaller than the
 * table clears itself every evaluation and parses everything again.
 */
const AST_CACHE_MAX = 40_000;

function parse(src: string): Node {
  const hit = astCache.get(src);
  if (hit) return hit;
  let node: Node;
  try {
    node = parseUncached(src);
  } catch {
    // Not cached: a stack overflow says nothing about the text.
    return { k: 'err', e: fail('#ERROR!') };
  }
  if (astCache.size > AST_CACHE_MAX) astCache.clear();
  astCache.set(src, node);
  return node;
}

/** Whether a formula parses — for the editor, which says so before it is committed. */
export function formulaError(raw: string): FErrCode | null {
  if (!isFormula(raw)) return null;
  const n = parse(raw.slice(1));
  return n.k === 'err' && n.e.err === '#ERROR!' ? '#ERROR!' : null;
}

// ---------------------------------------------------------------------------
// Other tables
// ---------------------------------------------------------------------------

/**
 * How a formula finds another table: by its title, through whatever owns the
 * board's tables (`tableRegistry.ts` in the app; a map in tests). `version`
 * changes whenever any table does, so a result that read another table is
 * recomputed then and only then.
 */
export interface TableResolver {
  byTitle: (title: string) => { id: string; spec: TableSpec } | null;
  idOf: (spec: TableSpec) => string | null;
  version: () => number;
}

let resolver: TableResolver | null = null;

export function setTableResolver(r: TableResolver | null): void {
  resolver = r;
}

/**
 * Specs that stand for a table on the board without being its stored spec —
 * the editor's draft while a column is dragged, the result preview of a
 * formula being typed — tied to the table's node id. A reference back to that
 * table by title then reads the draft itself rather than a second copy of the
 * table, so a result cannot flip between two readings mid-gesture.
 */
const boundIds = new WeakMap<object, string>();

export function bindTableId<T extends TableSpec>(spec: T, id: string): T {
  boundIds.set(spec, id);
  return spec;
}

/** The node id a spec belongs to: bound, or known to the resolver. */
function tableIdOf(spec: TableSpec): string | null {
  return boundIds.get(spec) ?? resolver?.idOf(spec) ?? null;
}

/** The titles a formula reads other tables by, lower-cased. */
function crossTitles(n: Node, out: Set<string>): void {
  switch (n.k) {
    case 'ref':
    case 'range':
      if (n.table) out.add(n.table.trim().toLowerCase());
      return;
    case 'neg':
    case 'pct':
      crossTitles(n.a, out);
      return;
    case 'bin':
      crossTitles(n.a, out);
      crossTitles(n.b, out);
      return;
    case 'call':
      for (const a of n.args) crossTitles(a, out);
      return;
    default:
      return;
  }
}

/** Titles a whole table's formulas read, cached per cells array — the text is all they depend on. */
const titlesByCells = new WeakMap<string[][], Set<string>>();
function tableTitles(spec: TableSpec): Set<string> {
  let out = titlesByCells.get(spec.cells);
  if (out) return out;
  out = new Set<string>();
  for (const row of spec.cells) for (const raw of row) if (isFormula(raw) && raw.includes('!')) crossTitles(parse(raw.slice(1)), out);
  titlesByCells.set(spec.cells, out);
  return out;
}

/** Whether any formula in the table reads another table. */
export const hasCrossRefs = (spec: TableSpec) => tableTitles(spec).size > 0;

/** The titles of the other tables a table reads, lower-cased. */
export const crossTableTitles = (spec: TableSpec): string[] => [...tableTitles(spec)];

/** Whether a formula in the table calls TODAY or NOW, cached per cells array. */
const volatileByCells = new WeakMap<string[][], boolean>();
export function hasVolatile(spec: TableSpec): boolean {
  let hit = volatileByCells.get(spec.cells);
  if (hit === undefined) {
    hit = false;
    outer: for (const row of spec.cells) {
      for (const raw of row) {
        if (isFormula(raw) && /\b(?:TODAY|NOW)\s*\(/i.test(raw) && usesVolatile(parse(raw.slice(1)))) {
          hit = true;
          break outer;
        }
      }
    }
    volatileByCells.set(spec.cells, hit);
  }
  return hit;
}

// ---------------------------------------------------------------------------
// Reading cells
// ---------------------------------------------------------------------------

function numberOf(text: string, type: CellType): number | null {
  const t = text.trim().replace(/[\s,$€£¥]/g, '').replace(/^−/, '-');
  if (t === '' || t === '%') return null;
  const pct = t.endsWith('%');
  const n = Number(pct ? t.slice(0, -1) : t);
  if (!Number.isFinite(n)) return null;
  return pct || type === 'percent' ? n / 100 : n;
}

function literal(raw: string, type: CellType): FValue {
  if (raw.trim() === '') return null;
  if (type === 'date') {
    const d = parseDateText(raw);
    if (d !== null) return d;
  }
  const n = numberOf(raw, type);
  if (n !== null) return n;
  const up = raw.trim().toUpperCase();
  if (up === 'TRUE' || up === 'FALSE') return up === 'TRUE';
  return raw;
}

function num(v: FValue): number | FErr {
  if (typeof v === 'number') return v;
  if (v === null) return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (isErr(v)) return v;
  if (v.trim() === '') return 0;
  const n = numberOf(v, 'text');
  if (n !== null) return n;
  const d = parseDateText(v);
  return d === null ? fail('#VALUE!') : d;
}

function str(v: FValue): string {
  if (v === null || isErr(v)) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  // Fifteen significant digits: what a spreadsheet shows, and enough to hide
  // 0.1 + 0.2 without hiding anything real.
  if (typeof v === 'number') return String(Number(v.toPrecision(15)));
  return v;
}

function bool(v: FValue): boolean | FErr {
  if (isErr(v)) return v;
  if (typeof v === 'boolean') return v;
  if (v === null) return false;
  if (typeof v === 'number') return v !== 0;
  const up = v.trim().toUpperCase();
  if (up === 'TRUE') return true;
  if (up === 'FALSE') return false;
  return fail('#VALUE!');
}

function compareValues(a: FValue, b: FValue): number {
  const asNumber = (v: FValue) =>
    typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : v === null ? 0 : isErr(v) ? null : numberOf(v, 'text');
  const na = asNumber(a);
  const nb = asNumber(b);
  if (na !== null && nb !== null) return na - nb;
  const sa = str(a).toLowerCase();
  const sb = str(b).toLowerCase();
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/**
 * One evaluation of a group of tables: the table asked for, and every table
 * its formulas read, through any chain of titles. Each has its own context;
 * the group carries what they share — which title is which table, and the
 * lookup indexes built during this evaluation.
 */
interface EvalGroup {
  ctxs: Ctx[];
  /** Per table: lower-cased title → index into `ctxs`, or -1 when it names no table. */
  titles: Array<Map<string, number>>;
  /** Range grids and lookup indexes, built once per evaluation. */
  cache: Map<string, unknown>;
}

interface Ctx {
  spec: TableSpec;
  memo: Map<number, FValue>;
  stack: Set<number>;
  /** This table's index in its group. */
  t: number;
  group: EvalGroup | null;
}

const KEY = 4096;
/** A cell's key across a group: table index × T + row × KEY + column. Above 2000 × 4096. */
const T = 1 << 23;
/** More tables than any formula chain reaches; past it a title reads as unknown. */
const MAX_GROUP = 64;

interface Memo {
  values: Map<number, FValue>;
  /** Minute stamp when it holds TODAY or NOW; -1 when it holds neither. */
  minute: number;
  /** Resolver version when it read another table; -1 when it read none. */
  cross: number;
  /** The node id the values were computed for. */
  self: string | null;
  /** What the next evaluation of the same table needs to redo only what an edit reaches. */
  inc?: Incremental;
}

/**
 * One table's evaluation, kept for the next: its formulas' order and edges,
 * and the cells it was computed from. Only for a table that reads no other
 * table and no clock, whose values depend on its own cells alone.
 */
interface Incremental {
  cells: string[][];
  plan: Plan;
  order: number[][];
  edges: Map<number, number[]>;
  rangeEdges: number[][];
  /** Built when first needed: per column, the formulas that read rows lo..hi of it. */
  readers?: Array<Array<{ lo: number; hi: number; g: number }>>;
  /** Built when first needed: who reads each formula cell, directly or through a range. */
  readBy?: Map<number, number[]>;
}

/** The last memo per table, by its columns array — what a keystroke's evaluation starts from. */
const lineage = new WeakMap<object, Memo>();

/**
 * Memos by `cells` array, then by what else values depend on: the row count
 * (`refs`) and each column's type, which decides how a literal reads.
 */
const memos = new WeakMap<string[][], Map<string, Memo>>();
const VOLATILE = new Set(['TODAY', 'NOW']);

const memoSig = (spec: TableSpec) => `${skipOf(spec) ? 1 : 0}|${spec.columns.map((c) => c.type).join(',')}`;

function usesVolatile(n: Node): boolean {
  switch (n.k) {
    case 'call':
      return VOLATILE.has(n.name) || n.args.some(usesVolatile);
    case 'neg':
    case 'pct':
      return usesVolatile(n.a);
    case 'bin':
      return usesVolatile(n.a) || usesVolatile(n.b);
    default:
      return false;
  }
}

/** The memo a spec object last used — a layout asks for thousands of cells of one spec. */
const memoBySpec = new WeakMap<TableSpec, Memo>();

const fresh = (m: Memo, self: string | null, minute: number) =>
  m.self === self && (m.minute < 0 || m.minute === minute) && (m.cross < 0 || m.cross === (resolver?.version() ?? 0));

/** The last spec asked about, for the thousands of asks in a row about one spec. */
let lastSpec: TableSpec | null = null;
let lastMemo: Memo | null = null;
let lastVersion = -1;

function memoFor(spec: TableSpec): Map<number, FValue> {
  const minute = Math.floor(Date.now() / 60_000);
  const version = resolver?.version() ?? 0;
  if (spec === lastSpec && lastMemo && version === lastVersion && (lastMemo.minute < 0 || lastMemo.minute === minute)) return lastMemo.values;
  const self = tableIdOf(spec);
  const quick = memoBySpec.get(spec);
  if (quick && fresh(quick, self, minute)) {
    lastSpec = spec;
    lastMemo = quick;
    lastVersion = version;
    return quick.values;
  }
  const sig = memoSig(spec);
  let bySig = memos.get(spec.cells);
  const hit = bySig?.get(sig);
  if (hit && fresh(hit, self, minute)) {
    memoBySpec.set(spec, hit);
    lastSpec = spec;
    lastMemo = hit;
    lastVersion = version;
    return hit.values;
  }
  const prev = lineage.get(spec.columns);
  const built =
    (prev && prev.self === self && prev.inc && memoSig(prev.inc.plan.spec) === sig ? reevaluate(prev.inc, spec) : null) ?? evaluateGroup(spec, self);
  if (!bySig) {
    bySig = new Map();
    memos.set(spec.cells, bySig);
  }
  const memo: Memo = {
    values: built.values,
    minute: built.volatile ? minute : -1,
    cross: built.cross ? resolver?.version() ?? 0 : -1,
    self,
    ...(built.inc ? { inc: built.inc } : null),
  };
  lineage.set(spec.columns, memo);
  bySig.set(sig, memo);
  memoBySpec.set(spec, memo);
  lastSpec = spec;
  lastMemo = memo;
  lastVersion = resolver?.version() ?? 0;
  return built.values;
}

/** A stored cell's value: its literal reading, or its formula's result. */
export function evaluateCell(spec: TableSpec, r: number, c: number): FValue {
  return cellValue({ spec, memo: memoFor(spec), stack: new Set(), t: 0, group: null }, r, c);
}

function rawOf(spec: TableSpec, r: number, c: number): string | undefined {
  const rawVal = spec.cells[r]?.[c] as unknown;
  if (rawVal === undefined) return undefined;
  return typeof rawVal === 'object' && rawVal !== null
    ? String((rawVal as { value?: unknown; text?: unknown }).value ?? (rawVal as { text?: unknown }).text ?? '')
    : String(rawVal ?? '');
}

/** Where a table's formulas are, for finding the formula cells a range covers. */
interface Plan {
  spec: TableSpec;
  /** Stored rows holding a formula, per column, ascending. */
  formulaRows: number[][];
  asts: Map<number, Node>;
}

function planOf(spec: TableSpec): Plan {
  const formulaRows: number[][] = spec.columns.map(() => []);
  const cols = spec.columns.length;
  for (let r = 0; r < spec.cells.length; r++) {
    const row = spec.cells[r];
    if (!row) continue;
    const n = Math.min(cols, row.length);
    for (let c = 0; c < n; c++) {
      const v = row[c] as unknown;
      if (typeof v === 'string' ? v.length > 1 && v.charCodeAt(0) === 61 : isFormula(rawOf(spec, r, c) ?? '')) formulaRows[c].push(r);
    }
  }
  return { spec, formulaRows, asts: new Map() };
}

function astAt(plan: Plan, local: number): Node {
  let ast = plan.asts.get(local);
  if (!ast) {
    const raw = rawOf(plan.spec, Math.floor(local / KEY), local % KEY) ?? '';
    ast = parse(raw.slice(1));
    plan.asts.set(local, ast);
  }
  return ast;
}

/**
 * Every formula a table's values depend on, evaluated once, in dependency
 * order — this table's, and the cells of other tables its formulas reach.
 *
 * ## Cycles are a property of the cells, not of the evaluation order
 *
 * The dependency graph is read off the parsed formulas before anything is
 * evaluated, and every strongly connected component with more than one cell
 * (or a cell that names itself) is `#CYCLE!` — all of it, whichever cell a
 * renderer happens to ask for first. Discovering a cycle part-way through a
 * recursive evaluation instead lets `IFERROR` swallow the error in whichever
 * cell was entered first, so the same table showed different numbers
 * depending on sort order.
 *
 * The graph spans tables at the level of cells. Table A reading `B!A2` while
 * B reads `A!A3` is two chains that happen to cross between the same tables,
 * not a cycle; only a cell that reaches itself is one.
 *
 * ## No recursion across cells
 *
 * Components are produced dependencies-first (Tarjan's order), so by the time
 * a formula is evaluated every cell it reads already has its value. A running
 * total down two thousand rows is two thousand shallow evaluations rather
 * than one evaluation two thousand frames deep. Only the cells the table's own
 * formulas reach are visited: a large table elsewhere on the board that is
 * read for one value costs that value's chain, not the whole table.
 */
interface Built {
  values: Map<number, FValue>;
  volatile: boolean;
  cross: boolean;
  inc?: Incremental;
}

/**
 * A table evaluated again after an edit that changed only literal cells,
 * from the last evaluation: the formulas the changed cells reach — directly,
 * through a range, or through other formulas — are evaluated again in the
 * order they were, and every other value is kept. Typing into a column no
 * formula reads costs nothing; typing under a running total re-runs the total
 * from that row down. Null when the edit changed a formula, or the shape, and
 * the table has to be planned afresh.
 */
function reevaluate(inc: Incremental, spec: TableSpec): Built | null {
  const before = inc.cells;
  const after = spec.cells;
  if (before.length !== after.length) return null;
  const changed: Array<[number, number]> = [];
  for (let r = 0; r < after.length; r++) {
    const a = before[r];
    const b = after[r];
    if (a === b) continue;
    if (!a || !b || a.length !== b.length) return null;
    for (let c = 0; c < b.length; c++) {
      if (a[c] === b[c]) continue;
      if (isFormula(a[c] ?? '') || isFormula(b[c] ?? '')) return null;
      changed.push([r, c]);
    }
  }
  const prevValues = (inc as Incremental & { values?: Map<number, FValue> }).values;
  if (!prevValues) return null;

  // Who reads what: built once per evaluation that is kept, on first need.
  if (!inc.readers) {
    const readers: Incremental['readers'] = spec.columns.map(() => []);
    const skip = skipOf(inc.plan.spec);
    for (const [g] of inc.edges) {
      collectRefs(astAt(inc.plan, g % T), (node) => {
        if (node.table) return;
        if (node.k === 'ref') {
          const r = storedOf(skip, node.row);
          readers![node.col]?.push({ lo: r, hi: r, g });
          return;
        }
        const span = rangeSpan(inc.plan.spec, node);
        if (!span) return;
        for (let c = span.c0; c <= span.c1; c++) readers![c]?.push({ lo: span.r0, hi: span.r1, g });
      });
    }
    inc.readers = readers;
    const readBy = new Map<number, number[]>();
    const add = (target: number, reader: number) => {
      const list = readBy.get(target);
      if (list) list.push(reader);
      else readBy.set(target, [reader]);
    };
    for (const [g, deps] of inc.edges) {
      for (const d of deps) {
        if (d >= 0) add(d, g);
        else add(d, g);
      }
    }
    inc.rangeEdges.forEach((members, i) => members.forEach((m) => add(m, -(i + 1))));
    inc.readBy = readBy;
  }

  const dirty = new Set<number>();
  const queue: number[] = [];
  const mark = (g: number) => {
    if (dirty.has(g)) return;
    dirty.add(g);
    queue.push(g);
  };
  for (const [r, c] of changed) for (const x of inc.readers[c] ?? []) if (r >= x.lo && r <= x.hi) mark(x.g);
  while (queue.length) for (const x of inc.readBy!.get(queue.pop()!) ?? []) mark(x);

  const values = new Map(prevValues);
  const plan = { ...inc.plan, spec };
  const group: EvalGroup = { ctxs: [], titles: [new Map()], cache: new Map() };
  const ctx: Ctx = { spec, memo: values, stack: new Set(), t: 0, group };
  group.ctxs = [ctx];
  if (dirty.size) {
    for (const component of inc.order) {
      const g = component[0];
      if (g < 0 || component.length > 1 || !dirty.has(g)) continue;
      if ((inc.edges.get(g) ?? []).includes(g)) continue;
      const local = g % T;
      ctx.stack.add(local);
      values.set(local, evalNode(astAt(plan, local), ctx));
      ctx.stack.delete(local);
    }
  }
  const next: Incremental & { values: Map<number, FValue> } = { ...inc, cells: after, plan, values };
  return { values, volatile: false, cross: false, inc: next };
}

function evaluateGroup(root: TableSpec, rootId: string | null): Built {
  const tables: TableSpec[] = [root];
  const byId = new Map<string, number>();
  if (rootId) byId.set(rootId, 0);
  const titles: Array<Map<string, number>> = [];
  for (let t = 0; t < tables.length; t++) {
    const map = new Map<string, number>();
    for (const title of tableTitles(tables[t])) {
      const hit = resolver?.byTitle(title);
      if (!hit) {
        map.set(title, -1);
        continue;
      }
      let i = byId.get(hit.id);
      if (i === undefined) {
        if (tables.length >= MAX_GROUP) {
          map.set(title, -1);
          continue;
        }
        i = tables.length;
        tables.push(hit.spec);
        byId.set(hit.id, i);
      }
      map.set(title, i);
    }
    titles.push(map);
  }
  const cross = titles[0].size > 0;

  const plans = tables.map(planOf);
  const group: EvalGroup = { ctxs: [], titles, cache: new Map() };
  group.ctxs = tables.map((spec, t) => ({ spec, memo: new Map<number, FValue>(), stack: new Set<number>(), t, group }));

  const roots: number[] = [];
  plans[0].formulaRows.forEach((rows, c) => rows.forEach((r) => roots.push(r * KEY + c)));
  if (roots.length === 0) return { values: group.ctxs[0].memo, volatile: false, cross };

  let volatile = false;
  const edges = new Map<number, number[]>();
  /**
   * A column of a range is one node of its own, keyed below zero: two
   * thousand VLOOKUPs over `$A$2:$E$2000` each reach five range nodes, and
   * each range node reaches the formulas inside it once — not two thousand
   * copies of two thousand edges.
   */
  const rangeNodes = new Map<string, number>();
  const rangeEdges: number[][] = [];
  const RANGE_INLINE = 4;
  // Which formula cells each formula reads. Literal cells are leaves and need
  // no ordering, so only formula targets become edges.
  const edgesOf = (g: number): number[] => {
    if (g < 0) return rangeEdges[-g - 1];
    let out = edges.get(g);
    if (out) return out;
    const t = Math.floor(g / T);
    const ast = astAt(plans[t], g % T);
    if (!volatile && usesVolatile(ast)) volatile = true;
    const found = new Set<number>();
    collectRefs(ast, (node) => {
      let tt = t;
      if (node.table) {
        const i = titles[t].get(node.table.trim().toLowerCase());
        if (i === undefined || i < 0) return;
        tt = i;
      }
      const target = plans[tt];
      const spec = target.spec;
      if (node.k === 'ref') {
        const r = storedOf(skipOf(spec), node.row);
        if (node.row < 1 || r < 0 || r >= spec.cells.length || node.col >= spec.columns.length) return;
        const rows = target.formulaRows[node.col];
        const i = lowerBound(rows, r);
        if (rows[i] === r) found.add(tt * T + r * KEY + node.col);
        return;
      }
      const span = rangeSpan(spec, node);
      if (!span) return;
      for (let c = span.c0; c <= span.c1; c++) {
        const rows = target.formulaRows[c];
        const from = lowerBound(rows, span.r0);
        let to = from;
        while (to < rows.length && rows[to] <= span.r1) to++;
        if (to - from <= RANGE_INLINE) {
          for (let i = from; i < to; i++) found.add(tt * T + rows[i] * KEY + c);
          continue;
        }
        const key = `${tt}:${c}:${span.r0}:${span.r1}`;
        let v = rangeNodes.get(key);
        if (v === undefined) {
          rangeEdges.push(rows.slice(from, to).map((r) => tt * T + r * KEY + c));
          v = -rangeEdges.length;
          rangeNodes.set(key, v);
        }
        found.add(v);
      }
    });
    out = [...found];
    edges.set(g, out);
    return out;
  };

  const order = stronglyConnected(roots, edgesOf);
  for (const component of order) {
    const g = component[0];
    const cyclic = component.length > 1 || edgesOf(g).includes(g);
    if (cyclic) {
      for (const m of component) if (m >= 0) group.ctxs[Math.floor(m / T)].memo.set(m % T, fail('#CYCLE!'));
      continue;
    }
    if (g < 0) continue;
    const ctx = group.ctxs[Math.floor(g / T)];
    const local = g % T;
    ctx.stack.add(local);
    ctx.memo.set(local, evalNode(astAt(plans[ctx.t], local), ctx));
    ctx.stack.delete(local);
  }
  const values = group.ctxs[0].memo;
  // Kept for the next edit when nothing but this table's own cells decides its values.
  const inc =
    tables.length === 1 && !cross && !volatile
      ? ({ cells: root.cells, plan: plans[0], order, edges, rangeEdges, values } as Incremental & { values: Map<number, FValue> })
      : undefined;
  return { values, volatile, cross, inc };
}

/** Every `ref` and `range` in a formula. The tree is bounded by the parser's limits. */
function collectRefs(n: Node, visit: (n: Extract<Node, { k: 'ref' | 'range' }>) => void): void {
  switch (n.k) {
    case 'ref':
    case 'range':
      visit(n);
      return;
    case 'neg':
    case 'pct':
      collectRefs(n.a, visit);
      return;
    case 'bin':
      collectRefs(n.a, visit);
      collectRefs(n.b, visit);
      return;
    case 'call':
      for (const a of n.args) collectRefs(a, visit);
      return;
    default:
      return;
  }
}

/** A range's stored rows and columns, clipped to the table; null when it names nothing. */
function rangeSpan(
  spec: TableSpec,
  arg: { r0: number; c0: number; r1: number; c1: number }
): { r0: number; r1: number; c0: number; c1: number } | null {
  if (Math.min(arg.r0, arg.r1) < 1) return null;
  const skip = skipOf(spec);
  const r0 = Math.max(0, storedOf(skip, Math.min(arg.r0, arg.r1)));
  const r1 = Math.min(storedOf(skip, Math.max(arg.r0, arg.r1)), spec.cells.length - 1);
  const c0 = Math.min(arg.c0, arg.c1);
  const c1 = Math.min(Math.max(arg.c0, arg.c1), spec.columns.length - 1);
  return r0 <= r1 && c0 <= c1 ? { r0, r1, c0, c1 } : null;
}

function lowerBound(sorted: number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Tarjan's strongly connected components, iteratively — the graph is as deep
 * as the longest chain of references, which is exactly what must not become
 * call-stack depth. Components come out dependencies-first. Edges are asked
 * for as the walk reaches each cell, so only what the roots reach is read.
 */
function stronglyConnected(nodes: number[], edgesOf: (v: number) => number[]): number[][] {
  const index = new Map<number, number>();
  const low = new Map<number, number>();
  const onStack = new Set<number>();
  const stack: number[] = [];
  const out: number[][] = [];
  let next = 0;

  for (const root of nodes) {
    if (index.has(root)) continue;
    const work: Array<{ v: number; i: number }> = [{ v: root, i: 0 }];
    index.set(root, next);
    low.set(root, next);
    next++;
    stack.push(root);
    onStack.add(root);

    while (work.length > 0) {
      const frame = work[work.length - 1];
      const edges = edgesOf(frame.v);
      if (frame.i < edges.length) {
        const w = edges[frame.i++];
        if (!index.has(w)) {
          index.set(w, next);
          low.set(w, next);
          next++;
          stack.push(w);
          onStack.add(w);
          work.push({ v: w, i: 0 });
        } else if (onStack.has(w)) {
          low.set(frame.v, Math.min(low.get(frame.v)!, index.get(w)!));
        }
        continue;
      }
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1].v;
        low.set(parent, Math.min(low.get(parent)!, low.get(frame.v)!));
      }
      if (low.get(frame.v) === index.get(frame.v)) {
        const component: number[] = [];
        let w: number;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          component.push(w);
        } while (w !== frame.v);
        out.push(component);
      }
    }
  }
  return out;
}

function cellValue(ctx: Ctx, r: number, c: number): FValue {
  const raw = rawOf(ctx.spec, r, c);
  if (raw === undefined) return fail('#REF!');
  if (!isFormula(raw)) return literal(raw, ctx.spec.columns[c]?.type ?? 'text');
  const k = r * KEY + c;
  const hit = ctx.memo.get(k);
  if (hit !== undefined) return hit;
  // Unreachable once `evaluateGroup` has run, which covers every formula cell
  // the table reaches; kept so a cell outside the plan still cannot recurse forever.
  if (ctx.stack.has(k)) return fail('#CYCLE!');
  ctx.stack.add(k);
  const v = evalNode(parse(raw.slice(1)), ctx);
  ctx.stack.delete(k);
  ctx.memo.set(k, v);
  return v;
}

/**
 * The table a reference reads: this one, or another of the group found by
 * title. An unknown title is `#REF!`.
 */
function targetOf(ctx: Ctx, table: string | undefined): Ctx | FErr {
  if (!table) return ctx;
  const i = ctx.group?.titles[ctx.t]?.get(table.trim().toLowerCase());
  if (i === undefined || i < 0 || !ctx.group) return fail('#REF!');
  return ctx.group.ctxs[i];
}

/**
 * A node's value, with every non-finite number reported as `#NUM!`. An
 * overflow (`1e308*10`) or an undefined result (`ROUND(1,400)`) is an error a
 * spreadsheet shows, never `Infinity` or `NaN` in a cell.
 */
function evalNode(n: Node, ctx: Ctx): FValue {
  const v = evalNodeRaw(n, ctx);
  return typeof v === 'number' && !Number.isFinite(v) ? fail('#NUM!') : v;
}

function evalNodeRaw(n: Node, ctx: Ctx): FValue {
  switch (n.k) {
    case 'num':
    case 'str':
    case 'bool':
      return n.v;
    case 'blank':
      return null;
    case 'err':
      return n.e;
    case 'ref': {
      const target = targetOf(ctx, n.table);
      if (isErr(target)) return target;
      const spec = target.spec;
      const r = storedOf(skipOf(spec), n.row);
      if (n.row < 1 || r < 0 || r >= spec.cells.length || n.col >= spec.columns.length) return fail('#REF!');
      return cellValue(target, r, n.col);
    }
    case 'range':
      // A range is only meaningful inside a function that reads many values.
      return fail('#VALUE!');
    case 'neg': {
      const a = num(evalNode(n.a, ctx));
      return isErr(a) ? a : -a;
    }
    case 'pct': {
      const a = num(evalNode(n.a, ctx));
      return isErr(a) ? a : a / 100;
    }
    case 'bin':
      return binary(n.op, evalNode(n.a, ctx), evalNode(n.b, ctx));
    case 'call': {
      const f = FUNCS[n.name];
      return f ? f.run(n.args, ctx) : fail('#NAME?');
    }
  }
}

function binary(op: string, a: FValue, b: FValue): FValue {
  if (isErr(a)) return a;
  if (isErr(b)) return b;
  if (op === '&') return str(a) + str(b);
  if (op === '=' || op === '<>' || op === '<' || op === '>' || op === '<=' || op === '>=') {
    const d = compareValues(a, b);
    return op === '=' ? d === 0 : op === '<>' ? d !== 0 : op === '<' ? d < 0 : op === '>' ? d > 0 : op === '<=' ? d <= 0 : d >= 0;
  }
  const x = num(a);
  if (isErr(x)) return x;
  const y = num(b);
  if (isErr(y)) return y;
  switch (op) {
    case '+':
      return x + y;
    case '-':
      return x - y;
    case '*':
      return x * y;
    case '/':
      return y === 0 ? fail('#DIV/0!') : x / y;
    case '^': {
      const p = Math.pow(x, y);
      return Number.isFinite(p) ? p : fail('#NUM!');
    }
    default:
      return fail('#ERROR!');
  }
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * A range's values as a grid, row by row — for the lookups, which care about
 * shape. A range's grid is built once per evaluation and shared: every
 * formula cell inside it is a dependency of the cell reading it, so it is
 * final by then, and two thousand VLOOKUPs over one range read one grid.
 */
function gridOf(arg: Node, ctx: Ctx): FValue[][] | FErr {
  if (arg.k !== 'range' && arg.k !== 'ref') {
    const v = evalNode(arg, ctx);
    return isErr(v) ? v : [[v]];
  }
  const target = targetOf(ctx, arg.table);
  if (isErr(target)) return target;
  const spec = target.spec;
  if (arg.k === 'ref') {
    const r = storedOf(skipOf(spec), arg.row);
    if (arg.row < 1 || r < 0 || r >= spec.cells.length || arg.col >= spec.columns.length) return fail('#REF!');
    return [[cellValue(target, r, arg.col)]];
  }
  const span = rangeSpan(spec, arg);
  if (!span) return fail('#REF!');
  const key = `g${target.t}:${span.r0}:${span.c0}:${span.r1}:${span.c1}`;
  const cache = ctx.group?.cache;
  const hit = cache?.get(key) as FValue[][] | undefined;
  if (hit) return hit;
  const out: FValue[][] = [];
  for (let r = span.r0; r <= span.r1; r++) {
    const row: FValue[] = [];
    for (let c = span.c0; c <= span.c1; c++) row.push(cellValue(target, r, c));
    out.push(row);
  }
  cache?.set(key, out);
  return out;
}

/** Derived from a grid or a list once, for as long as it lives: a range read flat, its columns, an exact-match index. */
const flatOfGrid = new WeakMap<FValue[][], FValue[]>();
const columnsOfGrid = new WeakMap<FValue[][], FValue[][]>();
const indexOfList = new WeakMap<FValue[], Map<string, number>>();

/** Every value an argument stands for: a range's cells (clipped to the table), or the one value. */
function valuesOf(arg: Node, ctx: Ctx): { values: FValue[]; range: boolean } {
  if (arg.k !== 'range') return { values: [evalNode(arg, ctx)], range: false };
  const grid = gridOf(arg, ctx);
  if (isErr(grid)) return { values: [grid], range: true };
  let flat = flatOfGrid.get(grid);
  if (!flat) {
    flat = grid.flat();
    flatOfGrid.set(grid, flat);
  }
  return { values: flat, range: true };
}

/** The key two values share when `compareValues` calls them equal. */
function matchKey(v: FValue): string | null {
  if (v === null || isErr(v)) return null;
  const n = typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : numberOf(v, 'text');
  return n !== null ? `n${n}` : `s${str(v).toLowerCase()}`;
}

/**
 * Where `value` first is in a list, exactly — through an index built once per
 * list per evaluation, so a column of lookups into one range costs one pass
 * over it instead of one per lookup.
 */
function exactIndex(value: FValue, list: FValue[]): number {
  let index = indexOfList.get(list);
  if (!index) {
    index = new Map();
    for (let i = 0; i < list.length; i++) {
      const k = matchKey(list[i]);
      if (k !== null && !index.has(k)) index.set(k, i);
    }
    indexOfList.set(list, index);
  }
  const k = matchKey(value);
  return k === null ? -1 : index.get(k) ?? -1;
}

/** A column of a grid as a list, cached with the grid so its index is too. */
function columnOf(grid: FValue[][], c: number): FValue[] {
  let cols = columnsOfGrid.get(grid);
  if (!cols) {
    cols = [];
    columnsOfGrid.set(grid, cols);
  }
  if (!cols[c]) cols[c] = grid.map((row) => row[c]);
  return cols[c];
}

/** The numbers among the arguments, as SUM reads them: a range gives only its numbers, a value typed in is coerced. */
function numbers(args: Node[], ctx: Ctx): number[] | FErr {
  const out: number[] = [];
  for (const a of args) {
    const { values, range } = valuesOf(a, ctx);
    for (const v of values) {
      if (isErr(v)) return v;
      if (typeof v === 'number') out.push(v);
      else if (!range && v !== null) {
        const n = num(v);
        if (isErr(n)) return n;
        out.push(n);
      }
    }
  }
  return out;
}

function flat(args: Node[], ctx: Ctx): FValue[] {
  return args.flatMap((a) => valuesOf(a, ctx).values);
}

const scalar = (args: Node[], i: number, ctx: Ctx): FValue => (args[i] ? evalNode(args[i], ctx) : null);

function numberArg(args: Node[], i: number, ctx: Ctx, fallback?: number): number | FErr {
  const a = args[i];
  if (!a || a.k === 'blank') return fallback ?? fail('#N/A');
  return num(evalNode(a, ctx));
}

/**
 * A criterion's wildcards as a whole-text pattern: `*` any run of characters,
 * `?` any one, `~*` and `~?` the characters themselves. Null when the text has
 * no wildcard, so plain criteria keep the faster comparison.
 */
function wildcard(operand: string): RegExp | null {
  if (!/(^|[^~])[*?]/.test(operand)) return null;
  let out = '';
  for (let i = 0; i < operand.length; i++) {
    const ch = operand[i];
    if (ch === '~' && (operand[i + 1] === '*' || operand[i + 1] === '?' || operand[i + 1] === '~')) {
      out += `\\${operand[++i]}`;
    } else if (ch === '*') out += '[\\s\\S]*';
    else if (ch === '?') out += '[\\s\\S]';
    else out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`, 'i');
}

/**
 * A COUNTIF-style test: `">10"`, `"<>Done"`, `"Open"`, a number, or a text
 * pattern with wildcards — `"Q*"`, `"?-??"`, `"<>*draft*"` — as Sheets reads them.
 */
function criterion(v: FValue): (x: FValue) => boolean {
  const text = typeof v === 'number' ? `=${v}` : str(v);
  const m = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(text)!;
  const op = m[1] ?? '=';
  const operand = m[2];
  const n = numberOf(operand, 'text');
  const pattern = n === null && (op === '=' || op === '<>') ? wildcard(operand) : null;
  return (x) => {
    if (isErr(x)) return false;
    if (n !== null) {
      const xn = typeof x === 'number' ? x : typeof x === 'boolean' ? null : typeof x === 'string' ? numberOf(x, 'text') : null;
      if (xn === null) return op === '<>';
      return op === '=' ? xn === n : op === '<>' ? xn !== n : op === '<' ? xn < n : op === '>' ? xn > n : op === '<=' ? xn <= n : xn >= n;
    }
    if (pattern) {
      // A pattern matches text; a number or a blank is not text it can match.
      const hit = typeof x === 'string' && pattern.test(x);
      return op === '=' ? hit : !hit;
    }
    const xs = str(x).toLowerCase();
    const o = operand.toLowerCase().replace(/~([*?~])/g, '$1');
    return op === '=' ? xs === o : op === '<>' ? xs !== o : op === '<' ? xs < o : op === '>' ? xs > o : op === '<=' ? xs <= o : xs >= o;
  };
}

const ruleCache = new Map<string, (x: FValue) => boolean>();

/**
 * A criterion from its text — `Done`, `>100`, `<>Open` — cached, because a
 * colour rule runs it for every cell of its column on every layout.
 */
export function ruleTest(when: string): (x: FValue) => boolean {
  let test = ruleCache.get(when);
  if (!test) {
    test = criterion(when);
    if (ruleCache.size > 500) ruleCache.clear();
    ruleCache.set(when, test);
  }
  return test;
}

function conditional(args: Node[], ctx: Ctx, mode: 'count' | 'sum' | 'average'): FValue {
  if (!args[0] || !args[1]) return fail('#N/A');
  const test = criterion(scalar(args, 1, ctx));
  const tested = valuesOf(args[0], ctx).values;
  const taken = mode !== 'count' && args[2] ? valuesOf(args[2], ctx).values : tested;
  let count = 0;
  let total = 0;
  tested.forEach((v, i) => {
    if (!test(v)) return;
    if (mode === 'count') {
      count++;
      return;
    }
    const t = taken[i];
    if (typeof t === 'number') {
      total += t;
      count++;
    }
  });
  if (mode === 'count') return count;
  if (mode === 'sum') return total;
  return count ? total / count : fail('#DIV/0!');
}

/** SUMIFS / COUNTIFS: every (range, criterion) pair must match at the same position. */
function multiConditional(ranges: Node[], crits: Node[], ctx: Ctx): boolean[] | FErr {
  if (!ranges.length || ranges.length !== crits.length) return fail('#N/A');
  const lists = ranges.map((r) => valuesOf(r, ctx).values);
  const n = lists[0].length;
  if (lists.some((l) => l.length !== n)) return fail('#VALUE!');
  const tests = crits.map((c) => criterion(evalNode(c, ctx)));
  return Array.from({ length: n }, (_, i) => tests.every((t, j) => t(lists[j][i])));
}

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

const roundTo = (x: number, d: number, how: 'round' | 'up' | 'down') => {
  // Past 15 decimals a double has no digits left to round; past -308 every
  // finite number rounds to zero. Clamped so `10 ** d` stays finite and non-zero.
  if (d > 15) return x;
  if (d < -308) return 0;
  const f = 10 ** Math.trunc(d);
  const a = Math.abs(x) * f;
  const r = how === 'round' ? Math.round(a + 1e-9) : how === 'up' ? Math.ceil(a - 1e-9) : Math.floor(a + 1e-9);
  return (Math.sign(x) * r) / f;
};

/** A value's kind for an approximate match, which compares like with like only. */
const kindOf = (v: FValue) => (typeof v === 'number' ? 'n' : typeof v === 'boolean' ? 'b' : typeof v === 'string' ? 's' : null);

/**
 * Where `value` is in a list: exact (0), the largest at or below it (1, sorted
 * up) or the smallest at or above (-1).
 *
 * An approximate match compares a number with numbers and text with text, as
 * Sheets does: a number searched for in a column of words matches nothing and
 * is `#N/A`, rather than being compared with them as text.
 */
function matchIndex(value: FValue, list: FValue[], mode: number): number {
  if (mode === 0) return exactIndex(value, list);
  const kind = kindOf(value);
  if (kind === null) return -1;
  let best = -1;
  for (let i = 0; i < list.length; i++) {
    const x = list[i];
    if (kindOf(x) !== kind) continue;
    const d = compareValues(x, value);
    if (mode > 0) {
      if (d <= 0 && (best < 0 || compareValues(x, list[best]) >= 0)) best = i;
    } else if (d >= 0 && (best < 0 || compareValues(x, list[best]) <= 0)) best = i;
  }
  return best;
}

/** The tokens of a date and time format, longest first so `mmmm` is not read as two `mm`. */
const DATE_TOKENS = /AM\/PM|am\/pm|A\/P|a\/p|yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|"[^"]*"/gi;

/**
 * A serial number through a date and time format: `yyyy-mm-dd`,
 * `mmm d, yyyy`, `hh:mm`, `h:mm AM/PM`, `hh:mm:ss`.
 *
 * `m` and `mm` are months, except next to an hour or a second — `hh:mm`,
 * `mm:ss` — where they are minutes, as every spreadsheet reads them. An
 * AM/PM marker puts the hours on a twelve-hour clock.
 */
function dateTimeFormat(serial: number, format: string): string {
  const tokens = [...format.matchAll(DATE_TOKENS)].map((m) => ({ at: m.index ?? 0, s: m[0] }));
  const twelve = tokens.some((t) => /^(am\/pm|a\/p)$/i.test(t.s));
  const kind = (s: string) => (/^h+$/i.test(s) ? 'h' : /^s+$/i.test(s) ? 's' : /^m{1,2}$/i.test(s) ? 'm' : 'x');
  // A month token is a minute when the nearest time token before it is an
  // hour, or the nearest after it is a second.
  const minutes = new Set<number>();
  tokens.forEach((t, i) => {
    if (kind(t.s) !== 'm') return;
    const before = tokens.slice(0, i).reverse().find((x) => kind(x.s) !== 'x' && kind(x.s) !== 'm');
    const after = tokens.slice(i + 1).find((x) => kind(x.s) !== 'x' && kind(x.s) !== 'm');
    if (before?.s && kind(before.s) === 'h') minutes.add(i);
    else if (after?.s && kind(after.s) === 's') minutes.add(i);
  });

  const d = serialToDate(Math.floor(serial));
  const yy = d.getUTCFullYear();
  const mo = d.getUTCMonth();
  const dd = d.getUTCDate();
  const dow = d.getUTCDay();
  const secs = Math.round((serial - Math.floor(serial)) * 86400) % 86400;
  const hour = Math.floor(secs / 3600);
  const minute = Math.floor((secs % 3600) / 60);
  const second = secs % 60;
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  const two = (x: number) => String(x).padStart(2, '0');

  let out = '';
  let last = 0;
  tokens.forEach((t, i) => {
    out += format.slice(last, t.at);
    last = t.at + t.s.length;
    const lower = t.s.toLowerCase();
    if (t.s.startsWith('"')) {
      out += t.s.slice(1, -1);
      return;
    }
    if (minutes.has(i)) {
      out += lower === 'mm' ? two(minute) : String(minute);
      return;
    }
    switch (lower) {
      case 'am/pm':
        out += hour < 12 ? (t.s === 'am/pm' ? 'am' : 'AM') : t.s === 'am/pm' ? 'pm' : 'PM';
        return;
      case 'a/p':
        out += hour < 12 ? (t.s === 'a/p' ? 'a' : 'A') : t.s === 'a/p' ? 'p' : 'P';
        return;
      case 'hh':
        out += two(twelve ? hour12 : hour);
        return;
      case 'h':
        out += String(twelve ? hour12 : hour);
        return;
      case 'ss':
        out += two(second);
        return;
      case 's':
        out += String(second);
        return;
      case 'yyyy':
        out += String(yy);
        return;
      case 'yy':
        out += String(yy).slice(-2);
        return;
      case 'mmmm':
        out += MONTHS[mo];
        return;
      case 'mmm':
        out += MONTHS[mo].slice(0, 3);
        return;
      case 'mm':
        out += two(mo + 1);
        return;
      case 'm':
        out += String(mo + 1);
        return;
      case 'dddd':
        out += DAYS[dow];
        return;
      case 'ddd':
        out += DAYS[dow].slice(0, 3);
        return;
      case 'dd':
        out += two(dd);
        return;
      default:
        out += String(dd);
    }
  });
  return out + format.slice(last);
}

/**
 * A value through a spreadsheet number, date or time format: `0.00`,
 * `#,##0`, `0%`, `$#,##0.00`, `yyyy-mm-dd`, `mmm d, yyyy`, `h:mm AM/PM`.
 */
function textFormat(v: FValue, format: string): FValue {
  if (isErr(v)) return v;
  const n = num(v);
  if (/[dyhs]|m{3,}|am\/pm|a\/p/i.test(format.replace(/"[^"]*"/g, ''))) {
    if (isErr(n)) return n;
    return dateTimeFormat(n, format);
  }
  if (isErr(n)) return typeof v === 'string' ? v : n;
  const m = /^([^0#.,]*)([0#,]*)(?:\.([0#]+))?(%?)(.*)$/.exec(format);
  if (!m || (!m[2] && !m[3])) return str(v);
  const decimals = m[3]?.length ?? 0;
  const value = m[4] ? n * 100 : n;
  const grouped = m[2].includes(',');
  const body = Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: grouped,
  });
  return `${value < 0 ? '-' : ''}${m[1]}${body}${m[4]}${m[5]}`;
}

type Group = 'Maths' | 'Statistics' | 'Logic' | 'Text' | 'Conditional' | 'Lookup' | 'Date';

interface Fn {
  sig: string;
  doc: string;
  group: Group;
  run: (args: Node[], ctx: Ctx) => FValue;
}

const aggregate = (f: (ns: number[]) => FValue) => (args: Node[], ctx: Ctx): FValue => {
  const ns = numbers(args, ctx);
  return isErr(ns) ? ns : f(ns);
};

const unaryNum = (f: (x: number) => FValue) => (args: Node[], ctx: Ctx): FValue => {
  const x = numberArg(args, 0, ctx);
  return isErr(x) ? x : f(x);
};

const textFn = (f: (s: string, args: Node[], ctx: Ctx) => FValue) => (args: Node[], ctx: Ctx): FValue => {
  const v = scalar(args, 0, ctx);
  return isErr(v) ? v : f(str(v), args, ctx);
};

const datePart = (f: (d: Date) => number) => (args: Node[], ctx: Ctx): FValue => {
  const x = numberArg(args, 0, ctx);
  return isErr(x) ? x : f(serialToDate(x));
};

/** Days in a month, `month` counted from 0 and allowed to run past either end of the year. */
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/** Whether a serial day falls Monday to Friday. */
const isWorkday = (serial: number) => {
  const dow = serialToDate(serial).getUTCDay();
  return dow !== 0 && dow !== 6;
};

/** Monday-to-Friday days from `lo` to `hi`, both counted: whole weeks by arithmetic, the rest by looking. */
function workdaysBetween(lo: number, hi: number): number {
  const total = hi - lo + 1;
  if (total <= 0) return 0;
  const weeks = Math.floor(total / 7);
  let count = weeks * 5;
  for (let s = lo + weeks * 7; s <= hi; s++) if (isWorkday(s)) count++;
  return count;
}

const FUNCS: Record<string, Fn> = {
  SUM: { group: 'Maths', sig: 'SUM(value1, [value2], …)', doc: 'Adds numbers and ranges.', run: aggregate(sum) },
  AVERAGE: {
    group: 'Statistics',
    sig: 'AVERAGE(value1, [value2], …)',
    doc: 'The mean of the numbers, blanks skipped.',
    run: aggregate((ns) => (ns.length ? sum(ns) / ns.length : fail('#DIV/0!'))),
  },
  MIN: { group: 'Statistics', sig: 'MIN(value1, [value2], …)', doc: 'The smallest number.', run: aggregate((ns) => (ns.length ? ns.reduce((a, b) => Math.min(a, b)) : 0)) },
  MAX: { group: 'Statistics', sig: 'MAX(value1, [value2], …)', doc: 'The largest number.', run: aggregate((ns) => (ns.length ? ns.reduce((a, b) => Math.max(a, b)) : 0)) },
  MEDIAN: {
    group: 'Statistics',
    sig: 'MEDIAN(value1, [value2], …)',
    doc: 'The middle number.',
    run: aggregate((ns) => {
      if (!ns.length) return fail('#NUM!');
      const s = [...ns].sort((a, b) => a - b);
      const m = s.length >> 1;
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    }),
  },
  STDEV: {
    group: 'Statistics',
    sig: 'STDEV(value1, [value2], …)',
    doc: 'Sample standard deviation.',
    run: aggregate((ns) => {
      if (ns.length < 2) return fail('#DIV/0!');
      const mean = sum(ns) / ns.length;
      return Math.sqrt(ns.reduce((a, x) => a + (x - mean) ** 2, 0) / (ns.length - 1));
    }),
  },
  COUNT: {
    group: 'Statistics',
    sig: 'COUNT(value1, [value2], …)',
    doc: 'How many values are numbers.',
    run: (args, ctx) => flat(args, ctx).filter((v) => typeof v === 'number').length,
  },
  COUNTA: {
    group: 'Statistics',
    sig: 'COUNTA(value1, [value2], …)',
    doc: 'How many values are not empty.',
    run: (args, ctx) => flat(args, ctx).filter((v) => v !== null && v !== '').length,
  },
  PRODUCT: { group: 'Maths', sig: 'PRODUCT(value1, [value2], …)', doc: 'Multiplies numbers together.', run: aggregate((ns) => (ns.length ? ns.reduce((a, b) => a * b, 1) : 0)) },
  SUMPRODUCT: {
    group: 'Maths',
    sig: 'SUMPRODUCT(range1, range2, …)',
    doc: 'Multiplies ranges item by item, then adds — a weighted total.',
    run: (args, ctx) => {
      const lists = args.map((a) => valuesOf(a, ctx).values);
      if (!lists.length) return fail('#N/A');
      const n = lists[0].length;
      if (lists.some((l) => l.length !== n)) return fail('#VALUE!');
      let total = 0;
      for (let i = 0; i < n; i++) {
        let p = 1;
        for (const l of lists) {
          const v = l[i];
          if (isErr(v)) return v;
          p *= typeof v === 'number' ? v : 0;
        }
        total += p;
      }
      return total;
    },
  },
  ROUND: {
    group: 'Maths',
    sig: 'ROUND(number, [digits])',
    doc: 'Rounds to a number of decimal places.',
    run: (args, ctx) => {
      const x = numberArg(args, 0, ctx);
      const d = numberArg(args, 1, ctx, 0);
      return isErr(x) ? x : isErr(d) ? d : roundTo(x, d, 'round');
    },
  },
  ROUNDUP: {
    group: 'Maths',
    sig: 'ROUNDUP(number, [digits])',
    doc: 'Rounds away from zero.',
    run: (args, ctx) => {
      const x = numberArg(args, 0, ctx);
      const d = numberArg(args, 1, ctx, 0);
      return isErr(x) ? x : isErr(d) ? d : roundTo(x, d, 'up');
    },
  },
  ROUNDDOWN: {
    group: 'Maths',
    sig: 'ROUNDDOWN(number, [digits])',
    doc: 'Rounds towards zero.',
    run: (args, ctx) => {
      const x = numberArg(args, 0, ctx);
      const d = numberArg(args, 1, ctx, 0);
      return isErr(x) ? x : isErr(d) ? d : roundTo(x, d, 'down');
    },
  },
  ABS: { group: 'Maths', sig: 'ABS(number)', doc: 'The number without its sign.', run: unaryNum(Math.abs) },
  INT: { group: 'Maths', sig: 'INT(number)', doc: 'Rounds down to a whole number.', run: unaryNum(Math.floor) },
  SQRT: { group: 'Maths', sig: 'SQRT(number)', doc: 'The square root.', run: unaryNum((x) => (x < 0 ? fail('#NUM!') : Math.sqrt(x))) },
  POWER: {
    group: 'Maths',
    sig: 'POWER(base, exponent)',
    doc: 'A number raised to a power.',
    run: (args, ctx) => {
      const b = numberArg(args, 0, ctx);
      const e = numberArg(args, 1, ctx);
      return isErr(b) ? b : isErr(e) ? e : binary('^', b, e);
    },
  },
  MOD: {
    group: 'Maths',
    sig: 'MOD(number, divisor)',
    doc: 'The remainder, with the sign of the divisor.',
    run: (args, ctx) => {
      const n = numberArg(args, 0, ctx);
      const d = numberArg(args, 1, ctx);
      if (isErr(n)) return n;
      if (isErr(d)) return d;
      return d === 0 ? fail('#DIV/0!') : n - d * Math.floor(n / d);
    },
  },
  PI: { group: 'Maths', sig: 'PI()', doc: 'π, to fifteen digits.', run: () => Math.PI },
  IF: {
    group: 'Logic',
    sig: 'IF(test, if_true, [if_false])',
    doc: 'One value when the test holds, another when it does not.',
    // Only the branch taken is evaluated, so IF(B2=0, 0, A2/B2) never divides by zero.
    run: (args, ctx) => {
      const t = bool(scalar(args, 0, ctx));
      if (isErr(t)) return t;
      return t ? scalar(args, 1, ctx) : args[2] ? scalar(args, 2, ctx) : false;
    },
  },
  IFS: {
    group: 'Logic',
    sig: 'IFS(test1, value1, [test2, value2], …)',
    doc: 'The value beside the first test that holds.',
    run: (args, ctx) => {
      if (args.length < 2 || args.length % 2) return fail('#N/A');
      for (let i = 0; i < args.length; i += 2) {
        const t = bool(scalar(args, i, ctx));
        if (isErr(t)) return t;
        if (t) return scalar(args, i + 1, ctx);
      }
      return fail('#N/A');
    },
  },
  IFERROR: {
    group: 'Logic',
    sig: 'IFERROR(value, if_error)',
    doc: 'The value, or a fallback when it is an error.',
    run: (args, ctx) => {
      const v = scalar(args, 0, ctx);
      return isErr(v) ? scalar(args, 1, ctx) : v;
    },
  },
  AND: {
    group: 'Logic',
    sig: 'AND(test1, [test2], …)',
    doc: 'True when every test is true.',
    run: (args, ctx) => {
      let seen = false;
      for (const v of flat(args, ctx)) {
        if (v === null || typeof v === 'string') continue;
        const b = bool(v);
        if (isErr(b)) return b;
        seen = true;
        if (!b) return false;
      }
      return seen ? true : fail('#VALUE!');
    },
  },
  OR: {
    group: 'Logic',
    sig: 'OR(test1, [test2], …)',
    doc: 'True when any test is true.',
    run: (args, ctx) => {
      let seen = false;
      for (const v of flat(args, ctx)) {
        if (v === null || typeof v === 'string') continue;
        const b = bool(v);
        if (isErr(b)) return b;
        seen = true;
        if (b) return true;
      }
      return seen ? false : fail('#VALUE!');
    },
  },
  NOT: {
    group: 'Logic',
    sig: 'NOT(test)',
    doc: 'The opposite of a test.',
    run: (args, ctx) => {
      const b = bool(scalar(args, 0, ctx));
      return isErr(b) ? b : !b;
    },
  },
  COUNTIF: {
    group: 'Conditional',
    sig: 'COUNTIF(range, criterion)',
    doc: 'Counts cells that match, like ">10" or "Done".',
    run: (args, ctx) => conditional(args, ctx, 'count'),
  },
  SUMIF: {
    group: 'Conditional',
    sig: 'SUMIF(range, criterion, [sum_range])',
    doc: 'Adds the values whose row matches.',
    run: (args, ctx) => conditional(args, ctx, 'sum'),
  },
  AVERAGEIF: {
    group: 'Conditional',
    sig: 'AVERAGEIF(range, criterion, [average_range])',
    doc: 'The mean of the values whose row matches.',
    run: (args, ctx) => conditional(args, ctx, 'average'),
  },
  SUMIFS: {
    group: 'Conditional',
    sig: 'SUMIFS(sum_range, range1, criterion1, …)',
    doc: 'Adds the values whose row matches every criterion.',
    run: (args, ctx) => {
      if (args.length < 3 || args.length % 2 === 0) return fail('#N/A');
      const taken = valuesOf(args[0], ctx).values;
      const pass = multiConditional(
        args.slice(1).filter((_, i) => i % 2 === 0),
        args.slice(1).filter((_, i) => i % 2 === 1),
        ctx
      );
      if (isErr(pass)) return pass;
      if (pass.length !== taken.length) return fail('#VALUE!');
      let total = 0;
      pass.forEach((ok, i) => {
        if (ok && typeof taken[i] === 'number') total += taken[i] as number;
      });
      return total;
    },
  },
  COUNTIFS: {
    group: 'Conditional',
    sig: 'COUNTIFS(range1, criterion1, [range2, criterion2], …)',
    doc: 'Counts rows that match every criterion.',
    run: (args, ctx) => {
      if (args.length < 2 || args.length % 2) return fail('#N/A');
      const pass = multiConditional(
        args.filter((_, i) => i % 2 === 0),
        args.filter((_, i) => i % 2 === 1),
        ctx
      );
      return isErr(pass) ? pass : pass.filter(Boolean).length;
    },
  },
  MATCH: {
    group: 'Lookup',
    sig: 'MATCH(value, range, [match_type])',
    doc: 'The position of a value in a range: 0 exact, 1 largest at or below.',
    run: (args, ctx) => {
      const v = scalar(args, 0, ctx);
      if (isErr(v)) return v;
      const mode = numberArg(args, 2, ctx, 1);
      if (isErr(mode)) return mode;
      const list = args[1] ? valuesOf(args[1], ctx).values : [];
      const i = matchIndex(v, list, Math.sign(mode));
      return i < 0 ? fail('#N/A') : i + 1;
    },
  },
  INDEX: {
    group: 'Lookup',
    sig: 'INDEX(range, row, [column])',
    doc: 'The value at a row and column of a range, counted from 1.',
    run: (args, ctx) => {
      if (!args[0]) return fail('#N/A');
      const grid = gridOf(args[0], ctx);
      if (isErr(grid)) return grid;
      const r = numberArg(args, 1, ctx, 1);
      const c = numberArg(args, 2, ctx, 1);
      if (isErr(r)) return r;
      if (isErr(c)) return c;
      // One row or one column: the single index reads along it.
      if (grid.length === 1 && args.length === 2) return grid[0][Math.trunc(r) - 1] ?? fail('#REF!');
      return grid[Math.trunc(r) - 1]?.[Math.trunc(c) - 1] ?? fail('#REF!');
    },
  },
  VLOOKUP: {
    group: 'Lookup',
    sig: 'VLOOKUP(value, range, column, [approximate])',
    doc: "Finds a value in a range's first column and returns another column of its row.",
    run: (args, ctx) => {
      const v = scalar(args, 0, ctx);
      if (isErr(v)) return v;
      if (!args[1]) return fail('#N/A');
      const grid = gridOf(args[1], ctx);
      if (isErr(grid)) return grid;
      const col = numberArg(args, 2, ctx);
      if (isErr(col)) return col;
      const approx = args[3] ? bool(scalar(args, 3, ctx)) : true;
      if (isErr(approx)) return approx;
      const i = matchIndex(v, columnOf(grid, 0), approx ? 1 : 0);
      if (i < 0) return fail('#N/A');
      return grid[i][Math.trunc(col) - 1] ?? fail('#REF!');
    },
  },
  XLOOKUP: {
    group: 'Lookup',
    sig: 'XLOOKUP(value, lookup_range, return_range, [if_not_found], [match_mode])',
    doc: 'Finds a value and returns what sits beside it in another range.',
    run: (args, ctx) => {
      const v = scalar(args, 0, ctx);
      if (isErr(v)) return v;
      if (!args[1] || !args[2]) return fail('#N/A');
      const keys = valuesOf(args[1], ctx).values;
      const vals = valuesOf(args[2], ctx).values;
      if (keys.length !== vals.length) return fail('#VALUE!');
      const mode = numberArg(args, 4, ctx, 0);
      if (isErr(mode)) return mode;
      // -1: exact, or the next smaller; 1: exact, or the next larger.
      const i = mode === 0 ? matchIndex(v, keys, 0) : matchIndex(v, keys, mode < 0 ? 1 : -1);
      if (i >= 0) return vals[i];
      return args[3] && args[3].k !== 'blank' ? scalar(args, 3, ctx) : fail('#N/A');
    },
  },
  TODAY: {
    group: 'Date',
    sig: 'TODAY()',
    doc: "Today's date — kept current, minute by minute, while the table is on the board.",
    run: () => {
      const d = new Date();
      return dateSerial(d.getFullYear(), d.getMonth() + 1, d.getDate());
    },
  },
  NOW: {
    group: 'Date',
    sig: 'NOW()',
    doc: 'The date and time now, as a serial number.',
    run: () => {
      const d = new Date();
      return dateSerial(d.getFullYear(), d.getMonth() + 1, d.getDate()) + (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400;
    },
  },
  DATE: {
    group: 'Date',
    sig: 'DATE(year, month, day)',
    doc: 'A date from its parts; months and days past the end roll over.',
    run: (args, ctx) => {
      const y = numberArg(args, 0, ctx);
      const m = numberArg(args, 1, ctx);
      const d = numberArg(args, 2, ctx);
      if (isErr(y)) return y;
      if (isErr(m)) return m;
      if (isErr(d)) return d;
      return dateSerial(Math.trunc(y), Math.trunc(m), Math.trunc(d));
    },
  },
  YEAR: { group: 'Date', sig: 'YEAR(date)', doc: 'The year of a date.', run: datePart((d) => d.getUTCFullYear()) },
  MONTH: { group: 'Date', sig: 'MONTH(date)', doc: 'The month of a date, 1 to 12.', run: datePart((d) => d.getUTCMonth() + 1) },
  DAY: { group: 'Date', sig: 'DAY(date)', doc: 'The day of the month of a date.', run: datePart((d) => d.getUTCDate()) },
  EDATE: {
    group: 'Date',
    sig: 'EDATE(start, months)',
    doc: 'The same day some months later (or earlier); a day past the month’s end is its last day.',
    run: (args, ctx) => {
      const s = numberArg(args, 0, ctx);
      const m = numberArg(args, 1, ctx);
      if (isErr(s)) return s;
      if (isErr(m)) return m;
      const d = serialToDate(Math.floor(s));
      const y = d.getUTCFullYear();
      const mo = d.getUTCMonth() + Math.trunc(m);
      return dateSerial(y, mo + 1, Math.min(d.getUTCDate(), daysInMonth(y, mo)));
    },
  },
  EOMONTH: {
    group: 'Date',
    sig: 'EOMONTH(start, months)',
    doc: 'The last day of the month some months after (or before) a date.',
    run: (args, ctx) => {
      const s = numberArg(args, 0, ctx);
      const m = numberArg(args, 1, ctx);
      if (isErr(s)) return s;
      if (isErr(m)) return m;
      const d = serialToDate(Math.floor(s));
      const y = d.getUTCFullYear();
      const mo = d.getUTCMonth() + Math.trunc(m);
      return dateSerial(y, mo + 1, daysInMonth(y, mo));
    },
  },
  WEEKDAY: {
    group: 'Date',
    sig: 'WEEKDAY(date, [type])',
    doc: 'The day of the week: 1 Sunday to 7 Saturday; type 2 counts 1 Monday to 7 Sunday, type 3 from 0 Monday.',
    run: (args, ctx) => {
      const s = numberArg(args, 0, ctx);
      const type = numberArg(args, 1, ctx, 1);
      if (isErr(s)) return s;
      if (isErr(type)) return type;
      const dow = serialToDate(Math.floor(s)).getUTCDay();
      switch (Math.trunc(type)) {
        case 1:
          return dow + 1;
        case 2:
          return ((dow + 6) % 7) + 1;
        case 3:
          return (dow + 6) % 7;
        default:
          return fail('#NUM!');
      }
    },
  },
  NETWORKDAYS: {
    group: 'Date',
    sig: 'NETWORKDAYS(start, end, [holidays])',
    doc: 'Working days, Monday to Friday, from one date to another — both counted — less any holidays.',
    run: (args, ctx) => {
      const a = numberArg(args, 0, ctx);
      const b = numberArg(args, 1, ctx);
      if (isErr(a)) return a;
      if (isErr(b)) return b;
      const holidays = new Set<number>();
      if (args[2] && args[2].k !== 'blank') {
        for (const v of valuesOf(args[2], ctx).values) {
          if (isErr(v)) return v;
          if (v === null || v === '') continue;
          const n = num(v);
          if (isErr(n)) return n;
          holidays.add(Math.floor(n));
        }
      }
      const lo = Math.floor(Math.min(a, b));
      const hi = Math.floor(Math.max(a, b));
      const count = workdaysBetween(lo, hi) - [...holidays].filter((h) => h >= lo && h <= hi && isWorkday(h)).length;
      return a <= b ? count : -count;
    },
  },
  DATEDIF: {
    group: 'Date',
    sig: 'DATEDIF(start, end, unit)',
    doc: 'Whole years "Y", months "M" or days "D" between two dates; "MD", "YM", "YD" ignore the larger units.',
    run: (args, ctx) => {
      const a = numberArg(args, 0, ctx);
      const b = numberArg(args, 1, ctx);
      const unit = scalar(args, 2, ctx);
      if (isErr(a)) return a;
      if (isErr(b)) return b;
      if (isErr(unit)) return unit;
      const s1 = Math.floor(a);
      const s2 = Math.floor(b);
      if (s1 > s2) return fail('#NUM!');
      const d1 = serialToDate(s1);
      const d2 = serialToDate(s2);
      const [y1, m1, day1] = [d1.getUTCFullYear(), d1.getUTCMonth(), d1.getUTCDate()];
      const [y2, m2, day2] = [d2.getUTCFullYear(), d2.getUTCMonth(), d2.getUTCDate()];
      switch (str(unit).trim().toUpperCase()) {
        case 'Y':
          return y2 - y1 - (m2 < m1 || (m2 === m1 && day2 < day1) ? 1 : 0);
        case 'M':
          return (y2 - y1) * 12 + (m2 - m1) - (day2 < day1 ? 1 : 0);
        case 'D':
          return s2 - s1;
        case 'MD':
          return day2 >= day1 ? day2 - day1 : s2 - dateSerial(y2, m2, day1);
        case 'YM':
          return (m2 - m1 + 12 - (day2 < day1 ? 1 : 0)) % 12;
        case 'YD': {
          let from = dateSerial(y2, m1 + 1, day1);
          if (from > s2) from = dateSerial(y2 - 1, m1 + 1, day1);
          return s2 - from;
        }
        default:
          return fail('#NUM!');
      }
    },
  },
  CONCAT: {
    group: 'Text',
    sig: 'CONCAT(text1, [text2], …)',
    doc: 'Joins text together.',
    run: (args, ctx) => {
      const vs = flat(args, ctx);
      const e = vs.find(isErr);
      return e ?? vs.map(str).join('');
    },
  },
  LEN: { group: 'Text', sig: 'LEN(text)', doc: 'How many characters.', run: textFn((s) => s.length) },
  UPPER: { group: 'Text', sig: 'UPPER(text)', doc: 'In capitals.', run: textFn((s) => s.toUpperCase()) },
  LOWER: { group: 'Text', sig: 'LOWER(text)', doc: 'In lower case.', run: textFn((s) => s.toLowerCase()) },
  TRIM: { group: 'Text', sig: 'TRIM(text)', doc: 'Without extra spaces.', run: textFn((s) => s.trim().replace(/\s+/g, ' ')) },
  LEFT: {
    group: 'Text',
    sig: 'LEFT(text, [count])',
    doc: 'The first characters.',
    run: textFn((s, args, ctx) => {
      const n = numberArg(args, 1, ctx, 1);
      return isErr(n) ? n : s.slice(0, Math.max(0, n));
    }),
  },
  RIGHT: {
    group: 'Text',
    sig: 'RIGHT(text, [count])',
    doc: 'The last characters.',
    run: textFn((s, args, ctx) => {
      const n = numberArg(args, 1, ctx, 1);
      return isErr(n) ? n : n <= 0 ? '' : s.slice(-n);
    }),
  },
  MID: {
    group: 'Text',
    sig: 'MID(text, start, count)',
    doc: 'Characters from the middle, starting at 1.',
    run: textFn((s, args, ctx) => {
      const start = numberArg(args, 1, ctx);
      const n = numberArg(args, 2, ctx);
      if (isErr(start)) return start;
      if (isErr(n)) return n;
      if (start < 1 || n < 0) return fail('#VALUE!');
      return s.slice(Math.trunc(start) - 1, Math.trunc(start) - 1 + Math.trunc(n));
    }),
  },
  TEXT: {
    group: 'Text',
    sig: 'TEXT(value, format)',
    doc: 'A number or date as text: "0.00", "#,##0", "0%", "yyyy-mm-dd".',
    run: (args, ctx) => {
      const v = scalar(args, 0, ctx);
      const f = scalar(args, 1, ctx);
      if (isErr(f)) return f;
      return textFormat(v, str(f));
    },
  },
};
FUNCS.AVG = FUNCS.AVERAGE;
FUNCS.CONCATENATE = FUNCS.CONCAT;

/** The functions a formula can call, for the editor's suggestions and reference. */
export const FORMULA_FUNCTIONS: ReadonlyArray<{ name: string; sig: string; doc: string; group: Group }> = Object.entries(FUNCS)
  .filter(([name]) => name !== 'AVG' && name !== 'CONCATENATE')
  .map(([name, f]) => ({ name, sig: f.sig, doc: f.doc, group: f.group }))
  .sort((a, b) => a.name.localeCompare(b.name));

// ---------------------------------------------------------------------------
// References in formula text
// ---------------------------------------------------------------------------

/**
 * A cell reference or range in formula text. The lookarounds keep it from
 * matching inside a name — `LOG10(` is a function, not column LOG row 10 —
 * and the caller skips string literals, so `"A1"` stays text.
 *
 * A reference into another table (`Budget!B2:B5`, or `'Q3 plan'!B2` once the
 * quoted title has been stepped over) is matched whole by the first group and
 * left alone: its rows and columns belong to that table, and matching only the
 * part after the colon would move one end of the range and not the other.
 */
const REF_G = /(!\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?)|(?<![A-Za-z0-9_.$!])(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?::(\$?)([A-Za-z]{1,3})(\$?)(\d+))?(?![A-Za-z0-9_.(!])/g;
/** Strings and quoted table titles, both of which reference rewriting must step over. */
const STRING_G = /"(?:[^"]|"")*"?|'(?:[^']|'')*'?/g;

/** Apply `fn` to the parts of `src` outside string literals. */
function outsideStrings(src: string, fn: (part: string, offset: number) => string): string {
  let out = '';
  let last = 0;
  for (const m of src.matchAll(STRING_G)) {
    const at = m.index ?? 0;
    out += fn(src.slice(last, at), last) + m[0];
    last = at + m[0].length;
  }
  return out + fn(src.slice(last), last);
}

/** The parts of one REF_G match in this table: `$` marks, letters and row numbers, the second end absent for a single cell. */
interface RefMatch {
  d1: string;
  l1: string;
  d2: string;
  n1: string;
  d3?: string;
  l2?: string;
  d4?: string;
  n2?: string;
}

/** Rewrite every in-table reference in formula text; references into other tables pass through. */
function replaceRefs(src: string, fn: (m: RefMatch, whole: string) => string): string {
  return outsideStrings(src, (part) =>
    part.replace(REF_G, (whole, cross: string | undefined, d1: string, l1: string, d2: string, n1: string, d3?: string, l2?: string, d4?: string, n2?: string) =>
      cross ? whole : fn({ d1, l1, d2, n1, d3, l2, d4, n2 }, whole)
    )
  );
}

export interface FormulaRef {
  /** Character span in the text given. */
  start: number;
  end: number;
  /** Written row labels and column indices, low to high. */
  r0: number;
  r1: number;
  c0: number;
  c1: number;
}

/** Every reference to this table in formula text, with where it is — for highlighting the cells a formula reads. */
export function referencesIn(src: string): FormulaRef[] {
  const out: FormulaRef[] = [];
  outsideStrings(src, (part, offset) => {
    for (const m of part.matchAll(REF_G)) {
      if (m[1]) continue;
      const at = (m.index ?? 0) + offset;
      const ca = colFromLetters(m[3]);
      const ra = Number(m[5]);
      const cb = m[7] ? colFromLetters(m[7]) : ca;
      const rb = m[9] ? Number(m[9]) : ra;
      out.push({ start: at, end: at + m[0].length, r0: Math.min(ra, rb), r1: Math.max(ra, rb), c0: Math.min(ca, cb), c1: Math.max(ca, cb) });
    }
    return part;
  });
  return out;
}

/** The surviving ends of a span after a structural change, or null if nothing of it survives. */
function mapSpan(a: number, b: number, map: (i: number) => number): [number, number] | null {
  let lo = -1;
  let hi = -1;
  for (let i = a; i <= b; i++) {
    const m = map(i);
    if (m >= 0) {
      lo = m;
      break;
    }
  }
  for (let i = b; i >= a; i--) {
    const m = map(i);
    if (m >= 0) {
      hi = m;
      break;
    }
  }
  return lo < 0 || hi < 0 ? null : [Math.min(lo, hi), Math.max(lo, hi)];
}

/**
 * Formula text with its references moved to follow their cells.
 *
 * `mapRow` and `mapCol` take a stored index to its new index, or -1 when it
 * was deleted. Row numbers are converted through the table's count both ways
 * (`skip`), so `B3` still means the same cell afterwards.
 */
export function rewriteRefs(src: string, skip: boolean, mapRow: (r: number) => number, mapCol: (c: number) => number): string {
  const rows = (la: number, lb: number): [number, number] | null => {
    if (Math.min(la, lb) < 1) return [la, lb];
    const span = mapSpan(storedOf(skip, Math.min(la, lb)), storedOf(skip, Math.max(la, lb)), mapRow);
    return span ? [rowLabel(skip, span[0]), rowLabel(skip, span[1])] : null;
  };
  const cols = (ca: number, cb: number) => mapSpan(Math.min(ca, cb), Math.max(ca, cb), mapCol);
  return replaceRefs(src, ({ d1, l1, d2, n1, d3, l2, d4, n2 }, whole) => {
    const ca = colFromLetters(l1);
    const ra = Number(n1);
    if (!l2 || !n2) {
      const r = rows(ra, ra);
      const c = cols(ca, ca);
      return r && c ? `${d1}${lettersOf(c[0])}${d2}${r[0]}` : '#REF!';
    }
    const r = rows(ra, Number(n2));
    const c = cols(ca, colFromLetters(l2));
    if (!r || !c) return '#REF!';
    const out = `${d1}${lettersOf(c[0])}${d2}${r[0]}:${d3 ?? ''}${lettersOf(c[1])}${d4 ?? ''}${r[1]}`;
    return out === whole ? whole : out;
  });
}

/**
 * Formula text with every row number one higher — the move from the count in
 * which the header had no number to the spreadsheet's. Absolute references
 * move too: `$` pins a reference against copying, not against renumbering.
 * References into other tables are counted by that table and stay as written.
 */
export function migrateFormulaRows(src: string): string {
  return replaceRefs(src, ({ d1, l1, d2, n1, d3, l2, d4, n2 }) => {
    const a = `${d1}${l1}${d2}${Number(n1) + 1}`;
    return l2 && n2 ? `${a}:${d3 ?? ''}${l2}${d4 ?? ''}${Number(n2) + 1}` : a;
  });
}

/**
 * Formula text copied `dr` rows down and `dc` columns across, the way a
 * spreadsheet fills or pastes it: relative parts move, `$`-pinned parts stay.
 * A reference pushed off the top or left edge is `#REF!`. A reference into
 * another table stays as written, whole.
 */
export function shiftRefs(src: string, dr: number, dc: number): string {
  if (dr === 0 && dc === 0) return src;
  const one = (dCol: string, letters: string, dRow: string, n: string): string | null => {
    const c = dCol ? colFromLetters(letters) : colFromLetters(letters) + dc;
    const r = dRow ? Number(n) : Number(n) + dr;
    if (c < 0 || r < 1) return null;
    return `${dCol}${lettersOf(c)}${dRow}${r}`;
  };
  return replaceRefs(src, ({ d1, l1, d2, n1, d3, l2, d4, n2 }) => {
    const a = one(d1, l1, d2, n1);
    if (!l2 || !n2) return a ?? '#REF!';
    const b = one(d3 ?? '', l2, d4 ?? '', n2);
    return a && b ? `${a}:${b}` : '#REF!';
  });
}

// ---------------------------------------------------------------------------
// References by identity, for the stored form
// ---------------------------------------------------------------------------

/**
 * A reference as the shared document stores it: by the ids of its column and
 * row, `⟨$col,$row⟩`, rather than by position.
 *
 * Positions are what people read and type, and what a concurrent edit moves:
 * a row somebody inserts above a formula's cells renumbers them on every
 * screen, and a formula stored as `=A5*2` by someone who had not yet seen
 * that insert would point at the wrong row once the two edits merge. Stored
 * by identity, a reference means the same cell whatever was inserted or moved
 * around it, and is turned back into `A5` for whoever reads it.
 *
 * Only references that name a cell the table has are stored this way. One
 * past the table's edge (`=A9999`) has no identity to keep and stays as
 * written, read by position as before; so does a reference into another table.
 */
const ID_REF_G = /⟨(\$?)([\w-]+),(\$?)([\w-]+)⟩/g;

/** Formula text (after the `=`) with this table's in-range references stored by identity. */
export function toIdForm(src: string, skip: boolean, rowIds: readonly string[], colIds: readonly string[]): string {
  const one = (dCol: string, letters: string, dRow: string, n: string): string | null => {
    const c = colFromLetters(letters);
    const r = storedOf(skip, Number(n));
    if (Number(n) < 1 || r < 0 || r >= rowIds.length || c < 0 || c >= colIds.length) return null;
    return `⟨${dCol}${colIds[c]},${dRow}${rowIds[r]}⟩`;
  };
  return replaceRefs(src, ({ d1, l1, d2, n1, d3, l2, d4, n2 }, whole) => {
    const a = one(d1, l1, d2, n1);
    if (!l2 || !n2) return a ?? whole;
    const b = one(d3 ?? '', l2, d4 ?? '', n2);
    return a && b ? `${a}:${b}` : whole;
  });
}

/**
 * Stored formula text (after the `=`) read back into references by position,
 * counted the spreadsheet's way. A reference whose row or column has been
 * deleted is `#REF!`, as it would have become had the deletion been seen.
 */
export function fromIdForm(src: string, rowAt: ReadonlyMap<string, number>, colAt: ReadonlyMap<string, number>): string {
  if (!src.includes('⟨')) return src;
  return outsideStrings(src, (part) =>
    part.replace(/⟨(\$?)([\w-]+),(\$?)([\w-]+)⟩(?::⟨(\$?)([\w-]+),(\$?)([\w-]+)⟩)?/g, (_whole, d1: string, c1: string, d2: string, r1: string, d3?: string, c2?: string, d4?: string, r2?: string) => {
      const ca = colAt.get(c1);
      const ra = rowAt.get(r1);
      if (ca === undefined || ra === undefined) return '#REF!';
      const a = `${d1}${lettersOf(ca)}${d2}${ra + 1}`;
      if (!c2 || !r2) return a;
      const cb = colAt.get(c2);
      const rb = rowAt.get(r2);
      if (cb === undefined || rb === undefined) return '#REF!';
      return `${a}:${d3 ?? ''}${lettersOf(cb)}${d4 ?? ''}${rb + 1}`;
    })
  );
}

/** Whether stored formula text holds any reference by identity. */
export const hasIdRefs = (src: string) => {
  ID_REF_G.lastIndex = 0;
  return ID_REF_G.test(src);
};

// ---------------------------------------------------------------------------
// R1C1, as Google Sheets writes formulas onto the clipboard
// ---------------------------------------------------------------------------

/** `R[-1]C[2]`, `R3C1`, `RC[1]` — one cell in R1C1 notation. */
const R1C1_G = /(?<![A-Za-z0-9_.$])R(\[-?\d+\]|\d+)?C(\[-?\d+\]|\d+)?(?:(:)R(\[-?\d+\]|\d+)?C(\[-?\d+\]|\d+)?)?(?![A-Za-z0-9_.(!])/g;

/**
 * A formula Google Sheets put on the clipboard (`data-sheets-formula`, always
 * R1C1: `=R[0]C[-1]*2`) in A1 notation for the cell it lands in — stored row
 * `r`, column `c`, counted the spreadsheet's way. Null when a reference would
 * fall off the top or left of the sheet, or the text has parts R1C1 cannot be
 * turned from (a whole row or column); the caller then keeps the cell's value.
 */
export function r1c1ToA1(formula: string, r: number, c: number): string | null {
  if (!isFormula(formula)) return null;
  let failed = false;
  const axis = (part: string | undefined, here: number): { n: number; abs: boolean } | null => {
    if (part === undefined) return { n: here, abs: false };
    if (part.startsWith('[')) return { n: here + Number(part.slice(1, -1)), abs: false };
    return { n: Number(part) - 1, abs: true };
  };
  const cell = (rp: string | undefined, cp: string | undefined): string => {
    const row = axis(rp, r);
    const col = axis(cp, c);
    if (!row || !col || row.n < 0 || col.n < 0) {
      failed = true;
      return '';
    }
    return `${col.abs ? '$' : ''}${lettersOf(col.n)}${row.abs ? '$' : ''}${row.n + 1}`;
  };
  const body = outsideStrings(formula.slice(1), (part) =>
    part.replace(R1C1_G, (_w, r1?: string, c1?: string, colon?: string, r2?: string, c2?: string) => {
      const a = cell(r1, c1);
      return colon ? `${a}:${cell(r2, c2)}` : a;
    })
  );
  if (failed) return null;
  // Anything still R1C1-shaped (a whole row `R[1]`, a whole column `C[2]`) has no A1 cell to become.
  if (/(?<![A-Za-z0-9_.$])[RC]\[-?\d+\](?![A-Za-z0-9_.(])/.test(body)) return null;
  return `=${body}`;
}

/**
 * Formula text with references to a renamed table following it: `'Q3'!B2`
 * and `Q3!B2` become `'Q3 final'!B2`. The new title is quoted whenever it is
 * not a plain name. Titles compare without case, as references resolve.
 */
export function renameTableRefs(src: string, from: string, to: string): string {
  const old = from.trim().toLowerCase();
  const next = to.trim();
  if (!old || !next) return src;
  const written = /^[A-Za-z_][A-Za-z0-9_.]*$/.test(next) && !/^[A-Za-z]{1,3}\d+$/.test(next) ? next : `'${next.replace(/'/g, "''")}'`;
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"') {
      const end = src.indexOf('"', i + 1);
      const stop = end < 0 ? src.length : end + 1;
      out += src.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === "'") {
      let j = i + 1;
      let name = '';
      while (j < src.length) {
        if (src[j] === "'" && src[j + 1] === "'") {
          name += "'";
          j += 2;
          continue;
        }
        if (src[j] === "'") break;
        name += src[j++];
      }
      if (src[j + 1] === '!' && name.trim().toLowerCase() === old) {
        out += `${written}!`;
        i = j + 2;
        continue;
      }
      out += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    const m = /^[A-Za-z_][A-Za-z0-9_.]*!/.exec(src.slice(i));
    if (m && (i === 0 || !/[A-Za-z0-9_.$]/.test(src[i - 1]))) {
      out += m[0].slice(0, -1).toLowerCase() === old ? `${written}!` : m[0];
      i += m[0].length;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

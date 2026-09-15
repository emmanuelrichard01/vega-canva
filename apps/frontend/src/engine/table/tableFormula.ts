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
 * ## References are what the gutters say
 *
 * `B3` is column B and the row the gutter numbers 3. With a header row on,
 * the header is `H` and has no number, so `B1` is the first row of data — a
 * reference always matches the label the person can see beside the cell.
 * References follow their cells when rows and columns are inserted, deleted or
 * moved (`rewriteRefs`, called from `tableModel`); one whose cell is deleted
 * becomes `#REF!`, and a range that loses an end shrinks to what is left.
 *
 * ## Values
 *
 * Evaluation never rewrites the stored text. A cell reads as a spreadsheet
 * would read it: `$1,250` is 1250, `12%` is 0.12, a bare number in a percent
 * column is the percentage it displays, `TRUE` is true, and a blank is empty —
 * 0 in arithmetic, skipped by AVERAGE and COUNT.
 *
 * ## Cost
 *
 * Results are memoised per spec object, and specs are immutable, so a table
 * is evaluated once per edit however many times it is drawn; parses are
 * cached by source text. A cycle is caught, and every cell in it shows
 * `#CYCLE!` rather than hanging the board.
 */

export type FErrCode = '#REF!' | '#DIV/0!' | '#NAME?' | '#VALUE!' | '#CYCLE!' | '#ERROR!' | '#NUM!' | '#N/A';
export interface FErr {
  err: FErrCode;
}
export type FValue = number | string | boolean | null | FErr;

export const isErr = (v: unknown): v is FErr => typeof v === 'object' && v !== null && 'err' in v;
const fail = (code: FErrCode): FErr => ({ err: code });

/** A formula is text that starts with `=` and has something after it. */
export const isFormula = (raw: string): boolean => raw.length > 1 && raw.charCodeAt(0) === 61;

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

/** The number the gutter shows for a stored row — what a reference is written with. */
export const rowLabel = (header: boolean, r: number) => (header ? r : r + 1);
/** The stored row a written row number means. */
export const storedOf = (header: boolean, label: number) => (header ? label : label - 1);

/** A reference to one stored cell, as it would be typed — null for the header row, which has no number. */
export function refName(header: boolean, r: number, c: number): string | null {
  if (header && r === 0) return null;
  return `${lettersOf(c)}${rowLabel(header, r)}`;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

type Tok =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'id'; v: string }
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
  | { k: 'ref'; row: number; col: number }
  | { k: 'range'; r0: number; c0: number; r1: number; c1: number }
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
    if (ch === '#') {
      const lit = ERR_LITERALS.find((e) => src.startsWith(e, i));
      if (!lit) return fail('#ERROR!');
      out.push({ t: 'err', v: lit });
      i += lit.length;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_.$]*/.exec(src.slice(i))!;
      out.push({ t: 'id', v: m[0] });
      i += m[0].length;
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

function parseUncached(src: string): Node {
  const toks = tokenize(src);
  if (isErr(toks)) return { k: 'err', e: toks };
  let i = 0;
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
  const primary = (): Node => {
    const t = toks[i++];
    switch (t.t) {
      case 'num':
        return { k: 'num', v: t.v };
      case 'str':
        return { k: 'str', v: t.v };
      case 'err':
        return { k: 'err', e: fail(t.v) };
      case '(': {
        const e = comparison();
        expect(')');
        return e;
      }
      case 'id': {
        if (toks[i].t === '(') {
          i++;
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
          return { k: 'call', name: t.v.toUpperCase(), args };
        }
        const up = t.v.toUpperCase();
        if (up === 'TRUE' || up === 'FALSE') return { k: 'bool', v: up === 'TRUE' };
        const ref = parseRef(t.v);
        if (!ref) return { k: 'err', e: fail('#NAME?') };
        if (toks[i].t === ':') {
          i++;
          const t2 = toks[i++];
          const ref2 = t2.t === 'id' ? parseRef(t2.v) : null;
          if (!ref2) throw SYNTAX;
          return { k: 'range', r0: ref.row, c0: ref.col, r1: ref2.row, c1: ref2.col };
        }
        return { k: 'ref', row: ref.row, col: ref.col };
      }
      default:
        throw SYNTAX;
    }
  };

  try {
    const node = comparison();
    if (toks[i].t !== 'end') throw SYNTAX;
    return node;
  } catch {
    return { k: 'err', e: fail('#ERROR!') };
  }
}

const astCache = new Map<string, Node>();

function parse(src: string): Node {
  const hit = astCache.get(src);
  if (hit) return hit;
  const node = parseUncached(src);
  if (astCache.size > 4000) astCache.clear();
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
  return n === null ? fail('#VALUE!') : n;
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

interface Ctx {
  spec: TableSpec;
  memo: Map<number, FValue>;
  stack: Set<number>;
}

const KEY = 4096;
const memos = new WeakMap<TableSpec, Map<number, FValue>>();

/** A stored cell's value: its literal reading, or its formula's result. */
export function evaluateCell(spec: TableSpec, r: number, c: number): FValue {
  let memo = memos.get(spec);
  if (!memo) {
    memo = new Map();
    memos.set(spec, memo);
  }
  return cellValue({ spec, memo, stack: new Set() }, r, c);
}

function cellValue(ctx: Ctx, r: number, c: number): FValue {
  const raw = ctx.spec.cells[r]?.[c];
  if (raw === undefined) return fail('#REF!');
  if (!isFormula(raw)) return literal(raw, ctx.spec.columns[c]?.type ?? 'text');
  const k = r * KEY + c;
  const hit = ctx.memo.get(k);
  if (hit !== undefined) return hit;
  if (ctx.stack.has(k)) return fail('#CYCLE!');
  ctx.stack.add(k);
  const v = evalNode(parse(raw.slice(1)), ctx);
  ctx.stack.delete(k);
  ctx.memo.set(k, v);
  return v;
}

function evalNode(n: Node, ctx: Ctx): FValue {
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
      const r = storedOf(ctx.spec.header, n.row);
      if (n.row < 1 || r < 0 || r >= ctx.spec.cells.length || n.col >= ctx.spec.columns.length) return fail('#REF!');
      return cellValue(ctx, r, n.col);
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

/** Every value an argument stands for: a range's cells (clipped to the table), or the one value. */
function valuesOf(arg: Node, ctx: Ctx): { values: FValue[]; range: boolean } {
  if (arg.k !== 'range') return { values: [evalNode(arg, ctx)], range: false };
  const { spec } = ctx;
  if (Math.min(arg.r0, arg.r1) < 1) return { values: [fail('#REF!')], range: true };
  const r0 = Math.max(storedOf(spec.header, Math.min(arg.r0, arg.r1)), spec.header ? 1 : 0);
  const r1 = Math.min(storedOf(spec.header, Math.max(arg.r0, arg.r1)), spec.cells.length - 1);
  const c0 = Math.min(arg.c0, arg.c1);
  const c1 = Math.min(Math.max(arg.c0, arg.c1), spec.columns.length - 1);
  const values: FValue[] = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) values.push(cellValue(ctx, r, c));
  return { values, range: true };
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

/** A COUNTIF-style test: `">10"`, `"<>Done"`, `"Open"`, or a number. */
function criterion(v: FValue): (x: FValue) => boolean {
  const text = typeof v === 'number' ? `=${v}` : str(v);
  const m = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(text)!;
  const op = m[1] ?? '=';
  const operand = m[2];
  const n = numberOf(operand, 'text');
  return (x) => {
    if (isErr(x)) return false;
    if (n !== null) {
      const xn = typeof x === 'number' ? x : typeof x === 'string' ? numberOf(x, 'text') : null;
      if (xn === null) return op === '<>';
      return op === '=' ? xn === n : op === '<>' ? xn !== n : op === '<' ? xn < n : op === '>' ? xn > n : op === '<=' ? xn <= n : xn >= n;
    }
    const xs = str(x).toLowerCase();
    const o = operand.toLowerCase();
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

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

const roundTo = (x: number, d: number, how: 'round' | 'up' | 'down') => {
  const f = 10 ** Math.trunc(d);
  const a = Math.abs(x) * f;
  const r = how === 'round' ? Math.round(a + 1e-9) : how === 'up' ? Math.ceil(a - 1e-9) : Math.floor(a + 1e-9);
  return (Math.sign(x) * r) / f;
};

type Group = 'Maths' | 'Statistics' | 'Logic' | 'Text' | 'Conditional';

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
 */
const REF_G = /(?<![A-Za-z0-9_.$])(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?::(\$?)([A-Za-z]{1,3})(\$?)(\d+))?(?![A-Za-z0-9_.(])/g;
const STRING_G = /"(?:[^"]|"")*"?/g;

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

/** Every reference in formula text, with where it is — for highlighting the cells a formula reads. */
export function referencesIn(src: string): FormulaRef[] {
  const out: FormulaRef[] = [];
  outsideStrings(src, (part, offset) => {
    for (const m of part.matchAll(REF_G)) {
      const at = (m.index ?? 0) + offset;
      const ca = colFromLetters(m[2]);
      const ra = Number(m[4]);
      const cb = m[6] ? colFromLetters(m[6]) : ca;
      const rb = m[8] ? Number(m[8]) : ra;
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
 * was deleted. Row numbers are converted through the header rule both ways,
 * so `B3` still means the gutter's 3 afterwards.
 */
export function rewriteRefs(src: string, header: boolean, mapRow: (r: number) => number, mapCol: (c: number) => number): string {
  const rows = (la: number, lb: number): [number, number] | null => {
    if (Math.min(la, lb) < 1) return [la, lb];
    const span = mapSpan(storedOf(header, Math.min(la, lb)), storedOf(header, Math.max(la, lb)), mapRow);
    return span ? [rowLabel(header, span[0]), rowLabel(header, span[1])] : null;
  };
  const cols = (ca: number, cb: number) => mapSpan(Math.min(ca, cb), Math.max(ca, cb), mapCol);
  return outsideStrings(src, (part) =>
    part.replace(REF_G, (whole, d1: string, l1: string, d2: string, n1: string, d3?: string, l2?: string, d4?: string, n2?: string) => {
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
    })
  );
}

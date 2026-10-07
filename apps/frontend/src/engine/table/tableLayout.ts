import {
  alignFor,
  cellStyleAt,
  formatCell,
  hasSummary,
  isChecked,
  isIdentityView,
  mergeAt,
  optionsOf,
  ratingOf,
  selectLabels,
  summarize,
  summaryLabel,
  viewRows,
} from './tableModel';
import {
  DEFAULT_ACCENT,
  filterOn,
  isNumericType,
  SUMMARY_LABELS,
  TAG_PAINTS,
  type CellAlign,
  type CellVAlign,
  type ColourRule,
  type TableSpec,
  type TableTheme,
} from './tableTypes';
import { evaluateCell, isErr, isFormula, parseDateText, ruleTest, type FValue } from './tableFormula';

/** Link ink on the table's paper: AA on white and on every light tint. */
export const LINK_INK = '#1D4ED8';

/** A link a cell holds that a browser may open — http and https only; anything else is text, never a link. */
export const safeHref = (text: string) => (/^https?:\/\/[^\s]+$/i.test(text.trim()) ? text.trim() : null);

const ERROR_TEXT = /^#(?:REF!|DIV\/0!|NAME\?|VALUE!|CYCLE!|ERROR!|NUM!|N\/A)$/;

/**
 * A table turned into boxes, lines and strings somebody can paint.
 *
 * The chart engine's rule, applied again: one layout, two painters. The Konva
 * renderer and the SVG exporter both draw from this and neither computes a
 * position, so the table on the board and the table in the file cannot
 * disagree about where row seven is. The editor lays its DOM over the same
 * boxes.
 */

export type CellKind = 'checkbox' | 'select' | 'rating' | 'url' | 'person';

export interface CellTag {
  label: string;
  paper: string;
  ink: string;
}

export interface TableCellBox {
  /** Indices into `spec.cells`, not into the drawn order. The footer's cells are `r = -1`. */
  r: number;
  c: number;
  /** Position in the drawn order, for the editor's selection. */
  vr: number;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  align: CellAlign;
  valign: CellVAlign;
  bold: boolean;
  italic: boolean;
  color: string;
  fill: string | null;
  header: boolean;
  /** A sort arrow, on the header cell of the sorted column. */
  sort?: 'asc' | 'desc';
  /** A filter mark, on the header cell of a filtered column. */
  filtered?: boolean;
  /** Text wraps onto more lines rather than being cut. */
  wrap?: boolean;
  /** The cell holds a formula — the editor marks it. */
  formula?: boolean;
  /** How a rich column draws the value instead of writing it. */
  kind?: CellKind;
  checked?: boolean;
  tags?: CellTag[];
  rating?: number;
  /** A rich cell with nothing in it: drawn empty, though still clickable in the editor. */
  blank?: boolean;
  /** A data bar: its share of the column's largest magnitude, and its colour. */
  bar?: { t: number; color: string; negative: boolean };
  /**
   * A summary cell in the footer row: the aggregation's name, and a shorter
   * one to fall back to — `Sum of 14 visible`, then `Sum` — before the
   * painter gives the label up for the value.
   */
  footer?: { label: string; short?: string };
}

export interface TableSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  color: string;
}

export interface TableLayout {
  width: number;
  height: number;
  /** The height of a row of weight 1 — the table's standard row. */
  rowH: number;
  colX: number[];
  colW: number[];
  /** Stored row index for each drawn row. */
  rows: number[];
  /** Top of each drawn row, and the bottom of the last one, `rows.length + 1` entries. */
  rowY: number[];
  /** Height of each drawn row. */
  rowHs: number[];
  /** The summary row under the body, when the table has one. */
  footer: { y: number; h: number } | null;
  cells: TableCellBox[];
  segments: TableSegment[];
  /** The outer frame. */
  frame: { color: string; width: number; radius: number; fill: string };
  fontSize: number;
  padX: number;
  frozen: { rows: number; cols: number };
  /** The theme's colour, for the marks a rich cell draws (a ticked box). */
  accent: string;
}

interface ThemeInk {
  headerFill: string | null;
  headerText: string;
  bodyFill: string;
  zebra: string | null;
  text: string;
  muted: string;
  rowLine: string | null;
  colLine: string | null;
  headerRule: { color: string; width: number };
  frame: string;
  firstCol: string | null;
  footerFill: string;
}

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h.slice(0, 6);
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (rgb: number[]) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** Mix a hex colour toward white by `t` (0..1), for a theme's tints. */
function tint(hex: string, t: number): string {
  return toHex(hexRgb(hex).map((v) => v + (255 - v) * t));
}

/** A colour between two, `t` of the way from `a` to `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const x = hexRgb(a);
  const y = hexRgb(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
}

/** Whether black or white reads on a fill. */
export function inkOn(hex: string): string {
  const [r, g, b] = hexRgb(hex);
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.4 ? '#0F172A' : '#FFFFFF';
}

/** A person's avatar colour, from their name — the same on every board and in every file. */
export function personPaint(name: string): { paper: string; ink: string } {
  let h = 0;
  for (const ch of name.trim().toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const p = TAG_PAINTS[1 + (h % (TAG_PAINTS.length - 1))];
  return { paper: p.paper, ink: p.ink };
}

export const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

/**
 * The five looks, each a complete answer rather than a set of switches.
 *
 * A table is *content* on the board, like a sticky, so its colours are its
 * own and do not follow the app theme — a table exported from a dark board
 * must be the table that was shared, not a second reading of it.
 */
function themeInk(theme: TableTheme, accent: string): ThemeInk {
  const base = {
    text: '#1E293B',
    muted: '#64748B',
    bodyFill: '#FFFFFF',
    frame: '#CBD5E1',
    firstCol: null as string | null,
    footerFill: '#F8FAFC',
  };
  switch (theme) {
    case 'striped':
      return {
        ...base,
        headerFill: tint(accent, 0.86),
        headerText: '#0F172A',
        zebra: '#F8FAFC',
        rowLine: null,
        colLine: null,
        headerRule: { color: tint(accent, 0.4), width: 1.5 },
        footerFill: tint(accent, 0.92),
      };
    case 'grid':
      return {
        ...base,
        headerFill: '#F1F5F9',
        headerText: '#0F172A',
        zebra: null,
        rowLine: '#CBD5E1',
        colLine: '#CBD5E1',
        headerRule: { color: '#94A3B8', width: 1.5 },
        frame: '#94A3B8',
        footerFill: '#F1F5F9',
      };
    // Fewest lines, but still paper: a table's ink is fixed dark (it is
    // content, not chrome), so on a dark board a transparent ground would be
    // dark text on a dark board.
    case 'minimal':
      return {
        ...base,
        headerFill: null,
        headerText: '#0F172A',
        zebra: null,
        rowLine: '#CBD5E1',
        colLine: null,
        headerRule: { color: '#0F172A', width: 1.5 },
        frame: 'transparent',
        bodyFill: '#FFFFFF',
        footerFill: '#FFFFFF',
      };
    case 'bold':
      return {
        ...base,
        headerFill: accent,
        headerText: inkOn(accent),
        zebra: tint(accent, 0.94),
        rowLine: null,
        colLine: null,
        headerRule: { color: accent, width: 0 },
        frame: accent,
        firstCol: tint(accent, 0.88),
        footerFill: tint(accent, 0.86),
      };
    case 'clean':
    default:
      return {
        ...base,
        headerFill: '#F8FAFC',
        headerText: '#0F172A',
        zebra: null,
        rowLine: '#E2E8F0',
        colLine: '#EEF2F6',
        headerRule: { color: '#CBD5E1', width: 1 },
        frame: '#E2E8F0',
      };
  }
}

/** The number a cell stands for, for scales and bars; null when it is not one. */
function numericValue(spec: TableSpec, r: number, c: number): number | null {
  const v = evaluateCell(spec, r, c);
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && spec.columns[c]?.type === 'date') return parseDateText(v);
  return null;
}

/** Each drawn row's share of the height: its own, and 1 for the footer. */
export function drawnWeights(spec: TableSpec): { rows: number[]; weights: number[]; footer: boolean } {
  const rows = viewRows(spec);
  return { rows, weights: rows.map((r) => spec.rowHeights?.[r] ?? 1), footer: hasSummary(spec) };
}

/** The sum of the drawn rows' shares — the table's height in standard rows. */
export function drawnWeight(spec: TableSpec): number {
  const { weights, footer } = drawnWeights(spec);
  return Math.max(1, weights.reduce((a, b) => a + b, 0) + (footer ? 1 : 0));
}

interface RowEntry {
  vr: number;
  y: number;
  h: number;
  cells: TableCellBox[];
  segments: TableSegment[];
  /** Each formula cell's value when the row was laid out: a row whose values moved is laid out again. */
  values?: Array<FValue | undefined>;
}

/** Laid-out rows by row array, per columns array — a table's columns are its own, so tables never share an entry. */
/** Two formula results that draw the same. */
const sameValue = (a: FValue | undefined, b: FValue) => a === b || (isErr(a) && isErr(b) && a.err === b.err);

const rowCaches = new WeakMap<object, { sig: unknown[]; rows: WeakMap<string[], RowEntry> }>();

export function layoutTable(spec: TableSpec, width: number, height: number): TableLayout {
  const ink = themeInk(spec.theme, spec.accent ?? DEFAULT_ACCENT);
  const { rows, weights, footer: withFooter } = drawnWeights(spec);
  const total = Math.max(1, weights.reduce((a, b) => a + b, 0) + (withFooter ? 1 : 0));
  const unit = height / total;
  const rowY: number[] = [];
  const rowHs: number[] = [];
  let y = 0;
  weights.forEach((w) => {
    rowY.push(y);
    rowHs.push(w * unit);
    y += w * unit;
  });
  rowY.push(y);
  const footer = withFooter ? { y, h: unit } : null;

  const shown = spec.columns.map((c) => (c.hidden ? 0 : c.width));
  const totalW = shown.reduce((a, b) => a + b, 0) || 1;
  const colW = shown.map((w) => (width * w) / totalW);
  const colX: number[] = [];
  colW.reduce((x, w, i) => {
    colX[i] = x;
    return x + w;
  }, 0);
  const identity = isIdentityView(spec);
  const fontSize = Math.min(spec.fontSize, Math.max(7, unit * 0.62));
  const padX = Math.max(6, Math.min(14, fontSize * 0.8));

  const cells: TableCellBox[] = [];
  const segments: TableSegment[] = [];
  const cols = spec.columns.length;
  const body = rows.filter((r) => !(spec.header && r === 0));
  // A select column's options, read once per layout rather than once per cell.
  const optionsByCol = new Map<number, ReturnType<typeof optionsOf>>();
  const optionsFor = (c: number) => {
    let hit = optionsByCol.get(c);
    if (!hit) {
      hit = optionsOf(spec, c);
      optionsByCol.set(c, hit);
    }
    return hit;
  };

  // Colour rules by column, their tests built once per layout. A rule reads
  // the cell's value — a formula's result included — so it recolours with
  // every edit; the first that matches wins, as in every spreadsheet.
  const rulesByCol = new Map<number, Array<{ test: (v: FValue) => boolean; rule: ColourRule }>>();
  const rowRules: Array<{ test: (v: FValue) => boolean; rule: ColourRule }> = [];
  for (const rule of spec.rules ?? []) {
    const entry = { test: ruleTest(rule.when), rule };
    if (rule.wholeRow) rowRules.push(entry);
    else rulesByCol.set(rule.col, [...(rulesByCol.get(rule.col) ?? []), entry]);
  }
  const ruleFor = (r: number, c: number): ColourRule | undefined => {
    const list = rulesByCol.get(c);
    if (!list) return undefined;
    const v = evaluateCell(spec, r, c);
    return v === null ? undefined : list.find((x) => x.test(v))?.rule;
  };
  const rowRuleFor = (r: number): ColourRule | undefined => {
    for (const x of rowRules) {
      const v = evaluateCell(spec, r, x.rule.col);
      if (v !== null && x.test(v)) return x.rule;
    }
    return undefined;
  };

  // Scales and bars read the column's range over the rows on show.
  const ranges = new Map<number, { min: number; max: number; abs: number }>();
  const rangeOf = (c: number) => {
    let hit = ranges.get(c);
    if (!hit) {
      const ns = body.map((r) => numericValue(spec, r, c)).filter((n): n is number => n !== null && Number.isFinite(n));
      hit = ns.length ? { min: Math.min(...ns), max: Math.max(...ns), abs: Math.max(...ns.map(Math.abs)) } : { min: 0, max: 0, abs: 0 };
      ranges.set(c, hit);
    }
    return hit;
  };
  const scaleFor = (r: number, c: number): string | null => {
    const s = spec.scales?.find((x) => x.col === c);
    if (!s) return null;
    const v = numericValue(spec, r, c);
    if (v === null) return null;
    const { min, max } = rangeOf(c);
    const t = max > min ? (v - min) / (max - min) : 0.5;
    if (s.mid) return t < 0.5 ? mixHex(s.from, s.mid, t * 2) : mixHex(s.mid, s.to, (t - 0.5) * 2);
    return mixHex(s.from, s.to, t);
  };
  const barFor = (r: number, c: number): TableCellBox['bar'] => {
    const b = spec.bars?.find((x) => x.col === c);
    if (!b) return undefined;
    const v = numericValue(spec, r, c);
    const { abs } = rangeOf(c);
    if (v === null || !(abs > 0)) return undefined;
    return { t: Math.min(1, Math.abs(v) / abs), color: b.color, negative: v < 0 };
  };

  /** One cell's box and the rules on its right and bottom edges; nothing when a merge covers it. */
  const layCell = (r: number, c: number, vr: number, rowRule: ColourRule | undefined, out: { cells: TableCellBox[]; segments: TableSegment[] }) => {
    const header = spec.header && r === 0;
    const zebraFill = !header && ink.zebra && (vr - (spec.header ? 1 : 0)) % 2 === 1 ? ink.zebra : null;
    let w = colW[c];
    let h = rowHs[vr];
    // Merges only hold while the drawn rows are the stored rows; sorted or
    // filtered, a merge would span rows that are no longer beside it.
    if (identity) {
      const m = mergeAt(spec, r, c);
      if (m) {
        if (m.r !== r || m.c !== c) return;
        w = colW.slice(c, c + m.cs).reduce((a, b) => a + b, 0);
        h = rowY[Math.min(rows.length, vr + m.rs)] - rowY[vr];
      }
    }
    const style = cellStyleAt(spec, r, c);
    const firstCol = !header && spec.firstColumn && c === 0;
    const raw = spec.cells[r]?.[c] ?? '';
    const formula = !header && isFormula(raw);
    const type = spec.columns[c].type;
    const text = formatCell(spec, r, c);
    // A formula that failed says so in red — `#REF!` in body ink reads as
    // data, and it is the one value in the table that is not.
    const errored = formula && ERROR_TEXT.test(text);
    const rule = header ? undefined : ruleFor(r, c) ?? rowRule;
    const scaled = header ? null : scaleFor(r, c);
    const fill = rule?.fill ?? scaled ?? style?.fill ?? (header ? ink.headerFill : firstCol ? ink.firstCol ?? ink.headerFill : zebraFill);
    const painted = Boolean(rule?.fill ?? scaled ?? style?.fill);

    const box: TableCellBox = {
      r,
      c,
      vr,
      x: colX[c],
      y: rowY[vr],
      w,
      h,
      text,
      align: alignFor(spec, r, c),
      valign: style?.valign ?? 'middle',
      bold: rule?.bold ?? style?.bold ?? (header || Boolean(firstCol)),
      italic: style?.italic ?? false,
      color: rule?.color ?? style?.color ?? (errored ? '#B91C1C' : header ? ink.headerText : fill && painted ? inkOn(fill) : ink.text),
      fill,
      header,
      ...(header && spec.sort?.col === c ? { sort: spec.sort.dir } : null),
      ...(header && filterOn(spec, c) && (filterOn(spec, c)!.values || filterOn(spec, c)!.query.trim()) ? { filtered: true } : null),
      ...(style?.wrap ? { wrap: true } : null),
      ...(formula ? { formula: true } : null),
    };

    if (!header && !errored) {
      const value = formula ? evaluateCell(spec, r, c) : null;
      if (type === 'checkbox') {
        box.kind = 'checkbox';
        box.checked = formula ? value === true || (typeof value === 'number' && value !== 0) : isChecked(raw);
        box.text = '';
      } else if (type === 'select' && !formula) {
        const opts = optionsFor(c);
        const labels = selectLabels(raw);
        if (labels.length) {
          box.kind = 'select';
          box.tags = labels.map((label) => {
            const o = opts.find((x) => x.label.toLowerCase() === label.toLowerCase());
            const p = TAG_PAINTS[o ? o.tag : 0];
            return { label, paper: p.paper, ink: p.ink };
          });
        }
      } else if (type === 'rating') {
        box.kind = 'rating';
        box.rating = formula ? (typeof value === 'number' ? Math.max(0, Math.min(5, Math.round(value))) : 0) : ratingOf(raw);
        box.text = '';
        // An unrated cell shows nothing, as Airtable's and Notion's do; five grey stars down a column read as data.
        if (!formula && raw.trim() === '') box.blank = true;
      } else if (type === 'url' && text && safeHref(text)) {
        box.kind = 'url';
        if (!rule?.color && !style?.color) box.color = LINK_INK;
      } else if (type === 'person' && text.trim()) {
        box.kind = 'person';
      }
      if (isNumericType(type) || type === 'date') {
        const bar = barFor(r, c);
        if (bar) box.bar = bar;
      }
      if (formula && isErr(value) && box.kind) delete box.kind;
    }
    out.cells.push(box);

    // The right and bottom edges of this cell, per the theme.
    const right = colX[c] + w;
    const bottom = rowY[vr] + h;
    if (ink.colLine && right < width - 0.5) {
      out.segments.push({ x1: right, y1: rowY[vr], x2: right, y2: bottom, width: 1, color: ink.colLine });
    }
    const lastRow = bottom >= height - 0.5;
    if (!lastRow) {
      if (header && ink.headerRule.width > 0) {
        out.segments.push({ x1: colX[c], y1: bottom, x2: right, y2: bottom, width: ink.headerRule.width, color: ink.headerRule.color });
      } else if (!header && ink.rowLine) {
        out.segments.push({ x1: colX[c], y1: bottom, x2: right, y2: bottom, width: 1, color: ink.rowLine });
      }
    }
  };

  /**
   * Rows are laid out again only where something about them changed.
   *
   * A keystroke changes one row's text, but every row used to be laid out
   * afresh — 120,000 boxes for a 2,000 × 60 table. A row whose array is the
   * same (the read boundary keeps unchanged rows' arrays), at the same place,
   * under the same columns, styles and theme keeps its boxes; only its
   * formula cells, whose values can move with any edit, are laid out again.
   * Tables with colour rules, scales, bars or merges — whose cells read other
   * rows — and the header, which carries the view's marks, are always fresh.
   */
  const optionsSig = spec.columns
    .map((col, c) => (col.type === 'select' ? optionsFor(c).map((o) => `${o.label}\u0000${o.tag}`).join('\u0001') : ''))
    .join('\u0002');
  const sig: unknown[] = [spec.styles, spec.theme, spec.accent, spec.header, spec.firstColumn, spec.currency, width, height, optionsSig];
  const cacheable = !spec.rules?.length && !spec.scales?.length && !spec.bars?.length && !(identity && spec.merges?.length);
  let cache = cacheable ? rowCaches.get(spec.columns) : undefined;
  if (cacheable && (!cache || cache.sig.length !== sig.length || cache.sig.some((v, i) => v !== sig[i]))) {
    cache = { sig, rows: new WeakMap() };
    rowCaches.set(spec.columns, cache);
  }

  rows.forEach((r, vr) => {
    const header = spec.header && r === 0;
    const rowArr = spec.cells[r];
    const hit = !header && cache && rowArr ? cache.rows.get(rowArr) : undefined;
    if (hit && hit.vr === vr && hit.y === rowY[vr] && hit.h === rowHs[vr] && (!hit.values || hit.values.every((v, i) => v === undefined || sameValue(v, evaluateCell(spec, r, hit.cells[i].c))))) {
      cells.push(...hit.cells);
      segments.push(...hit.segments);
      return;
    }
    const out = { cells: [] as TableCellBox[], segments: [] as TableSegment[] };
    const rowRule = header ? undefined : rowRuleFor(r);
    for (let c = 0; c < cols; c++) {
      if (colW[c] === 0) continue;
      layCell(r, c, vr, rowRule, out);
    }
    cells.push(...out.cells);
    segments.push(...out.segments);
    if (!header && cache && rowArr) {
      const values = out.cells.some((b) => b.formula) ? out.cells.map((b) => (b.formula ? evaluateCell(spec, r, b.c) : undefined)) : undefined;
      cache.rows.set(rowArr, { vr, y: rowY[vr], h: rowHs[vr], cells: out.cells, segments: out.segments, values });
    }
  });

  if (footer) {
    // The footer reads like the header: a rule above it and the header's paper.
    segments.push({ x1: 0, y1: footer.y, x2: width, y2: footer.y, width: Math.max(1, ink.headerRule.width), color: ink.headerRule.width > 0 ? ink.headerRule.color : ink.frame });
    for (let c = 0; c < cols; c++) {
      if (colW[c] === 0) continue;
      const agg = spec.summary?.[c] ?? null;
      cells.push({
        r: -1,
        c,
        vr: rows.length,
        x: colX[c],
        y: footer.y,
        w: colW[c],
        h: footer.h,
        text: agg ? summarize(spec, c, agg, rows) : '',
        align: 'right',
        valign: 'middle',
        bold: true,
        italic: false,
        color: ink.headerText === '#FFFFFF' ? '#0F172A' : ink.headerText,
        fill: ink.footerFill,
        header: false,
        ...(agg ? { footer: { label: summaryLabel(spec, agg, rows), short: SUMMARY_LABELS[agg] } } : { footer: { label: '' } }),
      });
      if (ink.colLine && colX[c] + colW[c] < width - 0.5) {
        segments.push({ x1: colX[c] + colW[c], y1: footer.y, x2: colX[c] + colW[c], y2: footer.y + footer.h, width: 1, color: ink.colLine });
      }
    }
  }

  return {
    width,
    height,
    rowH: unit,
    colX,
    colW,
    rows,
    rowY,
    rowHs,
    footer,
    cells,
    segments,
    frame: {
      color: ink.frame,
      width: ink.frame === 'transparent' ? 0 : 1,
      radius: spec.theme === 'minimal' ? 0 : 6,
      fill: ink.bodyFill,
    },
    fontSize,
    padX,
    frozen: { rows: Math.min(spec.frozen?.rows ?? 0, rows.length), cols: Math.min(spec.frozen?.cols ?? 0, cols) },
    accent: spec.accent ?? DEFAULT_ACCENT,
  };
}

/** The drawn row at a y inside the body, by binary search; -1 above, `rows.length` in or past the footer. */
export function rowAtY(layout: TableLayout, y: number): number {
  if (y < 0) return -1;
  const n = layout.rows.length;
  if (y >= layout.rowY[n]) return n;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (layout.rowY[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Text broken onto lines that fit `room`, by words, a word wider than the
 * room broken by characters. Shared by both painters and the row fit, with
 * the measure each one has.
 */
export function wrapLines(text: string, room: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      if (!word) continue;
      const next = line + word;
      if (measure(next.trimEnd()) <= room || !line.trim()) {
        if (measure(next.trimEnd()) > room && !line.trim()) {
          // One word wider than the cell: cut it where it overflows.
          let part = '';
          for (const ch of word) {
            if (measure(part + ch) > room && part) {
              out.push(part);
              part = '';
            }
            part += ch;
          }
          line = part;
        } else line = next;
      } else {
        out.push(line.trimEnd());
        line = word.trimStart();
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

/** The line height wrapped text is set at, as a multiple of the type size. */
export const WRAP_LEADING = 1.3;

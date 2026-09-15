import { alignFor, formatCell, isIdentityView, mergeAt, viewRows } from './tableModel';
import { cellKey, DEFAULT_ACCENT, type CellAlign, type TableSpec, type TableTheme } from './tableTypes';

/**
 * A table turned into boxes, lines and strings somebody can paint.
 *
 * The chart engine's rule, applied again: one layout, two painters. The Konva
 * renderer and the SVG exporter both draw from this and neither computes a
 * position, so the table on the board and the table in the file cannot
 * disagree about where row seven is.
 */

export interface TableCellBox {
  /** Indices into `spec.cells`, not into the drawn order. */
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
  bold: boolean;
  italic: boolean;
  color: string;
  fill: string | null;
  header: boolean;
  /** A sort arrow, on the header cell of the sorted column. */
  sort?: 'asc' | 'desc';
  /** A filter mark, on the header cell of the filtered column. */
  filtered?: boolean;
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
  rowH: number;
  colX: number[];
  colW: number[];
  /** Stored row index for each drawn row. */
  rows: number[];
  cells: TableCellBox[];
  segments: TableSegment[];
  /** The outer frame. */
  frame: { color: string; width: number; radius: number; fill: string };
  fontSize: number;
  padX: number;
}

interface ThemeInk {
  headerFill: string | null;
  headerText: string;
  bodyFill: string;
  zebra: string | null;
  text: string;
  rowLine: string | null;
  colLine: string | null;
  headerRule: { color: string; width: number };
  frame: string;
  firstCol: string | null;
}

/** Mix a hex colour toward white by `t` (0..1), for a theme's tints. */
function tint(hex: string, t: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h.slice(0, 6);
  const n = parseInt(full, 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 255) + (255 - ((n >> shift) & 255)) * t);
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}

/** Whether black or white reads on a fill. */
function inkOn(hex: string): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h.slice(0, 6);
  const n = parseInt(full, 16);
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.4 ? '#0F172A' : '#FFFFFF';
}

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
    bodyFill: '#FFFFFF',
    frame: '#CBD5E1',
    firstCol: null as string | null,
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
        firstCol: null,
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
      };
    /**
     * No frame, no fills, no column rules — but still paper.
     *
     * It drew on a transparent ground, and a table's ink is fixed dark (it is
     * content, not chrome), so on a dark board the minimal table was dark text
     * on a dark board: unreadable. Minimal now means *fewest lines*, not *no
     * ground*; the rules are a step darker too, because with nothing else on
     * the table they are the only thing carrying the eye across a row.
     */
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

export function layoutTable(spec: TableSpec, width: number, height: number): TableLayout {
  const ink = themeInk(spec.theme, spec.accent ?? DEFAULT_ACCENT);
  const rows = viewRows(spec);
  const n = Math.max(1, rows.length);
  const rowH = height / n;
  const totalW = spec.columns.reduce((a, c) => a + c.width, 0) || 1;
  const colW = spec.columns.map((c) => (width * c.width) / totalW);
  const colX: number[] = [];
  colW.reduce((x, w, i) => {
    colX[i] = x;
    return x + w;
  }, 0);
  const identity = isIdentityView(spec);
  const fontSize = Math.min(spec.fontSize, Math.max(7, rowH * 0.62));
  const padX = Math.max(6, Math.min(14, fontSize * 0.8));

  const cells: TableCellBox[] = [];
  const segments: TableSegment[] = [];
  const cols = spec.columns.length;

  rows.forEach((r, vr) => {
    const header = spec.header && r === 0;
    const zebraFill = !header && ink.zebra && (vr - (spec.header ? 1 : 0)) % 2 === 1 ? ink.zebra : null;
    for (let c = 0; c < cols; c++) {
      let w = colW[c];
      let h = rowH;
      // Merges only hold while the drawn rows are the stored rows; sorted or
      // filtered, a merge would span rows that are no longer beside it.
      if (identity) {
        const m = mergeAt(spec, r, c);
        if (m) {
          if (m.r !== r || m.c !== c) continue;
          w = colW.slice(c, c + m.cs).reduce((a, b) => a + b, 0);
          h = rowH * m.rs;
        }
      }
      const style = spec.styles?.[cellKey(r, c)];
      const firstCol = !header && spec.firstColumn && c === 0;
      const fill =
        style?.fill ??
        (header ? ink.headerFill : firstCol ? ink.firstCol ?? ink.headerFill : zebraFill);
      cells.push({
        r,
        c,
        vr,
        x: colX[c],
        y: vr * rowH,
        w,
        h,
        text: formatCell(spec, r, c),
        align: alignFor(spec, r, c),
        bold: style?.bold ?? (header || Boolean(firstCol)),
        italic: style?.italic ?? false,
        color: style?.color ?? (header ? ink.headerText : fill && style?.fill ? inkOn(fill) : ink.text),
        fill,
        header,
        ...(header && spec.sort?.col === c ? { sort: spec.sort.dir } : null),
        ...(header && spec.filter?.col === c ? { filtered: true } : null),
      });

      // The right and bottom edges of this cell, per the theme.
      const right = colX[c] + w;
      const bottom = vr * rowH + h;
      if (ink.colLine && c + (w === colW[c] ? 1 : 0) < cols && right < width - 0.5) {
        segments.push({ x1: right, y1: vr * rowH, x2: right, y2: bottom, width: 1, color: ink.colLine });
      }
      const isHeaderRow = header;
      const lastRow = bottom >= height - 0.5;
      if (!lastRow) {
        if (isHeaderRow && ink.headerRule.width > 0) {
          segments.push({ x1: colX[c], y1: bottom, x2: right, y2: bottom, width: ink.headerRule.width, color: ink.headerRule.color });
        } else if (!isHeaderRow && ink.rowLine) {
          segments.push({ x1: colX[c], y1: bottom, x2: right, y2: bottom, width: 1, color: ink.rowLine });
        }
      }
    }
  });

  return {
    width,
    height,
    rowH,
    colX,
    colW,
    rows,
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
  };
}

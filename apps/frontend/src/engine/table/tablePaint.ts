import { initialsOf, personPaint, WRAP_LEADING, wrapLines, type TableCellBox, type TableLayout } from './tableLayout';

/**
 * What each cell draws, as primitives both painters can follow.
 *
 * The layout says where a cell is; this says what goes inside it — the text
 * cut or wrapped to fit, a checkbox, five stars, coloured pills, an avatar, a
 * data bar, the footer's label — so the board's canvas and the exported SVG
 * draw the same picture from one description instead of two that drift. Text
 * is fitted with the measure each painter has: the canvas's real one on the
 * board, an approximation in the file.
 */

export type Prim =
  | { t: 'rect'; x: number; y: number; w: number; h: number; r?: number; fill?: string; stroke?: string; sw?: number; opacity?: number }
  | {
      t: 'text';
      x: number;
      /** The line's vertical centre. */
      y: number;
      s: string;
      size: number;
      bold: boolean;
      italic: boolean;
      fill: string;
      anchor: 'start' | 'middle' | 'end';
      underline?: boolean;
    }
  | { t: 'path'; d: string; fill?: string; stroke?: string; sw?: number };

export type TextMeasure = (s: string, bold: boolean, italic: boolean, size: number) => number;

export interface PaintOptions {
  measure: TextMeasure;
  /** The sketch hand is larger than Inter at the same nominal size. */
  fontScale?: number;
}

const STAR_INK = '#D97706';
const STAR_EMPTY = '#E2E8F0';
const STAR_EDGE = '#94A3B8';
const BOX_EDGE = '#94A3B8';
const MUTED = '#64748B';
const NEGATIVE_BAR = '#DC2626';

/** Text cut to a width with an ellipsis. */
export function fitLine(text: string, room: number, measure: (s: string) => number): string {
  if (room <= 4 || !text) return '';
  if (measure(text) <= room) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(text.slice(0, mid) + '…') <= room) lo = mid;
    else hi = mid - 1;
  }
  return lo <= 0 ? '' : `${text.slice(0, lo).trimEnd()}…`;
}

/** A five-point star centred on (cx, cy), as path data. */
export function starPath(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    pts.push(`${(cx + Math.cos(a) * rr).toFixed(2)} ${(cy + Math.sin(a) * rr).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

/** Where a block of width `w` starts in a cell, by alignment. */
function alignedX(cell: TableCellBox, layout: TableLayout, w: number, mark = 0): number {
  if (cell.align === 'center') return cell.x + (cell.w - w) / 2;
  if (cell.align === 'right') return cell.x + cell.w - layout.padX - mark - w;
  return cell.x + layout.padX;
}

/** The vertical centre of a block of height `h`, by vertical alignment. */
function alignedY(cell: TableCellBox, layout: TableLayout, h: number): number {
  const pad = Math.max(2, layout.fontSize * 0.45);
  if (cell.valign === 'top') return cell.y + pad + h / 2;
  if (cell.valign === 'bottom') return cell.y + cell.h - pad - h / 2;
  return cell.y + cell.h / 2;
}

export function cellPrims(cell: TableCellBox, layout: TableLayout, opts: PaintOptions): Prim[] {
  const out: Prim[] = [];
  const k = opts.fontScale ?? 1;
  const fs = layout.fontSize * k;
  const m = (s: string, bold = cell.bold, italic = cell.italic, size = fs) => opts.measure(s, bold, italic, size);
  const mark = cell.sort || cell.filtered ? fs * 0.9 : 0;
  const room = cell.w - layout.padX * 2 - mark;

  if (cell.bar) {
    const inset = Math.min(4, cell.w * 0.06);
    const bh = Math.max(4, Math.min(cell.h * 0.56, fs * 1.4));
    out.push({
      t: 'rect',
      x: cell.x + inset,
      y: cell.y + (cell.h - bh) / 2,
      w: Math.max(1, (cell.w - inset * 2) * cell.bar.t),
      h: bh,
      r: 2,
      fill: cell.bar.negative ? NEGATIVE_BAR : cell.bar.color,
      opacity: 0.26,
    });
  }

  if (cell.footer) {
    if (cell.footer.label) {
      // The value wins the room; the label takes what is left, or steps aside.
      const ls = fs * 0.78;
      const value = fitLine(cell.text, room, (s) => m(s));
      const valueW = value ? m(value) : 0;
      const labelRoom = room - valueW - fs * 0.5;
      // The whole label, or the short one whole, before either is cut: `Sum`
      // reads; `Sum of 1…` does not.
      const fits = (s: string) => m(s, false, false, ls) <= labelRoom;
      const label =
        labelRoom < fs * 2
          ? ''
          : fits(cell.footer.label)
            ? cell.footer.label
            : cell.footer.short && fits(cell.footer.short)
              ? cell.footer.short
              : fitLine(cell.footer.short ?? cell.footer.label, labelRoom, (s) => m(s, false, false, ls));
      if (label) out.push({ t: 'text', x: cell.x + layout.padX, y: cell.y + cell.h / 2, s: label, size: ls, bold: false, italic: false, fill: MUTED, anchor: 'start' });
      out.push({ t: 'text', x: cell.x + cell.w - layout.padX, y: cell.y + cell.h / 2, s: value, size: fs, bold: true, italic: false, fill: cell.color, anchor: 'end' });
    }
    return out;
  }

  switch (cell.kind) {
    case 'checkbox': {
      const s = Math.min(fs * 1.05, cell.h * 0.62);
      const x = alignedX(cell, layout, s);
      const cy = alignedY(cell, layout, s);
      const y = cy - s / 2;
      if (cell.checked) {
        out.push({ t: 'rect', x, y, w: s, h: s, r: s * 0.22, fill: layout.accent });
        out.push({
          t: 'path',
          d: `M${x + s * 0.24} ${cy + s * 0.02}L${x + s * 0.43} ${cy + s * 0.2}L${x + s * 0.77} ${cy - s * 0.2}`,
          stroke: '#FFFFFF',
          sw: Math.max(1.2, s * 0.13),
        });
      } else {
        out.push({ t: 'rect', x: x + 0.5, y: y + 0.5, w: s - 1, h: s - 1, r: s * 0.22, fill: '#FFFFFF', stroke: BOX_EDGE, sw: 1.2 });
      }
      return out;
    }
    case 'rating': {
      if (cell.blank) return out;
      const s = Math.min(fs * 0.95, cell.h * 0.58);
      const gap = s * 0.14;
      const total = s * 5 + gap * 4;
      const fitN = Math.max(1, Math.min(5, Math.floor((cell.w - layout.padX * 2 + gap) / (s + gap))));
      const x0 = alignedX(cell, layout, fitN === 5 ? total : fitN * (s + gap) - gap);
      const cy = alignedY(cell, layout, s);
      for (let i = 0; i < fitN; i++) {
        const filled = i < (cell.rating ?? 0);
        out.push({ t: 'path', d: starPath(x0 + i * (s + gap) + s / 2, cy, s / 2), fill: filled ? STAR_INK : STAR_EMPTY, stroke: filled ? STAR_INK : STAR_EDGE, sw: 0.8 });
      }
      return out;
    }
    case 'select': {
      const tags = cell.tags ?? [];
      const ts = fs * 0.86;
      const ph = Math.min(fs * 1.55, cell.h - 4);
      const padIn = fs * 0.5;
      const gap = fs * 0.3;
      const cy = alignedY(cell, layout, ph);
      let x = cell.x + layout.padX;
      const limit = cell.x + cell.w - layout.padX;
      for (let i = 0; i < tags.length; i++) {
        const t = tags[i];
        const left = tags.length - i - 1;
        const more = left > 0 ? `+${left}` : '';
        const moreW = more ? m(more, true, false, ts) + padIn * 2 + gap : 0;
        const avail = limit - x - moreW;
        const label = fitLine(t.label, avail - padIn * 2, (s) => m(s, false, false, ts));
        if (!label) {
          if (i > 0 || avail < padIn * 2 + ts) {
            const rest = `+${tags.length - i}`;
            const rw = m(rest, true, false, ts) + padIn * 2;
            if (x + rw <= limit + 0.5) {
              out.push({ t: 'rect', x, y: cy - ph / 2, w: rw, h: ph, r: ph / 2, fill: '#F1F5F9' });
              out.push({ t: 'text', x: x + rw / 2, y: cy, s: rest, size: ts, bold: true, italic: false, fill: '#334155', anchor: 'middle' });
            }
          }
          break;
        }
        const w = m(label, false, false, ts) + padIn * 2;
        out.push({ t: 'rect', x, y: cy - ph / 2, w, h: ph, r: ph / 2, fill: t.paper });
        out.push({ t: 'text', x: x + padIn, y: cy, s: label, size: ts, bold: false, italic: false, fill: t.ink, anchor: 'start' });
        x += w + gap;
        if (label !== t.label && left > 0) {
          const rest = `+${left}`;
          const rw = m(rest, true, false, ts) + padIn * 2;
          if (x + rw <= limit + 0.5) {
            out.push({ t: 'rect', x, y: cy - ph / 2, w: rw, h: ph, r: ph / 2, fill: '#F1F5F9' });
            out.push({ t: 'text', x: x + rw / 2, y: cy, s: rest, size: ts, bold: true, italic: false, fill: '#334155', anchor: 'middle' });
          }
          break;
        }
      }
      return out;
    }
    case 'person': {
      const d = Math.min(fs * 1.4, cell.h - 4);
      const paint = personPaint(cell.text);
      const x = cell.x + layout.padX;
      const cy = alignedY(cell, layout, d);
      out.push({ t: 'rect', x, y: cy - d / 2, w: d, h: d, r: d / 2, fill: paint.paper });
      out.push({ t: 'text', x: x + d / 2, y: cy, s: initialsOf(cell.text), size: d * 0.42, bold: true, italic: false, fill: paint.ink, anchor: 'middle' });
      const name = fitLine(cell.text, room - d - fs * 0.45, (s) => m(s));
      out.push({ t: 'text', x: x + d + fs * 0.45, y: cy, s: name, size: fs, bold: cell.bold, italic: cell.italic, fill: cell.color, anchor: 'start' });
      return out;
    }
    default:
      break;
  }

  if (cell.text) {
    const anchor = cell.align === 'center' ? 'middle' : cell.align === 'right' ? 'end' : 'start';
    const x = cell.align === 'center' ? cell.x + cell.w / 2 : cell.align === 'right' ? cell.x + cell.w - layout.padX - mark : cell.x + layout.padX;
    if (cell.wrap) {
      const lh = fs * WRAP_LEADING;
      const all = wrapLines(cell.text, room, (s) => m(s));
      const maxLines = Math.max(1, Math.floor((cell.h - fs * 0.4) / lh));
      const lines = all.slice(0, maxLines);
      if (all.length > maxLines) lines[maxLines - 1] = fitLine(`${lines[maxLines - 1]}…`, room, (s) => m(s));
      const blockH = lines.length * lh;
      const top = alignedY(cell, layout, blockH) - blockH / 2;
      lines.forEach((line, i) =>
        out.push({ t: 'text', x, y: top + lh * (i + 0.5), s: line, size: fs, bold: cell.bold, italic: cell.italic, fill: cell.color, anchor, underline: cell.kind === 'url' })
      );
    } else {
      const s = fitLine(cell.text, room, (t) => m(t));
      if (s) out.push({ t: 'text', x, y: alignedY(cell, layout, fs), s, size: fs, bold: cell.bold, italic: cell.italic, fill: cell.color, anchor, underline: cell.kind === 'url' });
    }
  }

  // The view's state, on the column it applies to: a sort arrow, or a dot for
  // a filter — so a table showing four of forty rows says so.
  if (cell.sort || cell.filtered) {
    const ax = cell.x + cell.w - layout.padX - mark / 2;
    const cy = alignedY(cell, layout, fs);
    if (cell.sort) {
      const s = fs * 0.28;
      const d =
        cell.sort === 'asc'
          ? `M${ax - s} ${cy + s * 0.6}L${ax + s} ${cy + s * 0.6}L${ax} ${cy - s * 0.8}Z`
          : `M${ax - s} ${cy - s * 0.6}L${ax + s} ${cy - s * 0.6}L${ax} ${cy + s * 0.8}Z`;
      out.push({ t: 'path', d, fill: cell.color });
    } else {
      const r = fs * 0.18;
      out.push({ t: 'rect', x: ax - r, y: cy - r, w: r * 2, h: r * 2, r, fill: cell.color });
    }
  }
  return out;
}

/**
 * Whether a point in table space lands on a checkbox cell's box (with a few
 * pixels of grace), from the same plan the box was drawn by.
 */
export function checkboxHit(cell: TableCellBox, layout: TableLayout, x: number, y: number, measure: TextMeasure): boolean {
  if (cell.kind !== 'checkbox') return false;
  const box = cellPrims(cell, layout, { measure }).find((p): p is Extract<Prim, { t: 'rect' }> => p.t === 'rect');
  if (!box) return false;
  const grace = 4;
  return x >= box.x - grace && x <= box.x + box.w + grace && y >= box.y - grace && y <= box.y + box.h + grace;
}

/** The rating a point in table space would set — 1 to 5 — or null when it misses the stars. */
export function ratingHit(cell: TableCellBox, layout: TableLayout, x: number, y: number, measure: TextMeasure): number | null {
  if (cell.kind !== 'rating') return null;
  const n = cellPrims({ ...cell, blank: false }, layout, { measure }).filter((p) => p.t === 'path').length;
  if (!n) return null;
  const fs = layout.fontSize;
  const s = Math.min(fs * 0.95, cell.h * 0.58);
  if (Math.abs(y - (cell.y + cell.h / 2)) > Math.max(s, cell.h / 2)) return null;
  const gap = s * 0.14;
  const x0 = (() => {
    const total = n * (s + gap) - gap;
    if (cell.align === 'center') return cell.x + (cell.w - total) / 2;
    if (cell.align === 'right') return cell.x + cell.w - layout.padX - total;
    return cell.x + layout.padX;
  })();
  const i = Math.floor((x - x0 + gap / 2) / (s + gap));
  return i >= 0 && i < n ? i + 1 : null;
}

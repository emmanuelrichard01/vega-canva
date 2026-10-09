import { CATEGORIES, FONTS, type FontEntry } from '../../engine/text/fontCatalogue';

/**
 * The font picker's model: what is listed, in what order, and how it is
 * searched. Pure, so ranking, sections and keyboard travel are testable
 * without a DOM.
 */

export interface PickerRow {
  family: string;
  source: 'builtin' | 'board' | 'local';
  styles: number;
}

export interface PickerSection {
  key: string;
  label: string;
  hint?: string;
  rows: PickerRow[];
}

export const builtinRow = (f: FontEntry): PickerRow => ({
  family: f.family,
  source: 'builtin',
  styles: f.weights.length * (f.italic ? 2 : 1),
});

/**
 * How well `name` matches `query`; 0 means not at all.
 * Prefix beats word start beats substring beats an in-order subsequence
 * ("rbt" finds Roboto), and shorter names win a tie.
 */
export function fuzzyScore(name: string, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const n = name.toLowerCase();
  const tie = 1 - Math.min(n.length, 60) / 100;
  if (n.startsWith(q)) return 100 + tie;
  if (n.split(/[\s-]+/).some((w) => w.startsWith(q))) return 80 + tie;
  if (n.includes(q)) return 60 + tie;
  let at = 0;
  for (const ch of q.replace(/\s+/g, '')) {
    at = n.indexOf(ch, at);
    if (at < 0) return 0;
    at++;
  }
  return 20 + tie;
}

const categoryText = new Map(CATEGORIES.map((c) => [c.id, `${c.label} ${c.hint}`.toLowerCase()]));

/** Rows matching a query, best first. With no query the order is kept. */
export function rankRows<T extends { family: string }>(rows: T[], query: string, extra?: (r: T) => string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  const scored: { row: T; score: number; i: number }[] = [];
  rows.forEach((row, i) => {
    let score = fuzzyScore(row.family, q);
    if (!score && extra && extra(row).includes(q)) score = 10;
    if (score) scored.push({ row, score, i });
  });
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).map((s) => s.row);
}

export interface SectionInput {
  query: string;
  recents: string[];
  /** Families the board's own text is set in. */
  inUse: string[];
  uploaded: PickerRow[];
  device: PickerRow[];
  builtin?: FontEntry[];
}

export function buildSections(input: SectionInput): PickerSection[] {
  const { query, recents, inUse, uploaded, device } = input;
  const q = query.trim();
  const builtin = input.builtin ?? FONTS;
  const known = new Map<string, PickerRow>();
  for (const f of builtin) known.set(f.family, builtinRow(f));
  for (const r of [...device, ...uploaded]) known.set(r.family, r);
  const pick = (families: string[]) => families.map((f) => known.get(f)).filter((r): r is PickerRow => !!r);

  const out: PickerSection[] = [];
  const used = pick([...new Set(inUse)]);
  if (!q && used.length) out.push({ key: 'inuse', label: 'In this board', rows: used });
  const rec = pick(recents);
  if (!q && rec.length) out.push({ key: 'recent', label: 'Recent', rows: rec });

  out.push({ key: 'board', label: 'Uploaded', hint: 'Shared with everyone', rows: rankRows(uploaded, q) });
  out.push({ key: 'device', label: 'On this device', hint: 'Private until you share one', rows: rankRows(device, q) });

  const ranked = rankRows(builtin, q, (f) => categoryText.get(f.category) ?? '');
  if (q) {
    // Searching: one list, best match first, not split by category.
    if (ranked.length) out.push({ key: 'results', label: 'Fonts', rows: ranked.map(builtinRow) });
  } else {
    for (const c of CATEGORIES) {
      const fonts = ranked.filter((f) => f.category === c.id);
      if (fonts.length) out.push({ key: c.id, label: c.label, hint: c.hint, rows: fonts.map(builtinRow) });
    }
  }
  return out;
}

export const HEADER_H = 28;
export const ROW_H = 34;

export type Item =
  | { kind: 'header'; key: string; section: PickerSection; top: number; height: number }
  | { kind: 'row'; key: string; row: PickerRow; section: PickerSection; top: number; height: number; index: number };

/** Lay sections out in one tall column; `index` counts selectable rows only. */
export function layout(sections: PickerSection[], alwaysShow: (s: PickerSection) => boolean = () => false) {
  const items: Item[] = [];
  const rows: Extract<Item, { kind: 'row' }>[] = [];
  let top = 0;
  for (const s of sections) {
    if (!s.rows.length && !alwaysShow(s)) continue;
    items.push({ kind: 'header', key: `h:${s.key}`, section: s, top, height: HEADER_H });
    top += HEADER_H;
    for (const row of s.rows) {
      const it = { kind: 'row' as const, key: `${s.key}:${row.family}`, row, section: s, top, height: ROW_H, index: rows.length };
      items.push(it);
      rows.push(it);
      top += ROW_H;
    }
  }
  return { items, rows, height: top };
}

/** The slice of items intersecting the viewport, with overscan. */
export function visibleItems(items: Item[], scrollTop: number, viewport: number, overscan = 120): Item[] {
  const a = scrollTop - overscan;
  const b = scrollTop + viewport + overscan;
  return items.filter((i) => i.top + i.height >= a && i.top <= b);
}

/** Move a cursor through `count` rows, wrapping. */
export function stepCursor(cursor: number, step: number, count: number): number {
  return count ? (cursor + step + count) % count : 0;
}

/** Next weight in the family's own list, clamped at the ends. */
export function stepWeight(weights: number[], current: number, step: 1 | -1): number {
  if (!weights.length) return current;
  const i = weights.indexOf(current);
  if (i < 0) return weights.reduce((p, w) => (Math.abs(w - current) < Math.abs(p - current) ? w : p));
  return weights[Math.min(weights.length - 1, Math.max(0, i + step))];
}

/**
 * Hover preview that commits once and restores on demand.
 * `begin`/`end` bracket an untracked preview (the panel's previewSession);
 * `apply` writes the family. Commit = end the preview, then write once.
 */
export function createPreview(io: { begin: () => void; end: () => void; apply: (family: string) => void }) {
  let active = false;
  let shown: string | null = null;
  return {
    show(family: string) {
      if (shown === family) return;
      if (!active) {
        io.begin();
        active = true;
      }
      shown = family;
      io.apply(family);
    },
    restore() {
      if (!active) return;
      active = false;
      shown = null;
      io.end();
    },
    commit(family: string) {
      if (active) {
        active = false;
        shown = null;
        io.end();
      }
      io.apply(family);
    },
    get active() {
      return active;
    },
  };
}

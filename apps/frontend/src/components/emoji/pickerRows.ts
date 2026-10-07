import { lookupEmoji, searchEmoji, type EmojiEntry, type EmojiIndex } from '../../engine/emoji/emojiIndex';

/** Grid geometry, shared by the layout below and the picker that draws it. */
export const COLUMNS = 8;
export const CELL = 36;
export const HEADER = 28;

export type PickerRow =
  | { kind: 'header'; id: string; section: string; label: string; top: number; height: number }
  | { kind: 'cells'; section: string; entries: EmojiEntry[]; first: number; top: number; height: number };

/**
 * The picker's rows, with their offsets, ready to virtualise.
 *
 * Two row heights only — a section heading and a row of cells — so the offset
 * of any row is a running sum computed once per query, and finding what is in
 * view is a scan over a few hundred numbers rather than a measurement.
 *
 * With a query there is one section of results; without one, recents (when
 * there are any) and then every category in catalogue order.
 */
export function buildRows(index: EmojiIndex, query: string, recents: readonly string[], columns = COLUMNS): PickerRow[] {
  const sections: Array<{ id: string; label: string; entries: EmojiEntry[] }> = [];
  const q = query.trim();
  if (q) {
    sections.push({ id: 'results', label: 'Results', entries: searchEmoji(index, q) });
  } else {
    const recent = recents.map((n) => lookupEmoji(index, n)).filter((e): e is EmojiEntry => Boolean(e));
    const seen = new Set<EmojiEntry>();
    const unique = recent.filter((e) => (seen.has(e) ? false : (seen.add(e), true)));
    if (unique.length) sections.push({ id: 'recent', label: 'Recently used', entries: unique });
    const byGroup = index.categories.map(() => [] as EmojiEntry[]);
    for (const e of index.emoji) byGroup[e.g]?.push(e);
    index.categories.forEach((c, i) => {
      if (byGroup[i].length) sections.push({ id: c.id, label: c.label, entries: byGroup[i] });
    });
  }

  const rows: PickerRow[] = [];
  let top = 0;
  let first = 0;
  for (const s of sections) {
    if (s.entries.length === 0) continue;
    rows.push({ kind: 'header', id: s.id, section: s.id, label: s.label, top, height: HEADER });
    top += HEADER;
    for (let i = 0; i < s.entries.length; i += columns) {
      const entries = s.entries.slice(i, i + columns);
      rows.push({ kind: 'cells', section: s.id, entries, first, top, height: CELL });
      first += entries.length;
      top += CELL;
    }
  }
  return rows;
}

/** The row holding the `i`th emoji in display order. A few hundred rows at most, so a scan. */
export function rowAt(rows: readonly PickerRow[], i: number): Extract<PickerRow, { kind: 'cells' }> | undefined {
  for (const r of rows) {
    if (r.kind === 'cells' && i >= r.first && i < r.first + r.entries.length) return r;
  }
  return undefined;
}

/**
 * The cell above or below `i`, keeping its column where the next row is long
 * enough. Section headings are stepped over, and a short last row of a section
 * takes the cursor to its final cell rather than past it.
 */
export function verticalStep(rows: readonly PickerRow[], i: number, dir: 1 | -1): number {
  const row = rowAt(rows, i);
  if (!row) return i;
  const column = i - row.first;
  let at = rows.indexOf(row) + dir;
  while (at >= 0 && at < rows.length && rows[at].kind !== 'cells') at += dir;
  const next = rows[at];
  if (!next || next.kind !== 'cells') return i;
  return next.first + Math.min(column, next.entries.length - 1);
}

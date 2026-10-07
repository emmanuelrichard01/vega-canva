import type React from 'react';

export interface PaletteItem {
  id: string;
  label: string;
  /** Secondary line — object type, author, or a description. */
  detail?: string;
  group: string;
  icon: React.ReactNode;
  shortcut?: string;
  /** Extra words the search matches on but the row does not show. */
  keywords?: string;
  perform: () => void;
}

/**
 * Subsequence match with a crude quality score.
 *
 * A subsequence test with bonuses for prefix and word-boundary hits gives the
 * ordering people expect from "shp" → "Add Shape" without the cost of full
 * fuzzy alignment. `null` means no match.
 */
export function fuzzyScore(haystack: string, needle: string): number | null {
  if (!needle) return 0;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();

  if (h.startsWith(n)) return 1000;

  let score = 0;
  let hIndex = 0;
  let lastMatch = -1;

  for (const char of n) {
    const found = h.indexOf(char, hIndex);
    if (found === -1) return null;
    if (found === lastMatch + 1) score += 8;
    if (found === 0 || h[found - 1] === ' ') score += 6;
    score += 1;
    lastMatch = found;
    hIndex = found + 1;
  }

  // Prefer shorter labels among equal matches.
  return score - h.length * 0.05;
}

/**
 * How well an item matches, and whether the match is in its label.
 *
 * The label is tried on its own first, so a row whose label matches is
 * ranked above one that only matches through its group, detail or keywords —
 * and only a label match is highlighted, because marking letters in a label
 * that did not produce the match tells the reader something false.
 */
export function scoreItem(item: PaletteItem, query: string): { score: number; onLabel: boolean } | null {
  const label = fuzzyScore(item.label, query);
  if (label !== null) return { score: label + 100, onLabel: true };
  const anywhere = fuzzyScore(
    [item.label, item.group, item.detail, item.keywords].filter(Boolean).join(' '),
    query
  );
  return anywhere === null ? null : { score: anywhere * 0.5, onLabel: false };
}

/** Whether to mark the matched letters of this label. */
export function labelMatches(label: string, query: string): boolean {
  return !!query.trim() && fuzzyScore(label, query) !== null;
}

/**
 * Keep each group's rows together, groups in the order they first appear.
 *
 * Results are ranked across groups, and a list that interleaves them prints
 * the same heading several times. Ranking still decides which group leads and
 * the order within each one.
 */
export function groupRuns(items: readonly PaletteItem[]): PaletteItem[] {
  const order: string[] = [];
  const byGroup = new Map<string, PaletteItem[]>();
  for (const item of items) {
    if (!byGroup.has(item.group)) { byGroup.set(item.group, []); order.push(item.group); }
    byGroup.get(item.group)!.push(item);
  }
  return order.flatMap((g) => byGroup.get(g)!);
}

/** Rank `items` against `query`, keeping only matches, one run per group. */
export function rankItems(items: readonly PaletteItem[], query: string): PaletteItem[] {
  if (!query.trim()) return groupRuns(items);
  return groupRuns(
    items
      .map((item) => ({ item, match: scoreItem(item, query) }))
      .filter((entry): entry is { item: PaletteItem; match: { score: number; onLabel: boolean } } => entry.match !== null)
      .sort((a, b) => b.match.score - a.match.score)
      .map((entry) => entry.item)
  );
}

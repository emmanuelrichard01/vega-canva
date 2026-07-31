/**
 * Sticky tags, and the filter that makes them worth having.
 *
 * `tags` sat on the schema for the project's whole life, written and read by
 * nothing. A tag with no way to filter by it is decoration — you can label a
 * note and then never act on the label — so the field and the filter arrive
 * together or not at all.
 */

/** Longest a tag may be. Long enough for "needs-design", short enough to chip. */
export const MAX_TAG_LENGTH = 24;
/** Per note. Past this the note is a filing cabinet, not a thought. */
export const MAX_TAGS_PER_NODE = 6;

/**
 * Canonical form of a tag as typed.
 *
 * Lower-cased and internally hyphenated so "Needs Design", "needs design" and
 * "needs-design" are one tag rather than three that filter separately — which
 * is the failure mode that makes free-text tagging useless within a week.
 * Returns an empty string for anything that normalises to nothing.
 */
export function normalizeTag(raw: string): string {
  return (raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/^#+/, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, MAX_TAG_LENGTH);
}

/** Add a tag to a list, normalised, de-duplicated and capped. */
export function addTag(tags: string[], raw: string): string[] {
  const tag = normalizeTag(raw);
  if (!tag) return tags;
  if (tags.includes(tag)) return tags;
  if (tags.length >= MAX_TAGS_PER_NODE) return tags;
  return [...tags, tag];
}

export function removeTag(tags: string[], tag: string): string[] {
  return tags.filter((t) => t !== tag);
}

/** Every tag in use, with how many notes carry it, most-used first. */
export function tagCounts(nodes: Iterable<{ tags?: string[] }>): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    for (const tag of node.tags ?? []) {
      if (!tag) continue;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * Does a node match the active filter?
 *
 * **Any**, not all. Selecting `risk` and `blocked` asks "show me everything
 * that is either" — which is what people reach for when triaging a board. An
 * all-of filter over hand-typed tags returns nothing almost every time, and a
 * filter that usually returns nothing gets abandoned.
 *
 * An empty filter matches everything, so "no filter" needs no special case at
 * any call site.
 */
export function matchesTagFilter(node: { tags?: string[] }, active: Set<string>): boolean {
  if (active.size === 0) return true;
  const tags = node.tags;
  if (!tags || tags.length === 0) return false;
  return tags.some((tag) => active.has(tag));
}

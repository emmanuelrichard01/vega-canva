import type { AnyNode } from '../model/schema';

/**
 * "Select all with the same …", the Figma command.
 *
 * Matching is by what a person sees, not by how the value is stored: two fills
 * of `#3B82F6` and `#3b82f6` are the same blue, and a shape's kind counts as
 * part of its type, so selecting "same type" from an ellipse does not also
 * pick up every rectangle.
 */
export type SimilarKey = 'type' | 'fill' | 'stroke' | 'font';

type Loose = Record<string, unknown>;

const norm = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : null;

function firstPaint(list: unknown): string | null {
  if (!Array.isArray(list)) return null;
  for (const p of list) {
    if (p && typeof p === 'object' && (p as Loose).type === 'solid') {
      const c = norm((p as Loose).color);
      if (c) return c;
    }
  }
  return null;
}

/** The value a node is compared on, or `null` when it has none. */
export function similarityValue(node: AnyNode, key: SimilarKey): string | null {
  const n = node as unknown as Loose;
  const appearance = (n.appearance ?? {}) as Loose;
  switch (key) {
    case 'type': {
      const geometry = (n.geometry ?? {}) as Loose;
      const kind = typeof geometry.kind === 'string' ? `:${geometry.kind}` : '';
      return `${String(n.type)}${kind}`;
    }
    case 'fill':
      return firstPaint(appearance.fill) ?? (n.type === 'sticky' ? norm(n.theme) : null);
    case 'stroke': {
      const stroke = (appearance.stroke ?? {}) as Loose;
      return norm(stroke.color);
    }
    case 'font': {
      const t = (n.typography ?? appearance.typography ?? {}) as Loose;
      const family = norm(t.fontFamily);
      return family ? `${family}|${t.fontSize ?? ''}|${t.fontWeight ?? ''}` : null;
    }
  }
}

/**
 * Every visible, unlocked node matching any value the selection has.
 *
 * Several selected objects with different fills select every object wearing
 * any of those fills, which is what a person who selected them meant.
 */
export function selectSimilar(nodes: Iterable<AnyNode>, selected: readonly string[], key: SimilarKey): string[] {
  const list = Array.from(nodes);
  const byId = new Map(list.map((n) => [n.id, n]));
  const wanted = new Set<string>();
  for (const id of selected) {
    const node = byId.get(id);
    const v = node ? similarityValue(node, key) : null;
    if (v) wanted.add(v);
  }
  if (wanted.size === 0) return [...selected];
  return list
    .filter((n) => !n.locked && !(n as unknown as Loose).hidden)
    .filter((n) => {
      const v = similarityValue(n, key);
      return v !== null && wanted.has(v);
    })
    .map((n) => n.id);
}

import { CATEGORIES, type Template, type TemplateCategory } from '../../engine/templates/templates';

/**
 * Finding a template by what somebody types.
 *
 * Every word typed has to land somewhere — the name, a tag, a capability, the
 * category or the blurb — so "kafka diagram" narrows rather than widens. The
 * order then follows where the words landed: a hit on the name beats a hit in
 * a capability chip, which beats a hit buried in the blurb, and a word that
 * starts a word beats one found inside another ("org" finds "Org chart" before
 * "Kubernetes workloads"). Ties keep the catalogue's own editorial order.
 */

const WEIGHT = { name: 12, tag: 7, teaches: 6, category: 4, blurb: 2 } as const;

/** Lower case, accents folded, punctuation to spaces. */
export function fold(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#.]+/gu, ' ')
    .trim();
}

const tokens = (query: string) => fold(query).split(' ').filter(Boolean);

/** How well one token matches one field: a word start counts more than a substring. */
function hit(field: string, token: string): number {
  if (!field) return 0;
  if (field === token) return 1.6;
  if (field.startsWith(token) || field.includes(` ${token}`)) return 1.25;
  return field.includes(token) ? 1 : 0;
}

interface Indexed {
  template: Template;
  order: number;
  name: string;
  tags: string;
  teaches: string;
  category: string;
  blurb: string;
}

const LABEL = new Map(CATEGORIES.map((c) => [c.id, c.label]));
const indexCache = new WeakMap<readonly Template[], Indexed[]>();

function indexOf(templates: readonly Template[]): Indexed[] {
  let index = indexCache.get(templates);
  if (!index) {
    index = templates.map((template, order) => ({
      template,
      order,
      name: fold(template.name),
      tags: fold((template.tags ?? []).join(' ')),
      teaches: fold(template.teaches.join(' ')),
      category: fold(`${LABEL.get(template.category) ?? ''} ${template.category}`),
      blurb: fold(template.blurb),
    }));
    indexCache.set(templates, index);
  }
  return index;
}

/** A template's score for a query, or 0 when some word typed is found nowhere on it. */
export function scoreTemplate(entry: Indexed, words: readonly string[]): number {
  let total = 0;
  for (const word of words) {
    const best = Math.max(
      hit(entry.name, word) * WEIGHT.name,
      hit(entry.tags, word) * WEIGHT.tag,
      hit(entry.teaches, word) * WEIGHT.teaches,
      hit(entry.category, word) * WEIGHT.category,
      hit(entry.blurb, word) * WEIGHT.blurb
    );
    if (best === 0) return 0;
    total += best;
  }
  return total;
}

/**
 * The templates to show for a category and a query, best first.
 *
 * With no query the category's templates come back in catalogue order; the
 * gallery's sections and hero are an editorial arrangement, not a ranking.
 */
export function searchTemplates(
  templates: readonly Template[],
  query: string,
  category: TemplateCategory | null = null
): Template[] {
  const pool = indexOf(templates).filter((e) => !category || e.template.category === category);
  const words = tokens(query);
  if (words.length === 0) return pool.map((e) => e.template);
  return pool
    .map((entry) => ({ entry, score: scoreTemplate(entry, words) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.order - b.entry.order)
    .map((r) => r.entry.template);
}

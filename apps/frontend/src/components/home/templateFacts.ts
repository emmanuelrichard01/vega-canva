import { CATEGORIES, SHOWCASE, type Template } from '../../engine/templates/templates';

/** Boards whose point is that they move: the physics set. */
export const isInteractive = (template: Template): boolean => template.category === 'physics';

/** How to set an interactive board going, said where somebody is deciding to open it. */
export const INTERACTIVE_HINT = 'Press Shift+P on the board to pick up a force, then drag across the objects to push them.';

export const categoryLabel = (template: Template): string =>
  CATEGORIES.find((c) => c.id === template.category)?.label ?? '';

/**
 * The showcase: the boards `SHOWCASE` names first, then the other featured
 * boards one per category in the gallery's category order, five at most.
 *
 * One per category so the hero shows the range of the product rather than
 * three architectures; a builder flagging two boards in one set gets the
 * first of them here and the other still leads its own section.
 */
export function showcaseOf(templates: readonly Template[], max = 5, lead: readonly string[] = SHOWCASE): Template[] {
  const order = new Map(CATEGORIES.map((c, i) => [c.id, i]));
  const picked: Template[] = [];
  const seen = new Set<string>();
  for (const id of lead) {
    const t = templates.find((x) => x.id === id && x.featured);
    if (t && !picked.includes(t)) {
      picked.push(t);
      seen.add(t.category);
    }
  }
  const featured = templates
    .filter((t) => t.featured)
    .sort((a, b) => (order.get(a.category) ?? 99) - (order.get(b.category) ?? 99));
  for (const t of featured) {
    if (seen.has(t.category)) continue;
    seen.add(t.category);
    picked.push(t);
  }
  // Room left over goes to the second featured board of a category.
  for (const t of featured) if (picked.length < max && !picked.includes(t)) picked.push(t);
  return picked.slice(0, max);
}

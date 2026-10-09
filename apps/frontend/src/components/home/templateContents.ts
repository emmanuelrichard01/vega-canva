import type { Template } from '../../engine/templates/templates';

/** What a template is made of, by kind, most common first. */
export interface ContentCount {
  type: string;
  label: string;
  count: number;
}

const NAMES: Record<string, [string, string]> = {
  sticky: ['sticky note', 'sticky notes'],
  shape: ['shape', 'shapes'],
  text: ['text', 'texts'],
  connector: ['connector', 'connectors'],
  frame: ['frame', 'frames'],
  image: ['image', 'images'],
  path: ['drawing', 'drawings'],
  chart: ['chart', 'charts'],
  table: ['table', 'tables'],
  grid: ['grid', 'grids'],
  code: ['code block', 'code blocks'],
  link: ['link', 'links'],
  audio: ['audio note', 'audio notes'],
  comment: ['comment', 'comments'],
  icon: ['icon', 'icons'],
};

/**
 * Count a template's objects by kind.
 *
 * Built from the template itself, so the answer is the board it will make.
 * `limit` caps how many kinds are returned; the total is always exact.
 */
export function templateContents(template: Template, limit = 6): { total: number; kinds: ContentCount[] } {
  const counts = new Map<string, number>();
  const nodes = template.build();
  for (const node of nodes) {
    const type = String((node as { type?: unknown }).type ?? 'shape');
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  const kinds = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([type, count]) => {
      const [one, many] = NAMES[type] ?? [type, `${type}s`];
      return { type, count, label: count === 1 ? one : many };
    });
  return { total: nodes.length, kinds };
}

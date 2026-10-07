import { kindNoun } from '../../../engine/model/selectMatching';
import type { AnyNode } from '../../../engine/model/schema';

/** "3 shapes, 2 connectors": what a multiple selection is made of. */
export function describeMix(nodes: readonly AnyNode[]): string {
  const counts = new Map<string, { node: AnyNode; n: number }>();
  for (const node of nodes) {
    const entry = counts.get(node.type);
    if (entry) entry.n += 1;
    else counts.set(node.type, { node, n: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.n - a.n)
    .map(({ node, n }) => `${n} ${kindNoun(node, n !== 1)}`)
    .join(', ');
}

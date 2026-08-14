import { hasText, type AnyNode } from './schema';

/**
 * What to call a node in prose or in a list.
 *
 * Text-bearing nodes label themselves with their first line of content, so the
 * Layers panel reads like an outline rather than "Text, Text, Text" — and the
 * session timeline can say "Ada edited Quarterly goals" instead of naming a
 * nanoid. This lived privately inside LayersPanel; it is shared now so the two
 * surfaces cannot drift into calling the same object different things.
 */
export function nodeLabel(node: AnyNode): string {
  if (node.title) return node.title;
  if (hasText(node)) {
    const firstLine = (node.text ?? '').trim().split('\n')[0].slice(0, 24);
    if (firstLine) return firstLine;
  }
  if (node.type === 'sticky') return 'Idea Card';
  // A connector's label is the word riding its middle — "yes", "no", "retry".
  // On a flowchart that is the only thing telling one arrow from the next.
  if (node.type === 'connector' && node.label) return node.label.slice(0, 24);
  return `${node.type.charAt(0).toUpperCase()}${node.type.slice(1)}`;
}

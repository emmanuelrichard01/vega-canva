import { hasText, type AnyNode, type NodeType } from './schema';

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

/**
 * What each node type is called as a filter chip, and the order the chips
 * come in.
 *
 * ## Why this is a full `Record` and not a `Partial`
 *
 * These lived in `LayersPanel` as two hand-written lists covering eight of
 * the nine node types. `connector` was the one missing — the same omission,
 * from the same cause, as the `normalizeType` allow-list that silently
 * rewrote every connector into a shape. A board built out of connectors
 * offered no way to filter for them, and nothing said so.
 *
 * Typed against `NodeType` with no `Partial`, adding a type to the schema now
 * fails the build here instead of quietly producing a filter nobody can
 * reach. `TYPE_ORDER` is covered by a test for the same reason: a list that
 * has to stay in step with another list does not stay in step on its own.
 */
export const TYPE_LABEL: Record<NodeType, string> = {
  frame: 'Frames',
  text: 'Text',
  shape: 'Shapes',
  path: 'Paths',
  connector: 'Connectors',
  image: 'Images',
  sticky: 'Notes',
  audio: 'Audio',
  comment: 'Comments',
};

/**
 * Frames first, because that is where people look; connectors sit with the
 * things they join rather than at the end with the media.
 */
export const TYPE_ORDER: NodeType[] = [
  'frame', 'text', 'shape', 'path', 'connector', 'image', 'sticky', 'audio', 'comment',
];

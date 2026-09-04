import { GRID_LABELS } from '../grid/gridLayout';
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
  /**
   * A grid is named by its system, because that is what distinguishes one.
   *
   * "Grid" for all of them would be the connector problem again: a board with a
   * bento wall, a golden section and a dial reads as three identical rows, and
   * the panel's whole job is telling them apart.
   */
  if (node.type === 'grid') return `${GRID_LABELS[node.grid.spec.kind]} grid`;
  const specific = specificName(node);
  if (specific) return specific;
  return `${node.type.charAt(0).toUpperCase()}${node.type.slice(1)}`;
}

/**
 * The name a shape or a path earns from what it actually is.
 *
 * Falling through to the bare type word gave every rectangle, ellipse, star,
 * line and arrow the same name: **Shape**. A board of a dozen of them is a
 * dozen identical rows, and the Layers panel — whose entire job is telling one
 * object from another — could not. The icon says which kind it is, but only if
 * you already know the icons, and it says nothing at a glance down a list.
 *
 * Naming by kind is what every editor does, and it costs nothing: the
 * information was already on the node and was being thrown away.
 *
 * Polygons name their common side counts. A hexagon is a hexagon to everyone;
 * a nine-sided polygon is a polygon to everyone, and inventing "nonagon" for a
 * layer list helps nobody.
 */
const POLYGON_NAMES: Record<number, string> = {
  3: 'Triangle',
  5: 'Pentagon',
  6: 'Hexagon',
  7: 'Heptagon',
  8: 'Octagon',
};

function specificName(node: AnyNode): string | null {
  /**
   * Total, like everything at this layer.
   *
   * `geometry` is guaranteed by the normalizer, but this is also called on
   * nodes that have not been through it — a partially written object mid-sync,
   * a fixture, a node from an import that has not landed yet. Reading `.kind`
   * off nothing threw, and the thing that threw was the *Layers panel*, which
   * is the surface someone would be looking at to work out what was wrong.
   */
  const geometry = (node as { geometry?: { kind?: string; points?: number; closed?: boolean } }).geometry;
  if (!geometry?.kind) return null;

  if (node.type === 'shape') {
    switch (geometry.kind) {
      case 'rect':
        // A rounded rectangle is still a rectangle; the radius is paint, not
        // identity, and a name that changed when you rounded a corner would
        // make the list move under the reader.
        return 'Rectangle';
      case 'ellipse':
        return 'Ellipse';
      case 'star':
        return 'Star';
      case 'line':
        return 'Line';
      case 'arrow':
        return 'Arrow';
      case 'polygon':
        return POLYGON_NAMES[geometry.points ?? 3] ?? 'Polygon';
    }
  }
  if (node.type === 'path') {
    switch (geometry.kind) {
      // What the user *did*, not what it is stored as. Nobody thinks of a
      // pencil stroke as a freehand geometry.
      case 'freehand':
        return 'Drawing';
      case 'compound':
        return 'Compound path';
      case 'bezier':
        return geometry.closed ? 'Shape path' : 'Path';
    }
  }
  return null;
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
  grid: 'Grids',
  chart: 'Charts',
};

/**
 * Frames first, because that is where people look; connectors sit with the
 * things they join rather than at the end with the media.
 */
export const TYPE_ORDER: NodeType[] = [
  // Grids sit beside frames: both are scaffolding you arrange other work
  // against, and neither is content in its own right.
  // A chart is scaffolding's opposite -- it is the content -- but it sits
  // beside 'grid' because both are composite objects people look for by shape
  // rather than by the words inside them.
  'frame', 'grid', 'chart', 'text', 'shape', 'path', 'connector', 'image', 'sticky', 'audio', 'comment',
];

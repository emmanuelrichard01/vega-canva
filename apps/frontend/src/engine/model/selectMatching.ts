import type { AnyNode, Appearance } from './schema';

/**
 * Growing a selection to everything like it.
 *
 * "Select all shapes" was the only version of this, and it answered a question
 * nobody asks: on a board with forty shapes the ones you want are the *red
 * diamonds*, not every box, line and arrow that happens to share a node type.
 * Figma's Select matching layers and Lucidchart's Select same are the model.
 *
 * Two readings, because they are the two things people mean:
 *
 * - **Same kind** — rectangles with rectangles, notes with notes, connectors
 *   with connectors. For shapes the kind is the geometry, so a line is not
 *   matched to a rectangle just because both are `shape` nodes.
 * - **Same style** — the same kind, painted the same: fill, stroke colour and
 *   weight, a note's paper, a text's colour and face. "Every one of these
 *   amber boxes", which is how a colour code on a board is read.
 */

export type MatchMode = 'kind' | 'style';

/** What a node *is*, finely enough that a line and a rectangle differ. */
export function kindKey(node: AnyNode): string {
  if (node.type === 'shape') return `shape:${node.geometry.kind}:${node.geometry.points ?? ''}`;
  if (node.type === 'path') return `path:${node.geometry.kind}`;
  if (node.type === 'chart') return `chart:${node.chart.kind}`;
  return node.type;
}

function paintKey(node: AnyNode): string {
  const appearance = (node as { appearance?: Appearance }).appearance;
  const fill = appearance?.fill?.[0];
  const fillKey = !fill ? '-' : fill.type === 'solid' ? fill.color.toLowerCase() : JSON.stringify(fill);
  const stroke = appearance?.stroke;
  const strokeKey = stroke && stroke.width > 0 ? `${stroke.color.toLowerCase()}/${stroke.width}` : '-';
  let extra = '';
  if (node.type === 'sticky') extra = node.theme;
  else if (node.type === 'text') extra = `${node.typography.color}/${node.typography.fontFamily}`;
  return `${fillKey}|${strokeKey}|${extra}`;
}

/**
 * Everything on the board that matches any of the seeds, seeds included.
 *
 * Hidden objects are left out: selecting something you cannot see is how a
 * delete takes work nobody knew was there.
 */
export function matchingIds(
  all: readonly AnyNode[],
  seeds: readonly AnyNode[],
  mode: MatchMode
): string[] {
  const key = mode === 'kind' ? kindKey : (n: AnyNode) => `${kindKey(n)}#${paintKey(n)}`;
  const wanted = new Set(seeds.map(key));
  const seedIds = new Set(seeds.map((n) => n.id));
  return all
    .filter((n) => seedIds.has(n.id) || (!n.hidden && wanted.has(key(n))))
    .map((n) => n.id);
}

/** The plural noun for a selection's kind, for the words on the menu. */
export function kindNoun(node: AnyNode, plural: boolean): string {
  const nouns: Record<string, [string, string]> = {
    shape: ['shape', 'shapes'],
    text: ['text box', 'text boxes'],
    sticky: ['note', 'notes'],
    image: ['image', 'images'],
    audio: ['voice note', 'voice notes'],
    path: ['drawing', 'drawings'],
    comment: ['comment', 'comments'],
    frame: ['frame', 'frames'],
    connector: ['connector', 'connectors'],
    grid: ['grid', 'grids'],
    chart: ['chart', 'charts'],
    table: ['table', 'tables'],
    code: ['code block', 'code blocks'],
    link: ['link', 'links'],
  };
  const pair = nouns[node.type] ?? [node.type, `${node.type}s`];
  return plural ? pair[1] : pair[0];
}

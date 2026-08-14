import type { AnyNode } from './schema';
import { nodeBounds, selectionBounds, type NodePatch } from './selection';

/**
 * Aligning and distributing a selection.
 *
 * The one thing a multi-selection is most often selected *in order to do*, and
 * the app has never had it — there is no align, no distribute and no tidy up
 * anywhere in the codebase. Everything here is pure and returns patches, so it
 * runs in Node and so a single `applyNodePatches` call makes the whole
 * arrangement one undo step.
 *
 * Every function measures the **rendered** box (`nodeBounds`), not the stored
 * `x/width`. Aligning a rotated square by its unrotated box leaves its visible
 * corner hanging over the edge you just aligned it to, which is exactly the
 * thing you were looking at when you pressed the button.
 */

export type AlignEdge = 'left' | 'centerX' | 'right' | 'top' | 'middleY' | 'bottom';
export type DistributeAxis = 'horizontal' | 'vertical';

/**
 * Push every object to one edge of the selection's box.
 *
 * The box is the selection's own extent rather than a frame's, which is what
 * makes "align left" mean "line these up with each other" — the reading that
 * applies whether or not the selection happens to sit inside anything.
 *
 * Alignment writes a *delta*, never an absolute coordinate: a node's stored
 * `x` is the corner of its unrotated box, and the thing being lined up is the
 * corner of its rotated one, so the two differ by an offset that is different
 * for every node.
 */
export function alignSelection(nodes: readonly AnyNode[], edge: AlignEdge): NodePatch[] {
  // One object has nothing to align against — with the selection's own box as
  // the reference, aligning it to itself is by definition a no-op.
  if (nodes.length < 2) return [];
  const box = selectionBounds(nodes);
  if (!box) return [];

  const patches: NodePatch[] = [];
  nodes.forEach((node) => {
    const b = nodeBounds(node);
    let delta = 0;
    let axis: 'x' | 'y' = 'x';

    switch (edge) {
      case 'left': delta = box.x - b.x; break;
      case 'centerX': delta = box.x + (box.width - b.width) / 2 - b.x; break;
      case 'right': delta = box.x + box.width - b.width - b.x; break;
      case 'top': axis = 'y'; delta = box.y - b.y; break;
      case 'middleY': axis = 'y'; delta = box.y + (box.height - b.height) / 2 - b.y; break;
      case 'bottom': axis = 'y'; delta = box.y + box.height - b.height - b.y; break;
    }

    if (delta === 0) return;
    patches.push({ id: node.id, changes: { [axis]: node[axis] + delta } });
  });
  return patches;
}

/**
 * Equalise the *gaps* between objects, not their centres.
 *
 * Two readings of "distribute" exist and they disagree whenever the objects
 * are different sizes. Evenly spaced centres leave a big object almost
 * touching its neighbour while two small ones sit far apart — which looks
 * wrong, because what the eye reads as rhythm is the whitespace, not the
 * midpoints. So this equalises edge-to-edge gaps, which is what "Tidy up"
 * means everywhere it appears.
 *
 * The outermost two objects never move: they define the span being divided.
 * Moving them would make the button change the selection's overall size, which
 * is not what anybody expects from an arrangement tool.
 */
export function distributeSelection(nodes: readonly AnyNode[], axis: DistributeAxis): NodePatch[] {
  // Two objects have exactly one gap, so there is nothing to equalise; with
  // both endpoints pinned the operation is a no-op by construction.
  if (nodes.length < 3) return [];
  const box = selectionBounds(nodes);
  if (!box) return [];

  const sizeKey = axis === 'horizontal' ? 'width' : 'height';
  const posKey = axis === 'horizontal' ? 'x' : 'y';

  const ordered = nodes
    .map((node) => ({ node, box: nodeBounds(node) }))
    .sort((a, b) => a.box[posKey] - b.box[posKey]);

  const totalSize = ordered.reduce((sum, item) => sum + item.box[sizeKey], 0);
  // Negative when the objects overlap more than the span allows; that is a
  // legitimate arrangement (evenly overlapping) rather than an error.
  const gap = (box[sizeKey] - totalSize) / (ordered.length - 1);

  const patches: NodePatch[] = [];
  let cursor = box[posKey];
  ordered.forEach((item, index) => {
    // The first and last keep their positions exactly, rather than being
    // recomputed and landing a rounding error away from where they started.
    if (index > 0 && index < ordered.length - 1) {
      const delta = cursor - item.box[posKey];
      if (delta !== 0) {
        patches.push({ id: item.node.id, changes: { [posKey]: item.node[posKey] + delta } });
      }
    }
    cursor += item.box[sizeKey] + gap;
  });
  return patches;
}

/**
 * Lay the selection out in a row or a column with one even gap.
 *
 * Distinct from `distributeSelection`, which preserves the span and only fixes
 * the spacing inside it. Tidy up *packs* the objects at a chosen gap and also
 * lines them up on their cross axis, which is the "make this mess into a row"
 * action rather than the "even these out" one.
 */
export function tidyUp(nodes: readonly AnyNode[], axis: DistributeAxis, gap = 24): NodePatch[] {
  if (nodes.length < 2) return [];
  const box = selectionBounds(nodes);
  if (!box) return [];

  const sizeKey = axis === 'horizontal' ? 'width' : 'height';
  const posKey = axis === 'horizontal' ? 'x' : 'y';
  const crossPos = axis === 'horizontal' ? 'y' : 'x';
  const crossSize = axis === 'horizontal' ? 'height' : 'width';

  const ordered = nodes
    .map((node) => ({ node, box: nodeBounds(node) }))
    .sort((a, b) => a.box[posKey] - b.box[posKey]);

  const patches: NodePatch[] = [];
  let cursor = box[posKey];
  ordered.forEach((item) => {
    const changes: Record<string, unknown> = {};
    const mainDelta = cursor - item.box[posKey];
    if (mainDelta !== 0) changes[posKey] = item.node[posKey] + mainDelta;

    // Centred on the cross axis, so a tidied row reads as a row rather than as
    // a ragged band of things that merely have even gaps.
    const crossTarget = box[crossPos] + (box[crossSize] - item.box[crossSize]) / 2;
    const crossDelta = crossTarget - item.box[crossPos];
    if (crossDelta !== 0) changes[crossPos] = item.node[crossPos] + crossDelta;

    if (Object.keys(changes).length > 0) patches.push({ id: item.node.id, changes });
    cursor += item.box[sizeKey] + gap;
  });
  return patches;
}

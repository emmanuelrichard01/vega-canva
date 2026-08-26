/**
 * The vector operations, as document edits.
 *
 * `pathGeometry`, `shapeToPath` and `pathBoolean` are arithmetic and know
 * nothing about nodes. This is the layer that does: which objects are eligible,
 * how their local geometry gets into a shared coordinate space, what the
 * result inherits, and what happens to the operands.
 *
 * ## Everything goes through the mutation API
 *
 * `createNode` and `deleteNode`, never the Y.Map. That is the rule the rest of
 * the document layer follows and the reason a boolean is one undo step: the
 * whole operation runs inside a single call sequence the history manager sees
 * as one action.
 */

import { createNode, deleteNode, updateNode } from './mutations';
import { useStore } from '../../hooks/useStore';
import { booleanPaths, type BooleanOp, type BooleanOperand } from '../model/pathBoolean';
import { reframePath, translatePath, type ContourGeometry } from '../model/pathGeometry';
import { shapeToPath } from '../model/shapeToPath';
import { outlineText } from '../text/textOutline';
import { outlineStroke } from '../model/strokeOutline';
import type { AnyNode, Appearance } from '../model/schema';

/**
 * A node's outline in **world** coordinates, or null if it has none.
 *
 * Shapes are converted; bezier and compound paths are shifted out of their own
 * local space. A freehand blob is refused — its geometry is the *outline of a
 * stroke*, already a filled silhouette, and treating it as a contour would
 * union the outline rather than the mark anyone drew.
 *
 * Rotation and scale are not applied. A rotated operand would need its
 * geometry run through the node's full transform, which is the right thing to
 * do and is not done here — so the operations are offered on unrotated objects
 * only, rather than quietly producing a result that ignores the rotation.
 */
export function worldOutline(node: AnyNode): ContourGeometry | null {
  if (node.type === 'shape') {
    return translatePath(shapeToPath(node), node.x, node.y);
  }
  if (node.type === 'path' && node.geometry.kind !== 'freehand') {
    return translatePath(node.geometry, node.x, node.y);
  }
  return null;
}

/** Whether this node can take part in a boolean or be flattened. */
export function canVectorize(node: AnyNode | undefined): boolean {
  if (!node || node.locked) return false;
  if (node.rotation) return false;
  if ((node.scaleX ?? 1) !== 1 || (node.scaleY ?? 1) !== 1) return false;
  return worldOutline(node) !== null;
}

/** The appearance the result of an operation should wear. */
function resultAppearance(node: AnyNode): Appearance {
  // The first operand's, in z-order — which is the one whose fill and stroke
  // the user is looking at when they combine two overlapping shapes, because
  // it is the one in front. Inventing a default here would silently discard
  // whatever styling the operands had.
  return ('appearance' in node && node.appearance ? { ...node.appearance } : {}) as Appearance;
}

/** Selected ids, sorted the way the canvas stacks them rather than the way they were clicked. */
function inZOrder(ids: readonly string[]): AnyNode[] {
  const objects = useStore.getState().objects;
  return ids
    .map((id) => objects[id])
    .filter((n): n is AnyNode => Boolean(n))
    .sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0));
}

/**
 * Combine two or more objects, replacing them with the result.
 *
 * Returns the new node's id, or null if nothing was done — which is the case
 * whenever the result would be empty, an operand is ineligible, or the clipper
 * declined. Nothing is deleted unless a result was produced, so a boolean that
 * cannot be computed costs the user nothing.
 *
 * The topmost object leads. For `subtract` that decides which shape survives
 * and which is removed from it, and z-order is the only ordering the user can
 * see and change — selection order is whatever sequence the clicks happened
 * in, which would make the same two objects subtract differently depending on
 * which one you happened to touch first.
 */
export function applyBoolean(op: BooleanOp, ids: readonly string[]): string | null {
  const nodes = inZOrder(ids).filter(canVectorize);
  if (nodes.length < 2) return null;

  const operands = nodes.map(worldOutline).filter((g): g is BooleanOperand => g !== null);
  const combined = booleanPaths(op, operands);
  if (!combined) return null;

  const framed = reframePath(combined);
  const lead = nodes[0];
  const id = createNode({
    type: 'path',
    x: framed.dx,
    y: framed.dy,
    width: framed.width,
    height: framed.height,
    geometry: framed.geometry,
    appearance: resultAppearance(lead),
    opacity: lead.opacity ?? 1,
  });

  for (const node of nodes) deleteNode(node.id);
  return id;
}

/**
 * Turn a shape into an editable path, in place.
 *
 * The point of this is not the conversion, it is what the conversion unlocks:
 * a rectangle has a width and a corner radius, and no amount of anchor editing
 * applies to it. Flattening is how a primitive becomes something you can pull
 * a point out of.
 *
 * The old node is replaced rather than mutated, because a shape and a path are
 * different node types and `type` is not something `updateNode` should be
 * rewriting underneath a subscribed renderer.
 *
 * Shapes only. Text goes through `textToPath`, which has to read the font
 * binary and so cannot be synchronous.
 */
export function flattenToPath(id: string): string | null {
  const node = useStore.getState().objects[id];
  if (!node || node.type !== 'shape' || node.locked) return null;

  const geometry = shapeToPath(node);
  const newId = createNode({
    type: 'path',
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    geometry,
    appearance: { ...node.appearance },
    opacity: node.opacity ?? 1,
    // Rotation and scale survive because they are node transforms, applied to
    // whatever the node draws — unlike the boolean above, nothing here needs
    // the geometry to be in a shared space with anything else.
    rotation: node.rotation ?? 0,
    scaleX: node.scaleX ?? 1,
    scaleY: node.scaleY ?? 1,
  });
  deleteNode(id);
  return newId;
}

/**
 * Turn a text object into its own letterforms.
 *
 * ## Why this is not `flattenToPath` with another branch
 *
 * A shape's outline is arithmetic — `shapeToPath` derives a rectangle's corners
 * from its own fields, synchronously, from data already in the document. A
 * letterform is not derivable from anything the document holds: the curves live
 * in the font file, which has to be fetched and parsed. So this one is
 * asynchronous, can fail for reasons a person can act on, and belongs beside
 * `flattenToPath` rather than inside it.
 *
 * ## What the result is
 *
 * One path node carrying every glyph as a compound geometry, filled even-odd so
 * the counter of an `o` is a hole rather than a disc sitting on a ring. The
 * text's colour becomes the path's fill, because that is the paint that was
 * describing the letters. The box is re-measured from the outline: a
 * paragraph's box includes its leading and its descender space, and the glyphs
 * do not fill it — keeping the old box would leave the path floating inside
 * empty margins that every later resize would then stretch.
 *
 * Decoration the font cannot express — an underline, a highlight, list markers
 * — is not invented here. `outlineText` names what it dropped so the caller can
 * say so.
 *
 * @returns the new node's id and what was dropped, or null when there was
 *   nothing to draw. Throws `FontUnavailableError` for a face that cannot be
 *   read.
 */
export async function textToPath(
  id: string
): Promise<{ id: string; dropped: string[] } | null> {
  const node = useStore.getState().objects[id];
  if (!node || node.type !== 'text' || node.locked) return null;

  const outlined = await outlineText(node);
  if (!outlined) return null;

  // The document may have moved on while the font was in flight -- somebody
  // deleted the text, or a peer edited it. Re-read rather than trusting the
  // snapshot the outline was built from.
  const current = useStore.getState().objects[id];
  if (!current || current.type !== 'text') return null;

  const framed = reframePath(outlined.geometry);
  const newId = createNode({
    type: 'path',
    // `framed.dx/dy` is where the glyphs sat inside the text's box, which is
    // what keeps the outline exactly where the words were.
    x: current.x + framed.dx,
    y: current.y + framed.dy,
    width: framed.width,
    height: framed.height,
    geometry: framed.geometry,
    appearance: { fill: [{ type: 'solid', color: current.typography.color }] },
    opacity: current.opacity ?? 1,
    rotation: current.rotation ?? 0,
  });
  deleteNode(id);
  return { id: newId, dropped: outlined.dropped };
}

/**
 * Replace an object's stroke with a filled shape of the region it covered.
 *
 * What happens to the object depends on whether it had a fill:
 *
 * - **No fill** — the object *was* its stroke, so it is replaced outright.
 * - **A fill** — the fill is still wanted, so the object keeps it, loses its
 *   stroke, and the outline is added above it as its own object.
 *
 * The alternative — always replacing — silently discards a fill somebody
 * chose, and always adding leaves an invisible strokeless husk behind. Both
 * are worse than asking the question this asks.
 *
 * Returns the outline's id, or null if there was no stroke to outline.
 */
export function outlineStrokeOf(id: string): string | null {
  const node = useStore.getState().objects[id];
  if (!node || node.locked || node.rotation) return null;

  const appearance = ('appearance' in node ? node.appearance : undefined) as Appearance | undefined;
  const stroke = appearance?.stroke;
  if (!stroke || !(stroke.width > 0)) return null;

  const outline = node.type === 'shape' ? shapeToPath(node) : node.type === 'path' && node.geometry.kind !== 'freehand' ? node.geometry : null;
  if (!outline) return null;

  const region = outlineStroke(outline, stroke);
  if (!region) return null;

  const framed = reframePath(region);
  const outlineId = createNode({
    type: 'path',
    x: node.x + framed.dx,
    y: node.y + framed.dy,
    width: framed.width,
    height: framed.height,
    geometry: framed.geometry,
    // The stroke's colour becomes the new shape's fill, which is the whole
    // conversion: the paint that was describing a line is now describing a
    // region. Carried as a solid rather than the stroke's own field, because
    // a fill is a `Paint` list and a stroke colour is a string.
    appearance: { fill: [{ type: 'solid', color: stroke.color }] },
    opacity: node.opacity ?? 1,
  });

  const hasFill = Boolean(appearance?.fill?.length);
  if (hasFill) {
    updateNode(id, { appearance: { ...appearance, stroke: undefined } });
  } else {
    deleteNode(id);
  }
  return outlineId;
}

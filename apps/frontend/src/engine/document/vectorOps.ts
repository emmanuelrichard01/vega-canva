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
import { doc } from './doc';
import { useStore } from '../../hooks/useStore';
import { booleanPaths, BOOLEAN_OPS, type BooleanOp, type BooleanOperand } from '../model/pathBoolean';
import { mapPath, reframePath, type ContourGeometry } from '../model/pathGeometry';
import { shapeToPath } from '../model/shapeToPath';
import { outlineText } from '../text/textOutline';
import { outlineStroke } from '../model/strokeOutline';
import type { AnyNode, Appearance, CompoundGeometry, Point } from '../model/schema';

/**
 * The node's own transform, as a function on points.
 *
 * The canvas draws a node by placing its group at the box's *centre*, pulling
 * the contents back by half the box, then scaling and rotating — see
 * `ObjectRenderer`. This is that, written out, so geometry can be put where the
 * artwork visibly is.
 *
 * The order matters and is the renderer's: scale first, in the object's own
 * frame, then turn. Rotating before scaling would shear a non-uniformly scaled
 * object, which is a different shape from the one on screen.
 */
function nodeToWorld(node: AnyNode): (p: Point) => Point {
  const sx = node.scaleX ?? 1;
  const sy = node.scaleY ?? 1;
  const deg = node.rotation ?? 0;
  const halfW = node.width / 2;
  const halfH = node.height / 2;
  const cx = node.x + halfW;
  const cy = node.y + halfH;

  if (deg === 0 && sx === 1 && sy === 1) {
    return (p) => ({ x: p.x + node.x, y: p.y + node.y });
  }

  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  return (p) => {
    const dx = (p.x - halfW) * sx;
    const dy = (p.y - halfH) * sy;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  };
}

/**
 * A node's outline in **world** coordinates, or null if it has none.
 *
 * Shapes are converted; bezier and compound paths come out of their own local
 * space. A freehand blob is refused — its geometry is the *outline of a
 * stroke*, already a filled silhouette, and treating it as a contour would
 * union the outline rather than the mark anyone drew.
 *
 * ## Rotation and scale
 *
 * They are applied, through `mapPath`. This used to refuse a rotated or scaled
 * operand outright, which meant a boolean could not be asked of two shapes if
 * one of them had been turned a few degrees — a restriction with no equivalent
 * in any tool anybody compares this to, and one that had nothing to do with the
 * clipper. A cubic is affine-invariant, so putting its four control points
 * through the transform gives exactly the curve on the screen: no flattening,
 * no tolerance, nothing lost.
 */
export function worldOutline(node: AnyNode): ContourGeometry | null {
  const local =
    node.type === 'shape'
      ? shapeToPath(node)
      : node.type === 'path' && node.geometry.kind !== 'freehand'
        ? node.geometry
        : null;
  if (!local) return null;
  return mapPath(local, nodeToWorld(node));
}

/** Whether this node can take part in a boolean or be flattened. */
export function canVectorize(node: AnyNode | undefined): boolean {
  if (!node || node.locked) return false;
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
 * Why a combine cannot be done, in a sentence fit to show someone.
 *
 * Every one of these used to be the same thing: nothing happening. The button
 * ran, `applyBoolean` returned null, and the caller's `if (id)` quietly did
 * not fire — so intersecting two shapes that do not touch, and clicking with a
 * locked object in the selection, and asking the clipper something it could not
 * resolve all looked identical from the outside, which is to say broken.
 */
export type BooleanRefusal = string;

/**
 * What `op` would produce for this selection, without changing anything.
 *
 * Split out from `applyBoolean` so the same answer can drive three things: the
 * button's enabled state, the reason it gives when it is off, and the outline
 * drawn under the pointer while you consider it. Computing the result to decide
 * whether to offer the result is not wasteful — it is the only honest way to
 * know, and a handful of polygons is microseconds.
 */
export function previewBoolean(
  op: BooleanOp,
  ids: readonly string[]
): { geometry: CompoundGeometry; lead: AnyNode; nodes: AnyNode[] } | { refusal: BooleanRefusal } {
  const all = inZOrder(ids);
  const nodes = all.filter(canVectorize);

  if (nodes.length < 2) {
    const locked = all.some((n) => n.locked);
    if (locked) return { refusal: 'Unlock every object in the selection first.' };
    if (all.some((n) => n.type === 'path' && n.geometry.kind === 'freehand')) {
      return { refusal: 'A pencil stroke has no outline to combine — convert it to a path first.' };
    }
    return { refusal: 'Combining needs two or more shapes or paths.' };
  }

  /**
   * Which shape leads, per operation.
   *
   * For `subtract` it decides what survives, and the answer this had was
   * backwards: it kept the *front* object and cut the ones behind out of it,
   * while its own button said "subtract front from back" and while Illustrator,
   * Figma and every other tool remove the front shapes from the back one. The
   * bottom-most leads now, so the label and the behaviour and the rest of the
   * world finally agree.
   *
   * The others are order-independent, and take the topmost so the result wears
   * the paint you were looking at.
   */
  const ordered = op === 'subtract' ? [...nodes].reverse() : nodes;

  const operands = ordered.map(worldOutline).filter((g): g is BooleanOperand => g !== null);
  const combined = booleanPaths(op, operands);
  if (!combined) {
    return {
      refusal:
        op === 'intersect'
          ? 'These shapes do not overlap, so there is no intersection.'
          : op === 'subtract'
            ? 'Nothing would be left of the back shape.'
            : 'That combination comes out empty.',
    };
  }

  return { geometry: combined, lead: ordered[0], nodes: ordered };
}

export type BooleanPlan = ReturnType<typeof previewBoolean>;

/**
 * All four answers for one selection, memoised on the selection's own geometry.
 *
 * ## Why the cache is here and not a `useMemo`
 *
 * The toolbar re-renders whenever the pointer crosses one of its buttons, and
 * the block that draws the combines sits behind `if (isBulk)` — so a hook there
 * would be a conditional hook, and without one every hover would clip four sets
 * of polygons again. One entry is enough: there is one contextual rail, and it
 * asks about one selection at a time.
 *
 * Keyed on what actually changes the answer. Selection ids alone would miss a
 * shape being dragged out of the overlap; the whole node would never match,
 * because the store hands back a new object on every document change anywhere.
 */
let planned: { key: string; plans: Record<BooleanOp, BooleanPlan> } | null = null;

export function booleanPlans(ids: readonly string[]): Record<BooleanOp, BooleanPlan> {
  const objects = useStore.getState().objects;
  const key = ids
    .map((id) => {
      const n = objects[id];
      return n
        ? `${id}:${n.x},${n.y},${n.width},${n.height},${n.rotation},${n.scaleX},${n.scaleY},${n.zIndex},${n.locked}`
        : id;
    })
    .join('|');

  if (planned?.key === key) return planned.plans;

  const plans = Object.fromEntries(
    BOOLEAN_OPS.map((op) => [op, previewBoolean(op, ids)])
  ) as Record<BooleanOp, BooleanPlan>;
  planned = { key, plans };
  return plans;
}

/**
 * Combine two or more objects, replacing them with the result.
 *
 * Returns the new node's id, or the reason it declined. Nothing is deleted
 * unless a result was produced, so a boolean that cannot be computed costs the
 * user nothing.
 *
 * Z-order decides which shape leads, not selection order — that is whatever
 * sequence the clicks happened in, and "subtract" would then mean something
 * different depending on which of two objects you touched first.
 */
export function applyBoolean(op: BooleanOp, ids: readonly string[]): string | null {
  const plan = previewBoolean(op, ids);
  if ('refusal' in plan) return null;

  const framed = reframePath(plan.geometry);

  /**
   * One transaction, so it is one undo.
   *
   * `createNode` opens its own and `deleteNode` opens none, so a union of three
   * shapes was a create plus three deletes — four separate entries, and undoing
   * it took four presses, three of which showed a board with the operands half
   * restored underneath the result. This module's own header has claimed since
   * it was written that "a boolean is one undo step".
   */
  let id = '';
  doc.transact(() => {
    id = createNode({
      type: 'path',
      x: framed.dx,
      y: framed.dy,
      width: framed.width,
      height: framed.height,
      geometry: framed.geometry,
      appearance: resultAppearance(plan.lead),
      opacity: plan.lead.opacity ?? 1,
    });
    for (const node of plan.nodes) deleteNode(node.id);
  });
  return id || null;
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

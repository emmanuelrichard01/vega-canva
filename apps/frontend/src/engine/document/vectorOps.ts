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

import { nanoid } from 'nanoid';
import { applyGroupPlan, createNode, deleteNode, updateNode } from './mutations';
import { doc } from './doc';
import { useStore } from '../../hooks/useStore';
import { compareStacking } from '../model/stacking';
import { booleanPaths, type BooleanOp, type BooleanOperand } from '../model/pathBoolean';
import { mapPath, reframePath, type ContourGeometry } from '../model/pathGeometry';
import { shapeToPath } from '../model/shapeToPath';
import { outlineText } from '../text/textOutline';
import { outlineStroke } from '../model/strokeOutline';
import { reboxedPosition } from '../model/rebox';
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
 * They are applied, through `mapPath`, so a turned or scaled operand combines
 * as drawn. A cubic is affine-invariant, so putting its four control points
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
    .sort((a, b) => compareStacking(b, a));
}

/**
 * Why a combine cannot be done, in a sentence fit to show someone: shapes that
 * do not touch, a locked object in the selection, and a result the clipper
 * could not resolve each get their own, so none of them looks like a button
 * that did nothing.
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
      return { refusal: 'A pencil stroke has no outline to combine. Convert it to a path first.' };
    }
    return { refusal: 'Combining needs two or more shapes or paths.' };
  }

  /**
   * Which shape leads, per operation.
   *
   * For `subtract` it decides what survives: the bottom-most leads and the
   * front shapes are cut out of it, as the button says and as Illustrator and
   * Figma do. The others are order-independent and take the topmost, so the
   * result wears the paint you were looking at.
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
   * One transaction, so it is one undo: the create and every delete land
   * together, and undoing never shows the operands half restored under the
   * result.
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

  // `shapeToPath` honours each corner's own radius, so a rounded rectangle
  // comes back as four lines and four quarter-arcs rather than a sharp box.
  const geometry = shapeToPath(node);
  let newId = '';
  // One transaction, one undo: the path appears and the shape goes together.
  doc.transact(() => {
    newId = createNode({
      ...inheritedPlace(node),
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
    keepStacking(newId, node);
    deleteNode(id);
  });
  return newId || null;
}

/**
 * Where a replacement node lives: the replaced node's group and frame.
 *
 * A converted object that jumped out of its group, or to the top of the
 * stack, would be a conversion with a side effect nobody asked for.
 */
function inheritedPlace(node: AnyNode): { parentId?: string; frameId?: string } {
  const out: { parentId?: string; frameId?: string } = {};
  if (node.parentId) out.parentId = node.parentId;
  if (node.frameId) out.frameId = node.frameId;
  return out;
}

/** Put a replacement at the replaced node's depth rather than on top of everything. */
function keepStacking(newId: string, node: AnyNode): void {
  if (newId && typeof node.zIndex === 'number') updateNode(newId, { zIndex: node.zIndex });
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
 * A compound path per line, filled `nonzero` (the rule fonts are drawn with)
 * so the counter of an `o` is a hole and a variable font's overlapping
 * contours stay solid. A paragraph's lines are grouped. The
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
): Promise<{ id: string; ids: string[]; dropped: string[] } | null> {
  const node = useStore.getState().objects[id];
  if (!node || node.type !== 'text' || node.locked) return null;

  const outlined = await outlineText(node);
  if (!outlined) return null;

  // The document may have moved on while the font was in flight -- somebody
  // deleted the text, or a peer edited it. Re-read rather than trusting the
  // snapshot the outline was built from.
  const current = useStore.getState().objects[id];
  if (!current || current.type !== 'text' || current.locked) return null;

  /**
   * One path per line, grouped, for a paragraph; one path for a single line.
   *
   * A line is the unit people re-set: nudge the second line, recolour the
   * heading. One compound path for a whole paragraph makes every one of those
   * a direct-selection exercise across hundreds of anchors. Per-glyph paths
   * (Illustrator's raw result) go too far the other way: thirty objects for a
   * sentence, and a counter that is no longer part of its letter when moved.
   */
  const pieces = outlined.lines.length > 1 ? outlined.lines : [outlined.geometry];
  const appearance: Appearance = { fill: [{ type: 'solid', color: current.typography.color }] };

  const ids: string[] = [];
  doc.transact(() => {
    for (const geometry of pieces) {
      const framed = reframePath(geometry);
      // Where the glyphs sat inside the text's box, carried through the box's
      // own rotation and scale so the outline lands exactly on the words.
      const at = reboxedPosition(current, framed);
      const newId = createNode({
        ...inheritedPlace(current),
        type: 'path',
        x: at.x,
        y: at.y,
        width: framed.width,
        height: framed.height,
        geometry: framed.geometry,
        appearance,
        opacity: current.opacity ?? 1,
        rotation: current.rotation ?? 0,
        scaleX: current.scaleX ?? 1,
        scaleY: current.scaleY ?? 1,
      });
      if (!newId) continue;
      keepStacking(newId, current);
      ids.push(newId);
    }
    if (ids.length > 1) {
      const groupId = nanoid();
      const firstLine = current.text.split('\n').find((l) => l.trim())?.trim() ?? 'Text';
      applyGroupPlan({
        create: { id: groupId, parentId: current.parentId, name: firstLine.slice(0, 40) },
        nodes: ids.map((nid) => ({ id: nid, parentId: groupId })),
        groups: [],
        remove: [],
      });
    }
    if (ids.length > 0) deleteNode(id);
  });
  if (ids.length === 0) return null;
  return { id: ids[0], ids, dropped: outlined.dropped };
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
  if (!node || node.locked) return null;

  const appearance = ('appearance' in node ? node.appearance : undefined) as Appearance | undefined;
  const stroke = appearance?.stroke;
  if (!stroke || !(stroke.width > 0)) return null;

  const outline = node.type === 'shape' ? shapeToPath(node) : node.type === 'path' && node.geometry.kind !== 'freehand' ? node.geometry : null;
  if (!outline) return null;

  const region = outlineStroke(outline, stroke);
  if (!region) return null;

  const framed = reframePath(region);
  // The region is in the node's own space, so it takes the node's rotation
  // and scale too, positioned so it lands exactly over the stroke it replaces.
  const at = reboxedPosition(node, framed);
  let outlineId = '';
  // One transaction, one undo step.
  doc.transact(() => {
    outlineId = createNode({
      ...inheritedPlace(node),
      type: 'path',
      x: at.x,
      y: at.y,
      width: framed.width,
      height: framed.height,
      geometry: framed.geometry,
      // The stroke's colour becomes the new shape's fill, which is the whole
      // conversion: the paint that was describing a line is now describing a
      // region. Carried as a solid rather than the stroke's own field, because
      // a fill is a `Paint` list and a stroke colour is a string.
      appearance: { fill: [{ type: 'solid', color: stroke.color }] },
      opacity: node.opacity ?? 1,
      rotation: node.rotation ?? 0,
      scaleX: node.scaleX ?? 1,
      scaleY: node.scaleY ?? 1,
    });

    const hasFill = Boolean(appearance?.fill?.length);
    if (hasFill) {
      updateNode(id, { appearance: { ...appearance, stroke: undefined } });
    } else {
      keepStacking(outlineId, node);
      deleteNode(id);
    }
  });
  return outlineId || null;
}

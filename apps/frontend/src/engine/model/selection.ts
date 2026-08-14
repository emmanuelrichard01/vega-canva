import type { AnyNode } from './schema';

/**
 * Reading one set of controls across several objects at once.
 *
 * The Properties panel was built for exactly one node: `Room` collapsed the
 * selection to `selectedIds.length === 1 ? selectedIds[0] : null`, so selecting
 * three objects showed "Select an object" — the panel had nothing to say about
 * the most ordinary thing a person does on a canvas.
 *
 * Making it say something means answering two questions the single-node panel
 * never had to ask:
 *
 * 1. **What does a field show when the objects disagree?** Not the first one's
 *    value — that is a lie that becomes true the moment anything else is
 *    edited, because the control writes what it displays. It shows *Mixed*,
 *    and writes to every selected object only when someone actually sets it.
 * 2. **Which controls are offered at all?** The intersection of what the
 *    selected types support. A stroke control over a selection containing a
 *    voice note is a control that cannot work on part of what is selected,
 *    which is the same defect as one the renderer ignores.
 *
 * Everything here is pure and takes plain nodes, so it runs in Node with no
 * canvas — the same reason `smartGuides`, `pathGeometry` and `imageCrop` are
 * shaped this way.
 */

/** A value read across a selection, and whether the selection agrees on it. */
export interface Shared<T> {
  /**
   * The common value, or the **primary** node's value when they differ.
   *
   * A control that is `mixed` must not display this — it is carried so that a
   * stepper still has a number to bound its arrows against, and so that a
   * control which does choose to show something has a defensible thing to
   * show. Displaying it as though it were the selection's value is the bug
   * this whole type exists to prevent.
   */
  value: T;
  /** True when at least two nodes disagree. */
  mixed: boolean;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Structural equality, deep enough for what a node field actually holds.
 *
 * `Object.is` is wrong here and quietly so: `appearance.fill`, `shadow` and
 * `stroke` are freshly built objects on every normalize, so two nodes that
 * agree on a black 2px stroke hold two different object identities and every
 * one of those controls would read as *Mixed* forever.
 *
 * Deliberately not a general deep-equal: node values are JSON — numbers,
 * strings, booleans, null, arrays and plain objects — because they have to
 * survive a round trip through a `Y.Map`. Anything else cannot be in the
 * document, so there is nothing else to handle.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  // NaN is handled by Object.is; this is the null-vs-object guard, since
  // `typeof null === 'object'` and would otherwise reach the key walk below.
  if (a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;

  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => sameValue(item, b[i]));
  }

  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  // Key *order* must not matter: these objects are rebuilt by the normalizer
  // and by every `{ ...current, ...patch }` in the panel, so two equal values
  // routinely carry their keys in different orders.
  return aKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(b, key) &&
      sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
  );
}

/**
 * Read one field across the selection.
 *
 * The primary node is the first in the list. Callers pass the selection in the
 * order it was made, so "the primary" is the one whose value a control falls
 * back to — which matches every other tool, where the first-selected object
 * leads.
 */
export function sharedValue<T>(nodes: readonly AnyNode[], read: (node: AnyNode) => T): Shared<T> {
  if (nodes.length === 0) return { value: undefined as T, mixed: false };
  const first = read(nodes[0]);
  for (let i = 1; i < nodes.length; i += 1) {
    if (!sameValue(read(nodes[i]), first)) return { value: first, mixed: true };
  }
  return { value: first, mixed: false };
}

/**
 * The capabilities every selected type supports.
 *
 * An intersection, not a union. Offering "Stroke" because *one* of four
 * selected objects has a stroke gives a control that silently does nothing to
 * the other three — and since the write fans out to the whole selection, it
 * would also be a control whose effect depends on what happens to be selected
 * beside the thing you are looking at.
 *
 * An absent flag and `false` mean the same thing, so a missing key is not
 * inherited from whichever type happened to be first.
 */
export function intersectCapabilities<T extends object>(perType: readonly T[]): Record<string, boolean> {
  if (perType.length === 0) return {};
  const out: Record<string, boolean> = {};
  // Generic over the declaration interface rather than taking a
  // `Record<string, boolean>`: `ObjectCapabilities` is a closed interface of
  // optional flags, so it has no index signature and would not satisfy one —
  // and widening the interface to gain it would let any misspelled capability
  // through at the registration site, which is exactly where they must be
  // caught.
  //
  // Keys come from the union rather than from the first type, because an
  // absent flag has to be *read* as unsupported: a voice note simply has no
  // `supportsStroke` key, and walking only the first type's keys would drop
  // the question instead of answering it false.
  const keys = new Set<string>();
  perType.forEach((caps) => Object.keys(caps).forEach((key) => keys.add(key)));
  keys.forEach((key) => {
    out[key] = perType.every((caps) => (caps as Record<string, boolean | undefined>)[key] === true);
  });
  return out;
}

/**
 * The axis-aligned box enclosing every node's *drawn* extent.
 *
 * Rotation is accounted for by taking the four corners through the node's own
 * rotation about its centre — which is where `ObjectRenderer` puts the origin
 * — rather than by using the unrotated box. A 45°-rotated square's selection
 * box is visibly larger than the square, and a panel that disagreed with the
 * transformer drawn around the same objects would be reporting a rectangle
 * nobody can see.
 *
 * Returns `null` for an empty selection rather than a zero box, so callers
 * have to handle "nothing selected" instead of silently laying out a control
 * around 0×0.
 */
export function nodeBounds(node: AnyNode): Box {
  const w = node.width * Math.abs(node.scaleX || 1);
  const h = node.height * Math.abs(node.scaleY || 1);
  const rotation = node.rotation || 0;

  if (rotation === 0) return { x: node.x, y: node.y, width: w, height: h };

  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = node.x + w / 2;
  const cy = node.y + h / 2;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [dx, dy] of [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ]) {
    const px = cx + dx * cos - dy * sin;
    const py = cy + dx * sin + dy * cos;
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px);
    maxY = Math.max(maxY, py);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function selectionBounds(nodes: readonly AnyNode[]): Box | null {
  if (nodes.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  nodes.forEach((node) => {
    const box = nodeBounds(node);
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  });

  return { x: minX, y: minY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
}

/** A patch to one node, as `updateNodes` takes them. */
export interface NodePatch {
  id: string;
  changes: Record<string, unknown>;
}

/**
 * Move the whole selection so its bounding box starts at a given coordinate.
 *
 * Every node shifts by the same delta, which is exact whatever any of them is
 * rotated or scaled to — a translation commutes with every other transform, so
 * there is no approximation here and no reason to restrict it.
 */
export function translateSelection(
  nodes: readonly AnyNode[],
  bounds: Box,
  axis: 'x' | 'y',
  value: number
): NodePatch[] {
  const delta = value - bounds[axis];
  if (delta === 0) return [];
  return nodes.map((node) => ({ id: node.id, changes: { [axis]: node[axis] + delta } }));
}

/**
 * Whether the selection can be resized as a box at all.
 *
 * Scaling a bounding box means scaling each member's position *and* size about
 * the box's origin. For an unrotated node that is exact. For a rotated one
 * under a **non-uniform** scale it is not representable at all: the result of
 * squashing a rotated rectangle horizontally is a parallelogram, and a node
 * stores a width, a height and an angle with nowhere to put the shear.
 *
 * So the W/H fields decline on a rotated selection rather than writing a box
 * that does not match what the scale actually produced. This is the same call
 * the booleans make on a rotated operand, for the same reason — a control that
 * quietly ignores the rotation is worse than one that is visibly unavailable.
 */
export function canResizeAsBox(nodes: readonly AnyNode[]): boolean {
  return nodes.every((node) => (node.rotation || 0) === 0);
}

/**
 * Resize the selection's bounding box along one axis, scaling its members.
 *
 * Positions scale about the box's own origin so the selection keeps its
 * internal spacing — moving the far edge, not every object independently.
 * Callers must check `canResizeAsBox` first; this asserts nothing, because the
 * panel decides whether to offer the control at all.
 */
export function scaleSelection(
  nodes: readonly AnyNode[],
  bounds: Box,
  axis: 'width' | 'height',
  value: number
): NodePatch[] {
  const current = bounds[axis];
  const next = Math.max(1, value);
  if (current <= 0 || next === current) return [];

  const factor = next / current;
  const origin = axis === 'width' ? bounds.x : bounds.y;
  const posKey = axis === 'width' ? 'x' : 'y';

  return nodes.map((node) => ({
    id: node.id,
    changes: {
      [posKey]: origin + (node[posKey] - origin) * factor,
      // Clamped for the same reason the single-node steppers clamp: a zero
      // width is an object that exists, is selected, and cannot be seen or
      // grabbed back.
      [axis]: Math.max(1, node[axis] * factor),
    },
  }));
}

/**
 * How to name the selection in the panel header.
 *
 * One type gets that type's name; a mix gets the neutral word, because
 * "Shape" over a selection holding an image and a sticky is simply wrong and
 * "Shape, Image, Sticky" grows without bound.
 */
export function selectionLabel(nodes: readonly AnyNode[]): string {
  if (nodes.length === 0) return 'Nothing selected';
  if (nodes.length === 1) return nodes[0].type;
  const type = sharedValue(nodes, (node) => node.type);
  return type.mixed ? `${nodes.length} objects` : `${nodes.length} ${type.value}s`;
}

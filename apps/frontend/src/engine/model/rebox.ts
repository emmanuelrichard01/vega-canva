/**
 * Changing a node's box without moving what it draws.
 *
 * Every vector edit ends with the geometry re-origined (`reframePath`): the
 * box shrinks or grows to fit the new outline and the node moves by the
 * offset. For an unturned node that move is a plain `x + dx`. For a turned,
 * scaled or skewed one it is not, because the canvas turns a node about the
 * *centre of its box* (see `ObjectRenderer`), and a box with a new size has a
 * new centre: adding `dx` would swing the whole drawing about the old one.
 *
 * This solves for the position that keeps every point of the drawing where it
 * was on screen. With the node transform `A` (rotate · skew · scale, Konva's
 * order) and the old box `(x, y, W, H)`, a local point `p` lands at
 * `C + A(p − W/2, H/2)`. Re-boxing to `(dx, dy, w, h)` inside the old local
 * space means `p` becomes `p − (dx, dy)` and the new centre must be
 * `C + A(dx + w/2 − W/2, dy + h/2 − H/2)`.
 */

export interface Boxed {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  /** Degrees, as stored. */
  skewX?: number;
  skewY?: number;
}

/** The node's linear transform as `[a, b, c, d]` (`x' = a·x + c·y`, `y' = b·x + d·y`). */
export function linearOf(node: Boxed): [number, number, number, number] {
  const rad = ((node.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const kx = node.skewX ? Math.tan((node.skewX * Math.PI) / 180) : 0;
  const ky = node.skewY ? Math.tan((node.skewY * Math.PI) / 180) : 0;
  const sx = node.scaleX ?? 1;
  const sy = node.scaleY ?? 1;
  // R · K · S, with K = [[1, kx], [ky, 1]] as Konva composes it.
  const r0 = cos;
  const r1 = sin;
  const r2 = -sin;
  const r3 = cos;
  const k0 = r0 + r2 * ky;
  const k1 = r1 + r3 * ky;
  const k2 = r0 * kx + r2;
  const k3 = r1 * kx + r3;
  return [k0 * sx, k1 * sx, k2 * sy, k3 * sy];
}

/** Where the node's box has to go so a re-origined drawing stays put. */
export function reboxedPosition(
  node: Boxed,
  inner: { dx: number; dy: number; width: number; height: number }
): { x: number; y: number } {
  const plain =
    !node.rotation && (node.scaleX ?? 1) === 1 && (node.scaleY ?? 1) === 1 && !node.skewX && !node.skewY;
  if (plain) return { x: node.x + inner.dx, y: node.y + inner.dy };
  const [a, b, c, d] = linearOf(node);
  const ox = inner.dx + inner.width / 2 - node.width / 2;
  const oy = inner.dy + inner.height / 2 - node.height / 2;
  const cx = node.x + node.width / 2 + a * ox + c * oy;
  const cy = node.y + node.height / 2 + b * ox + d * oy;
  return { x: cx - inner.width / 2, y: cy - inner.height / 2 };
}

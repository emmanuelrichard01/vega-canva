import type { AnyNode, CommentNode } from '../model/schema';
import { contrastInk } from '../model/color';

/**
 * Comment pins in an export, when someone asks for them.
 *
 * On the board a pin is DOM furniture over the canvas, so neither the stage
 * capture nor the document walk sees it. An export "with comments" draws each
 * thread as its pin: a bubble whose tail (bottom-left) is the anchored spot,
 * the author's initial in their colour, and the first words of the thread, so
 * a reviewed board says what was said and where. One layout, drawn by both
 * the SVG writer and the raster path.
 */

export interface CommentPin {
  /** Bubble box in world units; the tail is its bottom-left corner. */
  x: number;
  y: number;
  width: number;
  height: number;
  initial: string;
  words: string;
  colour: string;
  initialInk: string;
  resolved: boolean;
}

/** Characters of the thread shown beside its pin. */
const SNIPPET = 56;
const HEIGHT = 28;
/** Average advance of the 11.5px label, for sizing the bubble without a measure. */
const ADVANCE = 6.4;

export function commentPin(node: CommentNode): CommentPin {
  const name = node.author?.name?.trim() || 'Someone';
  const first = (node.text ?? '').trim().replace(/\s+/g, ' ');
  const snippet = first.length > SNIPPET ? `${first.slice(0, SNIPPET - 1)}…` : first;
  const words = snippet ? `${name}: ${snippet}` : name;
  const colour = node.author?.color || '#6366F1';
  return {
    x: node.x,
    y: node.y - HEIGHT,
    width: 34 + Math.min(360, words.length * ADVANCE) + 10,
    height: HEIGHT,
    initial: name.slice(0, 1).toUpperCase(),
    words,
    colour,
    initialInk: contrastInk(colour),
    resolved: Boolean(node.resolved),
  };
}

/**
 * The visible comments anchored inside a world rectangle. By place rather
 * than by selection, since nobody selects a comment to export it: a frame's
 * export carries the threads pinned on that frame.
 */
export function commentsWithin(
  nodes: readonly AnyNode[],
  box: { x: number; y: number; width: number; height: number }
): CommentNode[] {
  return nodes.filter(
    (n): n is CommentNode =>
      n.type === 'comment' && !n.hidden && n.x >= box.x && n.x <= box.x + box.width && n.y >= box.y && n.y <= box.y + box.height
  );
}

/** The bubble outline: round on three corners, tight at the tail. */
export function pinOutline(pin: CommentPin): string {
  const { x, y, width: w, height: h } = pin;
  const r = h / 2;
  const t = 3;
  const n = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '0');
  return (
    `M${n(x + r)} ${n(y)}H${n(x + w - r)}A${r} ${r} 0 0 1 ${n(x + w)} ${n(y + r)}` +
    `A${r} ${r} 0 0 1 ${n(x + w - r)} ${n(y + h)}H${n(x + t)}A${t} ${t} 0 0 1 ${n(x)} ${n(y + h - t)}` +
    `V${n(y + r)}A${r} ${r} 0 0 1 ${n(x + r)} ${n(y)}Z`
  );
}

/**
 * Draw pins onto a captured canvas. `originX/Y` is the world point at the
 * canvas's top-left and `scale` its pixels per world unit.
 */
export function drawCommentPins(
  ctx: CanvasRenderingContext2D,
  pins: readonly CommentPin[],
  originX: number,
  originY: number,
  scale: number
): void {
  if (pins.length === 0) return;
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, -originX * scale, -originY * scale);
  for (const pin of pins) {
    ctx.globalAlpha = pin.resolved ? 0.55 : 1;
    const shape = new Path2D(pinOutline(pin));
    ctx.fillStyle = '#FFFFFF';
    ctx.fill(shape);
    ctx.strokeStyle = 'rgba(15,23,42,0.16)';
    ctx.lineWidth = 1;
    ctx.stroke(shape);
    ctx.beginPath();
    ctx.arc(pin.x + 14, pin.y + pin.height / 2, 11, 0, Math.PI * 2);
    ctx.fillStyle = pin.colour;
    ctx.fill();
    ctx.textBaseline = 'middle';
    ctx.font = '600 11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = pin.initialInk;
    ctx.fillText(pin.initial, pin.x + 14, pin.y + pin.height / 2);
    ctx.font = '500 11.5px Inter, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#18181B';
    ctx.fillText(pin.words, pin.x + 32, pin.y + pin.height / 2, pin.width - 40);
  }
  ctx.restore();
}

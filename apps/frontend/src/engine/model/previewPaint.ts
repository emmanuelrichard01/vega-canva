import type { AnyNode } from './schema';
import { paintColor } from './paint';
import { connectorPoints } from './connector';
import { THEMES } from '../../components/canvas/renderers/StickyRenderer';

/**
 * What colour a node is, in a thumbnail.
 *
 * ## Why this is shared rather than inlined
 *
 * `buildPreview` is deliberately pure and takes its colours as an argument,
 * because a sticky's colour lives in a theme table owned by a renderer and
 * importing that would drag a React component into a module meant to run
 * anywhere. That is the right shape — but it means every *caller* has to
 * supply the resolver, and there are two now: the room writing its own cover
 * as you work, and the template gallery drawing a board that does not exist
 * yet.
 *
 * Two copies of "what colour is this node" is how a template's thumbnail comes
 * to disagree with the board it produces. One implementation, imported twice.
 */
export function previewColorOf(node: AnyNode): string {
  if (node.type === 'sticky') return THEMES[node.theme]?.bg ?? '#FDE047';

  /**
   * A frame with no fill of its own is white paper.
   *
   * `FrameRenderer` passes `'#FFFFFF'` as its fallback; this fell through to
   * the generic slate below, so a frame drew as a mid-grey block on the card
   * and as white paper on the board. Same fallback in both places now — the
   * disagreement is the bug, not either value.
   */
  if (node.type === 'frame') {
    const paint = (node as { appearance?: { fill?: unknown[] } }).appearance?.fill?.[0];
    return paint ? paintColor(paint as never, '#FFFFFF') : '#FFFFFF';
  }

  const paint = (node as { appearance?: { fill?: unknown[]; stroke?: { color?: string } } }).appearance;
  const fill = paint?.fill?.[0];
  if (fill) return paintColor(fill as never, '#94A3B8');
  if (paint?.stroke?.color) return paint.stroke.color;
  if (node.type === 'text') return (node as { typography?: { color?: string } }).typography?.color ?? '#94A3B8';
  return '#94A3B8';
}

/**
 * The route a connector draws, for the thumbnail to stroke as a line.
 *
 * Without it a connector is painted as a filled rectangle spanning the
 * diagonal between the two objects it joins — its bounding box is honest, but
 * it was never the shape.
 */
export function previewPointsOf(
  node: AnyNode,
  objects: Record<string, AnyNode>
): number[] | null {
  if (node.type !== 'connector') return null;
  return connectorPoints(node.from, node.to, node.routing, (id) => {
    const other = objects[id];
    if (!other) return null;
    return {
      x: other.x,
      y: other.y,
      width: other.width * Math.abs(other.scaleX || 1),
      height: other.height * Math.abs(other.scaleY || 1),
    };
  });
}

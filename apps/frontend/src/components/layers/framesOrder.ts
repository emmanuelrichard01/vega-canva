import { presentableFrames, presentationOrder } from '../../engine/model/frames';
import type { AnyNode, FrameNode } from '../../engine/model/schema';

/**
 * The board's frames in the order the presenter plays them: the slides
 * (top-level frames) by `slideOrder` where it is set and reading order where
 * not, then frames nested inside another frame in reading order. Layers, the
 * Alt+arrow stepping and the presenter strip all agree on it.
 */
export function framesInReadingOrder(nodes: readonly AnyNode[]): AnyNode[] {
  const frames = nodes.filter((n) => n.type === 'frame' && !n.hidden);
  const slides = presentationOrder(presentableFrames(frames) as FrameNode[]);
  const nested = presentationOrder(frames.filter((f) => f.frameId) as FrameNode[]);
  return [...slides, ...nested];
}

/** The next frame from `currentId` in reading order, wrapping at both ends. */
export function stepFrame(order: readonly AnyNode[], currentId: string | null, dir: 1 | -1): AnyNode | null {
  if (order.length === 0) return null;
  const i = currentId ? order.findIndex((f) => f.id === currentId) : -1;
  if (i < 0) return dir > 0 ? order[0] : order[order.length - 1];
  return order[(i + dir + order.length) % order.length];
}

/** The camera pose that fits `box` in a viewport with a margin, as `navigateViewport` takes it. */
export function fitPose(
  box: { x: number; y: number; width: number; height: number },
  view: { width: number; height: number },
  limits: { minZoom: number; maxZoom: number },
  margin = 0.12
): { x: number; y: number; zoom: number } {
  const w = Math.max(1, box.width);
  const h = Math.max(1, box.height);
  const scale = 1 - margin * 2;
  const zoom = Math.min((view.width * scale) / w, (view.height * scale) / h);
  return {
    x: box.x + w / 2,
    y: box.y + h / 2,
    zoom: Math.min(limits.maxZoom, Math.max(limits.minZoom, zoom)),
  };
}

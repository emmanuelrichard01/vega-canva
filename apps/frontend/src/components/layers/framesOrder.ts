import type { AnyNode } from '../../engine/model/schema';

/**
 * The board's frames in reading order: top to bottom, and left to right
 * within a row. Two frames are in the same row when their vertical extents
 * overlap by at least half the shorter one, so a slightly offset row of
 * slides still reads left to right.
 */
export function framesInReadingOrder(nodes: readonly AnyNode[]): AnyNode[] {
  const frames = nodes.filter((n) => n.type === 'frame' && !n.hidden);
  const byTop = [...frames].sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1));
  const rows: AnyNode[][] = [];
  for (const frame of byTop) {
    const row = rows.find((r) => {
      const ref = r[0];
      const overlap = Math.min(ref.y + ref.height, frame.y + frame.height) - Math.max(ref.y, frame.y);
      return overlap >= Math.min(ref.height, frame.height) / 2;
    });
    if (row) row.push(frame);
    else rows.push([frame]);
  }
  return rows.flatMap((r) => r.sort((a, b) => a.x - b.x || (a.id < b.id ? -1 : 1)));
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

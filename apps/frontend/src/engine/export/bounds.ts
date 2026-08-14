import { useStore } from '../../hooks/useStore';
import type { AnyNode } from '../model/schema';

export interface ExportBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Padding around the content in an export, in world units. */
export const EXPORT_PADDING = 40;

/**
 * World-space bounding box of the document (or of a subset of it).
 *
 * Shared by every exporter so PNG, SVG and JSON agree on what "the document"
 * means. The SVG exporter grew its own copy of this first; PNG had none at
 * all and simply captured whatever happened to be on screen.
 */
/**
 * The export box for a frame: its own rectangle, exactly, with no padding.
 *
 * Deliberately *not* `computeContentBounds` over the frame's contents. A frame
 * declares a size — 1080×1080, A4 — and that size is the whole reason it
 * exists, so exporting it must produce those pixels. Measuring its contents
 * instead would silently crop to whatever happens to be inside and add the
 * 40-unit padding on top, so a "1080×1080" frame would export at some other
 * size every time its contents changed.
 *
 * Anything hanging over the edge is cut off, which is correct: that is what
 * the frame's own clipping already shows on the canvas.
 */
export function frameExportBounds(frame: {
  x: number;
  y: number;
  width: number;
  height: number;
}): ExportBounds {
  return {
    x: frame.x,
    y: frame.y,
    width: Math.max(1, frame.width),
    height: Math.max(1, frame.height),
  };
}

export function computeContentBounds(
  objects?: Record<string, AnyNode>,
  ids?: string[],
  /** Overrides `EXPORT_PADDING`. Zero is a legitimate value, hence `??`. */
  padding?: number
): ExportBounds {
  const pad = padding ?? EXPORT_PADDING;
  const all = objects ?? useStore.getState().objects;
  const list = ids ? ids.map((id) => all[id]).filter(Boolean) : Object.values(all);

  if (list.length === 0) return { x: 0, y: 0, width: 800, height: 600 };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  list.forEach((node) => {
    // Hidden objects are not part of the exported document.
    if (node.hidden) return;
    const sx = Math.abs(node.scaleX || 1);
    const sy = Math.abs(node.scaleY || 1);
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width * sx);
    maxY = Math.max(maxY, node.y + node.height * sy);
  });

  if (minX === Infinity) return { x: 0, y: 0, width: 800, height: 600 };

  return {
    x: minX - pad,
    y: minY - pad,
    width: Math.max(1, maxX - minX + pad * 2),
    height: Math.max(1, maxY - minY + pad * 2),
  };
}

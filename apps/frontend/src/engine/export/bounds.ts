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
export function computeContentBounds(objects?: Record<string, AnyNode>, ids?: string[]): ExportBounds {
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
    x: minX - EXPORT_PADDING,
    y: minY - EXPORT_PADDING,
    width: Math.max(1, maxX - minX + EXPORT_PADDING * 2),
    height: Math.max(1, maxY - minY + EXPORT_PADDING * 2),
  };
}

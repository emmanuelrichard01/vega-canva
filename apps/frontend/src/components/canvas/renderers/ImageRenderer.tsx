import React, { useEffect, useMemo, useRef } from 'react';
import Konva from 'konva';
import { Image as KonvaImage, Rect } from 'react-konva';
import useImage from 'use-image';
import type { ImageNode } from '../../../engine/model/schema';
import {
  activeFilterIds,
  hasAdjustments,
  readAdjustments,
  toKonvaValues,
  type AdjustmentId,
} from '../../../engine/model/imageAdjustments';

interface Props {
  node: ImageNode;
}

/** Document adjustment -> the Konva filter that applies it. */
const KONVA_FILTER: Record<AdjustmentId, typeof Konva.Filters.Blur> = {
  brightness: Konva.Filters.Brighten,
  contrast: Konva.Filters.Contrast,
  saturation: Konva.Filters.HSL,
  blur: Konva.Filters.Blur,
};

export const ImageRenderer: React.FC<Props> = React.memo(({ node }) => {
  const [image, status] = useImage(node.src, 'anonymous');
  const shapeRef = useRef<Konva.Image>(null);

  const adjustments = readAdjustments(node.filters);
  const adjusted = hasAdjustments(adjustments);
  const konva = toKonvaValues(adjustments);

  // Rebuilt only when the *set* of active adjustments changes, not on every
  // slider tick — reassigning the array makes Konva re-evaluate its filter
  // pipeline, and dragging a slider would rebuild it sixty times a second.
  const activeIds = activeFilterIds(adjustments);
  const filterKey = activeIds.join(',');
  const filters = useMemo(
    () => (filterKey ? filterKey.split(',').map((id) => KONVA_FILTER[id as AdjustmentId]) : undefined),
    [filterKey]
  );

  /**
   * Konva filters only run on a **cached** node, and the cache is a raster
   * snapshot — so it has to be rebuilt whenever anything that feeds it
   * changes, and torn down the moment it is not needed.
   *
   * Three things this has to get right:
   *
   * - **An untouched image is never cached.** Caching rasterizes at the node's
   *   current size, which costs memory for every image on the board and goes
   *   visibly soft once the canvas is zoomed past that resolution. Paying that
   *   for an image nobody has adjusted would be a tax on the common case.
   * - **`pixelRatio` follows the device**, or a filtered image is noticeably
   *   softer than an unfiltered one on any HiDPI screen — the difference shows
   *   up as "applying a filter blurs my image slightly", which reads as a bug
   *   in the filter rather than in the cache.
   * - **The dependency list includes the node's size.** A cache taken at one
   *   size and drawn at another is stretched, so resizing an adjusted image
   *   would smear it until something else happened to invalidate the cache.
   */
  useEffect(() => {
    const shape = shapeRef.current;
    if (!shape) return;

    if (!image || status !== 'loaded' || !adjusted) {
      // `isCached()` guards a Konva call that is not free, and this effect runs
      // on every adjustment change for every image on the board.
      if (shape.isCached()) {
        shape.clearCache();
        shape.getLayer()?.batchDraw();
      }
      return;
    }

    shape.cache({ pixelRatio: window.devicePixelRatio || 1 });
    shape.getLayer()?.batchDraw();
  }, [
    image,
    status,
    adjusted,
    filterKey,
    node.width,
    node.height,
    konva.brightness,
    konva.contrast,
    konva.saturation,
    konva.blurRadius,
  ]);

  // A broken or still-loading asset previously rendered nothing at all, which
  // is indistinguishable from the object having been deleted. A placeholder
  // keeps the object selectable and its bounds visible.
  if (status !== 'loaded' || !image) {
    return (
      <Rect
        width={node.width}
        height={node.height}
        fill="var(--surface-secondary)"
        stroke={status === 'failed' ? '#EF4444' : '#D1D5DB'}
        strokeWidth={1}
        dash={[6, 4]}
        cornerRadius={node.appearance?.cornerRadius ?? 0}
      />
    );
  }

  return (
    <KonvaImage
      ref={shapeRef}
      image={image}
      width={node.width}
      height={node.height}
      // Konva clips natively to the corner radius; nothing read this before,
      // so rounding an image's corners had no visible effect.
      cornerRadius={node.appearance?.cornerRadius ?? 0}
      filters={filters}
      brightness={konva.brightness}
      contrast={konva.contrast}
      saturation={konva.saturation}
      blurRadius={konva.blurRadius}
    />
  );
});

ImageRenderer.displayName = 'ImageRenderer';

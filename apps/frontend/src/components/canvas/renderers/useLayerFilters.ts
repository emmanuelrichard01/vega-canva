import { useEffect } from 'react';
import Konva from 'konva';
import type React from 'react';
import { cameraSystem } from '../../../engine/CameraSystem';

/**
 * Layer blur, and the cache it requires.
 *
 * Konva filters read pixels, and a node only has pixels once it has been
 * drawn to its own bitmap — so a filtered node must be cached, and a cached
 * node keeps painting its old bitmap until something invalidates it. Every
 * failure mode of this feature is a cache that was taken at the wrong moment:
 * blur a shape and resize it and you see the old size, blurred; change its
 * colour and you see the old colour.
 *
 * The three rules, all of which cost something to get wrong:
 *
 * 1. **Never cache an unblurred node.** A cache on every object on the board
 *    is a bitmap per object, and the blur is the only reason to pay for one.
 *    An unblurred node has its cache cleared instead.
 * 2. **The cache has to be bigger than the node.** A blur spreads pixels
 *    outward; a cache taken at the node's exact bounds clips that spread flat
 *    against the edge, which reads as a rectangular halo rather than a blur.
 *    Three sigma is where a Gaussian has nothing left worth drawing.
 * 3. **`pixelRatio` follows the display.** The default of 1 caches at CSS
 *    pixels, so every blurred object on a retina screen is visibly softer than
 *    its neighbours — for the wrong reason.
 * 4. **Level of Detail (LOD) Downsampling**: When zoomed far out (zoom < 0.15),
 *    Gaussian blurs are visually indistinguishable on screen. Bypassing bitmap
 *    caching at extreme overviews saves substantial GPU texture memory.
 *
 * The caller supplies `deps` describing everything the bitmap depends on. It
 * cannot be derived here: this hook holds a ref to a Konva node, not the
 * document, and cannot see that a fill changed.
 */
export function useLayerFilters(
  ref: React.RefObject<Konva.Node | null>,
  blur: number | undefined,
  deps: unknown[]
): void {
  const radius = blur && blur > 0 ? blur : 0;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // LOD: when zoomed far out (< 15%), bypass blur filter caching
    const isFarZoom = cameraSystem.zoom < 0.15;

    if (radius <= 0 || isFarZoom) {
      // `filters([])` and not just clearing the cache: a node left holding a
      // filter list with no cache renders unfiltered but pays the check on
      // every draw, and re-caching it later for some other reason would
      // silently bring the blur back.
      if (node.isCached()) node.clearCache();
      node.filters([]);
      node.getLayer()?.batchDraw();
      return;
    }

    const pad = Math.ceil(radius * 3);
    node.filters([Konva.Filters.Blur]);
    node.blurRadius(radius);
    node.cache({
      pixelRatio: typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
      offset: pad,
      // Konva otherwise outlines the cached region while caching, which lands
      // in the bitmap and stays there.
      drawBorder: false,
    });
    node.getLayer()?.batchDraw();

    // Intentionally driven by the caller's dependency list: this hook cannot
    // see what the node is made of.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radius, ...deps]);

  // A cached node left behind on unmount would hold its bitmap until the
  // node is collected; Konva's own destroy handles that, but a node that is
  // merely re-parented would not be destroyed at all.
  useEffect(() => {
    const node = ref.current;
    return () => {
      if (node?.isCached()) node.clearCache();
    };
  }, [ref]);
}

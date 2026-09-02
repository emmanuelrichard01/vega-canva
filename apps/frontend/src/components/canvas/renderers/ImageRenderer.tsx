import React, { useEffect, useMemo, useRef } from 'react';
import Konva from 'konva';
import { Group, Image as KonvaImage, Rect, Text } from 'react-konva';
import useImage from 'use-image';
import type { ImageNode } from '../../../engine/model/schema';
import { updateNode } from '../../../engine/document';
import { isCropped, readCrop } from '../../../engine/model/imageCrop';
import {
  activeFilterIds,
  hasAdjustments,
  readAdjustments,
  toKonvaValues,
  type AdjustmentId,
} from '../../../engine/model/imageAdjustments';
import { shadowProps } from './shared';
import { useResolvedSrc } from '../../../utils/pendingMedia';

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
  /**
   * Load with CORS, and fall back to loading without it.
   *
   * ## Why `anonymous` is asked for first
   *
   * Reading pixels back off a canvas that has drawn a cross-origin image
   * throws — the canvas is "tainted". This renderer does exactly that, twice:
   * the adjustment filters need `getImageData`, and every raster export calls
   * `toCanvas`. Requesting the image anonymously, with the server's consent,
   * is what keeps both working.
   *
   * ## Why it cannot be the only attempt
   *
   * `crossOrigin = 'anonymous'` is not a hint. If the response carries no
   * `Access-Control-Allow-Origin` header the load **fails outright** — no
   * image, just the grey placeholder.
   *
   * That used to be the normal case, not the edge one: uploads were served
   * directly by the object store on its own port, where the `cors()`
   * middleware — which covers the Express app on a different port — never
   * ran. Nothing in the project made the bucket send that header, so the
   * anonymous attempt failed for every uploaded image and every board fell
   * through to the plain load, which taints the canvas and silently breaks
   * PNG export.
   *
   * New uploads are served through the API's own media route now, so they
   * carry the header and the first attempt succeeds. The fallback stays for
   * the two cases that remain: images pasted in from elsewhere on the web,
   * and boards written before the change whose `src` still points straight at
   * the object store.
   *
   * So: try anonymously, and if that fails try again plainly. A picture that
   * displays but cannot be exported is a far better outcome than a grey box,
   * and it is recoverable — the export path can say so, where a missing image
   * says nothing at all.
   */
  /**
   * A `local:<id>` src becomes an object URL here, or an empty string on a
   * device that does not hold the bytes. Ordinary URLs pass through untouched.
   * See `pendingMedia.ts`.
   */
  const { src: resolvedSrc, pendingUpload } = useResolvedSrc(node.src);

  const [corsImage, corsStatus] = useImage(resolvedSrc, 'anonymous');
  const needsPlainRetry = corsStatus === 'failed';
  // Skipped entirely unless the first attempt failed: passing a src here
  // unconditionally would fetch every image twice.
  const [plainImage, plainStatus] = useImage(needsPlainRetry ? resolvedSrc : '', undefined);

  const image = corsStatus === 'loaded' ? corsImage : plainImage;
  const status = corsStatus === 'loaded' ? corsStatus : needsPlainRetry ? plainStatus : corsStatus;
  const shapeRef = useRef<Konva.Image>(null);

  /**
   * Record the bitmap's own size, once, from the first client to load it.
   *
   * `naturalWidth`/`naturalHeight` were declared on the schema, read by the
   * normalizer, and written by **nothing** — so they were always undefined.
   * Cropping needs them: a crop is stored in natural pixels and has to be
   * clamped against the bitmap's real bounds, and there is nothing to clamp
   * against without this. Same fix as the voice note that showed `0:00 / 0:00`
   * while audibly playing, and the same rule: the document should learn a fact
   * about its own asset the first time anyone is in a position to know it.
   */
  useEffect(() => {
    if (status !== 'loaded' || !image) return;
    if (!image.naturalWidth || !image.naturalHeight) return;
    if (node.naturalWidth === image.naturalWidth && node.naturalHeight === image.naturalHeight) return;
    updateNode(node.id, {
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
    });
  }, [image, status, node.id, node.naturalWidth, node.naturalHeight]);

  const natural = {
    width: node.naturalWidth ?? image?.naturalWidth ?? 0,
    height: node.naturalHeight ?? image?.naturalHeight ?? 0,
  };
  const crop = readCrop(node.crop, natural);
  // Konva reads `crop` in source pixels. Omitted entirely when nothing is
  // cropped, so an uncropped image takes the plain `drawImage` path.
  const cropProp = isCropped(crop, natural) ? crop : undefined;

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
    // A cache taken before the crop moved is a snapshot of the old window, so
    // an adjusted image would keep showing the previous framing until
    // something else happened to invalidate it.
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    konva.brightness,
    konva.contrast,
    konva.saturation,
    konva.blurRadius,
  ]);

  /**
   * Three situations, not two.
   *
   * A broken or still-loading asset previously rendered nothing at all, which
   * is indistinguishable from the object having been deleted. A placeholder
   * fixed that, and then said the same thing about two states that could not
   * be more different:
   *
   * - **failed** -- this picture is not coming back.
   * - **waiting to upload** -- the bytes exist, on somebody's device, and the
   *   only thing missing is a network. Nothing is lost.
   *
   * Drawn identically, the second reads as the first, and the person's
   * reasonable conclusion is that their work was thrown away. It is the same
   * class of mistake as a silent upload failure, running the other way: a
   * success that looks like a loss. So a pending upload gets the accent
   * colour, a calmer dash and a word, rather than the grey-and-dashed shape
   * this application uses everywhere else to mean "empty".
   */
  if (status !== 'loaded' || !image) {
    const waiting = pendingUpload;
    const radius = node.appearance?.cornerRadius ?? 0;

    return (
      <Group>
        <Rect
          width={node.width}
          height={node.height}
          // A fixed colour, not `var(--surface-secondary)`: Konva paints to a
          // canvas and never resolves CSS custom properties, so that was an
          // invalid colour and the placeholder came out unfilled. Translucent
          // grey reads as an empty slot against both the light and dark board.
          fill={waiting ? 'rgba(243, 160, 36, 0.10)' : 'rgba(148, 163, 184, 0.18)'}
          stroke={waiting ? '#F3A024' : status === 'failed' ? '#EF4444' : '#D1D5DB'}
          strokeWidth={1}
          // A longer, more open dash than the "empty slot" pattern, so the two
          // are told apart at a glance and without reading the label.
          dash={waiting ? [10, 6] : [6, 4]}
          cornerRadius={radius}
        />
        {waiting && (
          <Text
            width={node.width}
            height={node.height}
            // Centred in the box rather than positioned, so it stays centred
            // through every resize without a second calculation to keep in
            // step with the rect above it.
            align="center"
            verticalAlign="middle"
            padding={8}
            text="Waiting to upload"
            fontSize={13}
            fontFamily="Inter, system-ui, sans-serif"
            fill="#B4770F"
            listening={false}
            // Below roughly two lines of type the words are noise rather than
            // information, and the amber outline already carries the meaning.
            visible={node.height >= 56 && node.width >= 120}
          />
        )}
      </Group>
    );
  }

  return (
    <KonvaImage
      ref={shapeRef}
      image={image}
      {...shadowProps(node.appearance)}
      width={node.width}
      height={node.height}
      // Konva clips natively to the corner radius; nothing read this before,
      // so rounding an image's corners had no visible effect.
      cornerRadius={node.appearance?.cornerRadius ?? 0}
      crop={cropProp}
      filters={filters}
      brightness={konva.brightness}
      contrast={konva.contrast}
      saturation={konva.saturation}
      blurRadius={konva.blurRadius}
    />
  );
});

ImageRenderer.displayName = 'ImageRenderer';

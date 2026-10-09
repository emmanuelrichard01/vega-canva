import React, { useEffect, useMemo, useRef } from 'react';
import Konva from 'konva';
import { Group, Image as KonvaImage, Rect, Text } from 'react-konva';
import useImage from 'use-image';
import type { ImageNode } from '../../../engine/model/schema';
import { applyNodePatches, DERIVED_ORIGIN } from '../../../engine/document';
import { isElectedWriter } from '../../../engine/document/election';
import { cornerRadiiOf } from '../../../engine/model/cornerRadii';
import { isCropped, readCrop } from '../../../engine/model/imageCrop';
import {
  activeFilterIds,
  hasAdjustments,
  readAdjustments,
  toKonvaValues,
  type AdjustmentId,
} from '../../../engine/model/imageAdjustments';
import { strokeColor, strokeDashProps, strokeWidth } from './shared';
import { DropShadow, type ShadowSilhouette } from './ShapeEffects';
import { castsShadow } from '../../../engine/model/dropShadow';
import { useDarkTheme } from './useDarkTheme';
import { uploadIdFromSrc, useResolvedSrc } from '../../../utils/pendingMedia';
import { retryUpload, uploadFraction, useUploadState } from '../../../engine/media/upload';
import { canEditObjects } from '../../../engine/model/permissions';
import { UploadOverlay } from './UploadOverlay';
import { renderPixelRatio } from '../../../engine/render/renderBudget';

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

/** Blur radius of the upload veil, in Konva's units. Enough to read as "not yet", not as damage. */
const VEIL_BLUR = 18;

/** Fixed colours: Konva paints to a canvas and never resolves CSS custom properties. */
const PLACEHOLDER = {
  light: {
    loadFill: 'rgba(148, 163, 184, 0.16)',
    waitFill: 'rgba(243, 160, 36, 0.10)',
    waitStroke: '#D98A12',
    waitText: '#8A5A06',
    failFill: 'rgba(239, 68, 68, 0.06)',
    failStroke: '#DC2626',
    failText: '#B42318',
  },
  dark: {
    loadFill: 'rgba(148, 163, 184, 0.14)',
    waitFill: 'rgba(243, 160, 36, 0.12)',
    waitStroke: '#F3A024',
    waitText: '#F7C46C',
    failFill: 'rgba(248, 113, 113, 0.08)',
    failStroke: '#F87171',
    failText: '#FCA5A5',
  },
} as const;

export const ImageRenderer: React.FC<Props> = React.memo(({ node }) => {
  /**
   * Load with CORS, and fall back to loading without it.
   *
   * Reading pixels back off a canvas that has drawn a cross-origin image
   * throws — the canvas is "tainted". This renderer does exactly that: the
   * adjustment filters need `getImageData`, and every raster export calls
   * `toCanvas`. Requesting the image anonymously, with the server's consent,
   * keeps both working. Uploads are served through the API's media route,
   * which sends the header, so the first attempt succeeds for them.
   *
   * `crossOrigin = 'anonymous'` is not a hint, though: without the header the
   * load fails outright. Older boards whose `src` points straight at the
   * object store still need the plain load, so a failed anonymous attempt is
   * retried plainly. A picture that displays but cannot be exported is a far
   * better outcome than a grey box.
   *
   * A `local:<id>` src becomes an object URL here, or an empty string on a
   * device that does not hold the bytes. See `pendingMedia.ts`.
   */
  const { src: resolvedSrc, pendingUpload } = useResolvedSrc(node.src);
  const upload = useUploadState(node.src);

  const [corsImage, corsStatus] = useImage(resolvedSrc, 'anonymous');
  const needsPlainRetry = corsStatus === 'failed';
  // Skipped entirely unless the first attempt failed: passing a src here
  // unconditionally would fetch every image twice.
  const [plainImage, plainStatus] = useImage(needsPlainRetry ? resolvedSrc : '', undefined);

  const freshImage = corsStatus === 'loaded' ? corsImage : plainImage;
  const freshStatus = corsStatus === 'loaded' ? corsStatus : needsPlainRetry ? plainStatus : corsStatus;

  /**
   * Keep drawing the picture already on screen while its address changes.
   *
   * An upload finishing swaps the local copy for the stored one: the same
   * pixels at a new address. Without this the new address starts loading from
   * nothing and the picture blinks out to a placeholder at the very moment the
   * upload succeeds. Only the same bitmap is carried over — a replacement of
   * different dimensions waits for its own pixels rather than drawing the old
   * picture through the new crop.
   */
  const lastLoaded = useRef<HTMLImageElement | null>(null);
  if (freshStatus === 'loaded' && freshImage) lastLoaded.current = freshImage;
  const carried =
    freshStatus === 'loading' &&
    lastLoaded.current &&
    lastLoaded.current.naturalWidth === node.naturalWidth &&
    lastLoaded.current.naturalHeight === node.naturalHeight
      ? lastLoaded.current
      : null;
  const image = carried ?? freshImage;
  const status = carried ? 'loaded' : freshStatus;
  const shapeRef = useRef<Konva.Image>(null);
  const dark = useDarkTheme();

  /**
   * Record the bitmap's own size, once, from one editor's tab.
   *
   * Cropping, fit and fill all need it: a crop is stored in natural pixels and
   * is clamped against the bitmap's real bounds. It is a fact about the asset
   * rather than an edit, so it is written outside undo, by the elected writer
   * only, and never by a viewer.
   */
  useEffect(() => {
    if (status !== 'loaded' || !image) return;
    if (!image.naturalWidth || !image.naturalHeight) return;
    if (node.naturalWidth === image.naturalWidth && node.naturalHeight === image.naturalHeight) return;
    if (!isElectedWriter()) return;
    applyNodePatches(
      [{ id: node.id, changes: { naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight } }],
      { origin: DERIVED_ORIGIN }
    );
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

  /**
   * While the bytes are on their way up, the picture is drawn softened and
   * sharpens the moment the server has it: "this is yours, it is not saved
   * yet", without a spinner over a photograph.
   */
  const veiled = upload?.phase === 'uploading';

  // Rebuilt only when the *set* of active filters changes, not on every
  // slider tick — reassigning the array makes Konva re-evaluate its filter
  // pipeline, and dragging a slider would rebuild it sixty times a second.
  const activeIds = activeFilterIds(adjustments);
  if (veiled && !activeIds.includes('blur')) activeIds.push('blur');
  const filterKey = activeIds.join(',');
  const filters = useMemo(
    () => (filterKey ? filterKey.split(',').map((id) => KONVA_FILTER[id as AdjustmentId]) : undefined),
    [filterKey]
  );
  const blurRadius = veiled ? Math.max(konva.blurRadius, VEIL_BLUR) : konva.blurRadius;
  const filtered = adjusted || veiled;

  /**
   * Konva filters only run on a **cached** node, and the cache is a raster
   * snapshot — so it is rebuilt whenever anything that feeds it changes, and
   * torn down the moment it is not needed.
   *
   * - An untouched image is never cached: caching costs memory and goes soft
   *   once the canvas is zoomed past the cached resolution.
   * - `pixelRatio` follows the device for adjustments, or a filtered image is
   *   softer than an unfiltered one on HiDPI screens. A veil is blurred anyway,
   *   so it is cached at a fraction of that: an upload in flight costs a
   *   small bitmap, not a full one.
   * - The node's size and crop are dependencies, or a resized image would be
   *   drawn from a stretched snapshot.
   */
  useEffect(() => {
    const shape = shapeRef.current;
    if (!shape) return;

    if (!image || status !== 'loaded' || !filtered) {
      if (shape.isCached()) {
        shape.clearCache();
        shape.getLayer()?.batchDraw();
      }
      return;
    }

    shape.cache({ pixelRatio: veiled && !adjusted ? 0.35 : renderPixelRatio() });
    shape.getLayer()?.batchDraw();
  }, [
    image,
    status,
    adjusted,
    veiled,
    filtered,
    filterKey,
    node.width,
    node.height,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    konva.brightness,
    konva.contrast,
    konva.saturation,
    blurRadius,
  ]);

  const radius = node.appearance?.cornerRadius ?? 0;

  /**
   * Three situations, drawn differently on purpose:
   *
   * - **loading** — a quiet filled slot with no outline: a picture on its way.
   * - **waiting to upload** — the bytes exist on somebody's device and only a
   *   network is missing. Amber, an open dash and a word, so it never reads as
   *   lost work.
   * - **failed** — this picture is not coming back. A red dash and a word.
   */
  if (status !== 'loaded' || !image) {
    const waiting = pendingUpload;
    const failed = !waiting && status === 'failed';
    const ink = dark ? PLACEHOLDER.dark : PLACEHOLDER.light;
    const label = waiting ? 'Waiting to upload' : failed ? 'Picture unavailable' : '';

    return (
      <Group>
        <Rect
          width={node.width}
          height={node.height}
          fill={waiting ? ink.waitFill : failed ? ink.failFill : ink.loadFill}
          stroke={waiting ? ink.waitStroke : failed ? ink.failStroke : undefined}
          strokeWidth={waiting || failed ? 1 : 0}
          dash={waiting ? [10, 6] : failed ? [6, 4] : undefined}
          cornerRadius={radius}
        />
        {label && (
          <Text
            width={node.width}
            height={node.height}
            align="center"
            verticalAlign="middle"
            padding={8}
            text={label}
            fontSize={13}
            fontFamily="Inter, system-ui, sans-serif"
            fill={waiting ? ink.waitText : ink.failText}
            listening={false}
            // Below roughly two lines of type the words are noise, and the
            // outline already carries the meaning.
            visible={node.height >= 56 && node.width >= 120}
          />
        )}
      </Group>
    );
  }

  const picture = (
    <KonvaImage
      ref={shapeRef}
      image={image}
      width={node.width}
      height={node.height}
      cornerRadius={radius}
      crop={cropProp}
      filters={filters}
      brightness={konva.brightness}
      contrast={konva.contrast}
      saturation={konva.saturation}
      blurRadius={blurRadius}
    />
  );

  const border = imageBorder(node);
  const shadow = imageShadow(node, image, cropProp);
  if (!upload && !border && !shadow) return picture;

  const uploadId = uploadIdFromSrc(node.src);
  return (
    <Group>
      {shadow}
      {picture}
      {border}
      {upload && (
        <UploadOverlay
          width={node.width}
          height={node.height}
          fraction={uploadFraction(upload)}
          failedReason={upload.phase === 'failed' ? upload.reason : null}
          queued={upload.phase === 'queued'}
          onRetry={uploadId && canEditObjects() ? () => void retryUpload(uploadId) : undefined}
        />
      )}
    </Group>
  );
});

ImageRenderer.displayName = 'ImageRenderer';

/**
 * The picture's drop shadow, cast by the picture's own alpha.
 *
 * Not Konva's shadow on the image node, for three reasons that all showed:
 *
 * - An adjusted image is cached and filtered, and the cache holds the shadow
 *   too, so brightening a photo greyed its shadow and blurring it blurred the
 *   shadow twice.
 * - A border drawn outside the picture sat beyond the shadow's edge.
 * - A flipped picture cast its shadow upwards (see `shadowProps`).
 *
 * The silhouette is the unfiltered bitmap through the same crop and corners,
 * so a cut-out PNG casts the shape of its subject, as it does in Figma. No
 * knockout: a photograph's edge pixels are opaque, and cutting along them
 * leaves a seam.
 */
function imageShadow(
  node: ImageNode,
  image: HTMLImageElement,
  crop: { x: number; y: number; width: number; height: number } | undefined
): React.ReactElement | null {
  const shadow = node.appearance?.shadow;
  if (!castsShadow(shadow)) return null;
  const w = node.width;
  const h = node.height;
  const radii = cornerRadiiOf(node.appearance?.cornerRadius);
  const frame = new Path2D();
  if (radii.some((r) => r > 0) && typeof frame.roundRect === 'function') frame.roundRect(0, 0, w, h, radii);
  else frame.rect(0, 0, w, h);

  const silhouette: ShadowSilhouette = {
    raster: (ctx) => {
      ctx.save();
      ctx.clip(frame);
      if (crop) ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, w, h);
      else ctx.drawImage(image, 0, 0, w, h);
      ctx.restore();
    },
  };
  const borderWidth = strokeColor(node.appearance) ? strokeWidth(node.appearance) : 0;
  let reach = 0;
  if (borderWidth > 0) {
    const align = node.appearance?.stroke?.align ?? 'inside';
    const shift = align === 'inside' ? borderWidth / 2 : align === 'outside' ? -borderWidth / 2 : 0;
    const ring = new Path2D();
    const inset = radii.map((r) => Math.max(0, r - shift));
    const bw = Math.max(0, w - shift * 2);
    const bh = Math.max(0, h - shift * 2);
    if (inset.some((r) => r > 0) && typeof ring.roundRect === 'function') ring.roundRect(shift, shift, bw, bh, inset);
    else ring.rect(shift, shift, bw, bh);
    silhouette.strokes = [{ path: ring, width: borderWidth, dash: node.appearance?.stroke?.dash }];
    reach = Math.max(0, borderWidth / 2 - shift);
  }
  return (
    <DropShadow
      shadow={shadow}
      box={{ x: -reach, y: -reach, width: w + reach * 2, height: h + reach * 2 }}
      silhouette={silhouette}
    />
  );
}

/**
 * The picture's border, drawn over its edge with the same corners.
 *
 * Images offer Stroke in the panel like every paintable object; this is what
 * makes it show. Inside by default, as a picture frame is: the border eats into
 * the picture rather than growing the object past the box it reports.
 */
function imageBorder(node: ImageNode): React.ReactElement | null {
  const color = strokeColor(node.appearance);
  const width = strokeWidth(node.appearance);
  if (!color || !(width > 0)) return null;
  const align = node.appearance?.stroke?.align ?? 'inside';
  const shift = align === 'inside' ? width / 2 : align === 'outside' ? -width / 2 : 0;
  const radii = cornerRadiiOf(node.appearance?.cornerRadius).map((r) => Math.max(0, r - shift));
  return (
    <Rect
      x={shift}
      y={shift}
      width={Math.max(0, node.width - shift * 2)}
      height={Math.max(0, node.height - shift * 2)}
      cornerRadius={radii}
      stroke={color}
      strokeWidth={width}
      {...strokeDashProps(node.appearance)}
      listening={false}
      perfectDrawEnabled={false}
    />
  );
}

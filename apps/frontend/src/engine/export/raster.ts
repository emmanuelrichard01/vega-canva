import { computeContentBounds, type ExportBounds } from './bounds';
import { useStore } from '../../hooks/useStore';
import { hideExportChrome } from './chrome';
import { resolveBackground, type ExportOptions, type FormatSpec } from './ExportTypes';
import { fitScale } from './rasterLimits';

// Re-exported so importers keep one name for the cap, while the arithmetic
// itself lives in a module Node can load.
export { MAX_CANVAS_EDGE, MAX_CANVAS_AREA, fitScale } from './rasterLimits';


export interface RasterCapture {
  canvas: HTMLCanvasElement;
  /** The scale actually used, which may be below the one requested. */
  scale: number;
  bounds: ExportBounds;
  /** True when the cap forced the scale down, so the UI can say so. */
  clamped: boolean;
}

/**
 * Render the document to a canvas at a given density.
 *
 * ## Why this is not inside an exporter
 *
 * PNG, JPEG, WebP and PDF all need exactly this and differ only in how they
 * encode the result. It lived inside `PNGExporter`, so adding a second raster
 * format meant either copying the stage-reframing dance or importing one
 * exporter from another. Both are how the formats start disagreeing about what
 * they captured.
 *
 * ## The stage dance
 *
 * A bare `stage.toDataURL()` captures the stage at its current camera position
 * and size — a screenshot of whatever the user happened to be looking at. On an
 * infinite canvas that silently crops to the current view, and if they had
 * panned away it produces an empty image. So the stage is reframed onto the
 * content box, drawn, captured, and put back exactly as it was.
 *
 * The reframe and restore are synchronous with no `await` between them, so the
 * engine's `requestAnimationFrame` loop cannot re-apply the live camera
 * mid-capture and leave the user looking at a stage that is the wrong size.
 */
export function captureRaster(options: ExportOptions, spec: FormatSpec): RasterCapture {
  const stage = options.stage;
  if (!stage) {
    throw new Error('Raster export needs a Konva stage. Try SVG or JSON instead.');
  }

  const bounds =
    options.bounds ??
    computeContentBounds(
      // Read here rather than defaulted inside `computeContentBounds`, so that
      // module stays free of the store and can be asserted in Node.
      useStore.getState().objects,
      options.selectedOnly ? options.selectedIds : undefined,
      options.padding
    );

  const requested = options.scale ?? 2;
  const scale = fitScale(bounds.width, bounds.height, requested);

  const previous = {
    x: stage.x(),
    y: stage.y(),
    scaleX: stage.scaleX(),
    scaleY: stage.scaleY(),
    width: stage.width(),
    height: stage.height(),
  };

  // Selection handles, hover outlines, the crop overlay, the tool preview and
  // the frames' name labels are all on the stage and would all be captured.
  const restoreChrome = hideExportChrome(stage);

  const width = Math.max(1, Math.round(bounds.width * scale));
  const height = Math.max(1, Math.round(bounds.height * scale));

  let source: HTMLCanvasElement;
  try {
    stage.scale({ x: scale, y: scale });
    stage.position({ x: -bounds.x * scale, y: -bounds.y * scale });
    stage.size({ width, height });
    stage.draw();
    source = stage.toCanvas({ pixelRatio: 1 });
  } finally {
    restoreChrome();
    stage.size({ width: previous.width, height: previous.height });
    stage.position({ x: previous.x, y: previous.y });
    stage.scale({ x: previous.scaleX, y: previous.scaleY });
    stage.draw();
  }

  const background = resolveBackground(options.background, spec);
  if (!background) {
    return { canvas: source, scale, bounds, clamped: scale < requested };
  }

  /**
   * Composited onto a filled canvas rather than by setting a CSS background.
   *
   * The encoder only ever sees the bitmap, so a background that is not painted
   * into the pixels is a background that does not exist in the file.
   * `destination-over` paints beneath what is already there, which is exactly
   * "put paper behind this" and needs no second draw of the artwork.
   */
  const out = document.createElement('canvas');
  out.width = source.width;
  out.height = source.height;
  const ctx = out.getContext('2d');
  if (!ctx) return { canvas: source, scale, bounds, clamped: scale < requested };

  ctx.drawImage(source, 0, 0);
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, out.width, out.height);

  return { canvas: out, scale, bounds, clamped: scale < requested };
}

/**
 * Encode a canvas, preferring the real async path.
 *
 * `toBlob` hands back the encoder's own bytes; `toDataURL` would base64 them
 * first and then need decoding again, which for a 8192px export is tens of
 * megabytes of string built on the main thread for no reason.
 */
export function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        // A null blob means the browser refused the mime type — WebP on an old
        // Safari, most often. Saying which format failed is the difference
        // between "try PNG" and "the export is broken".
        else reject(new Error(`This browser cannot encode ${mime}. Try PNG instead.`));
      },
      mime,
      quality
    );
  });
}

import { computeContentBounds, type ExportBounds } from './bounds';
import { useStore } from '../../hooks/useStore';
import { hideExportChrome } from './chrome';
import { isolateObjects } from './isolate';
import { nextCommit, renderScope } from './renderScope';
import { expectedImages, waitForImages } from './imagesReady';
import { resolveBackground, type ExportOptions, type FormatSpec } from './ExportTypes';
import { exportIds, exportIdSet } from './exportScope';
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
 * Anything that needs to happen *before* the capture and needs to wait —
 * mounting culled objects — is `mountForCapture`'s job, not this one's.
 *
 * ## What is on the stage, and what should be
 *
 * Two things were wrong with capturing "the stage" and had the same shape: the
 * stage is not the document.
 *
 * It holds **too little**, because the canvas culls to the viewport, so a board
 * wider than the window exported an image of the right dimensions with the
 * off-screen half blank. `mountForCapture` settles that before this runs.
 *
 * And it holds **too much**, because a selection-scoped export framed to the
 * selection and then captured everything inside that frame — so the PNG of one
 * sticky note also contained the frame behind it and the notes overlapping its
 * corners, while the SVG of the same selection contained the note alone.
 * `isolateObjects` settles that, here, for the length of the capture.
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
      // `?? undefined` because `computeContentBounds` distinguishes "no ids
      // given" from an empty list, and `exportIds` already collapsed the
      // empty list into `null`. See its docstring for why that matters.
      exportIds(options) ?? undefined,
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
  // And everything the export is *not* of. `null` for a whole-board export,
  // which is the common case and does not walk the tree.
  const restoreIsolation = isolateObjects(stage, exportIdSet(options));

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
    restoreIsolation();
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


/**
 * Put everything this export needs on the stage, and wait for it to arrive.
 *
 * Returns the release, to be called once the pixels have been read. Await it
 * *before* `captureRaster`, never inside it — see the note about the rAF loop
 * above.
 *
 * The whole board is required for a whole-board export rather than only the
 * objects inside the bounds, because the bounds *are* the objects: there is no
 * cheaper set that is still correct, and the cost is one React commit that is
 * immediately given back.
 */
export async function mountForCapture(options: ExportOptions): Promise<() => void> {
  const objects = useStore.getState().objects;
  const ids = exportIds(options) ?? Object.keys(objects);

  const release = renderScope.require(ids);
  try {
    await nextCommit();
    /**
     * And then for the pictures.
     *
     * Mounting an image node does not make it drawable: `use-image` builds an
     * element, sets `src`, and the picture lands on a `load` event later. So
     * the fix for one silent omission — an off-screen half of the board — would
     * otherwise open a quieter one, where the photograph is on the stage as an
     * empty rectangle rather than missing from it.
     *
     * The result is deliberately not checked. A picture that never loads is a
     * gap in the file, which is visible; refusing the export over it would not
     * be. See `imagesReady.ts`.
     */
    if (options.stage) {
      await waitForImages(
        options.stage,
        expectedImages(ids.map((id) => objects[id]).filter(Boolean))
      );
    }
  } catch {
    // A browser with no rAF is a browser with no canvas either; the capture
    // will report that itself, and holding the scope open would be worse.
    release();
    throw new Error('This browser cannot render an image export.');
  }
  return release;
}

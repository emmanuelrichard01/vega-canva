import { captureBand, captureRaster, exportBounds, mountForCapture } from './raster';
import { encodeCanvasWithWorker } from './exportWorkerClient';
import { bandHeight, canTile, plannedScale } from './rasterLimits';
import { encodeTiledPng } from './tiledPng';
import { FORMAT_SPECS, type Exporter, type ExportFormat, type ExportOptions } from './ExportTypes';

/**
 * PNG, JPEG and WebP.
 *
 * One class parameterised by format rather than three near-identical ones.
 * They differ only in the mime string handed to the encoder and in whether
 * `quality` means anything — everything up to that point is the same capture,
 * and three copies of it is three chances for the PNG and the JPEG of the same
 * frame to be framed differently.
 *
 * A PNG too large for one canvas is drawn in bands and streamed through
 * `encodeTiledPng`, so it arrives at the density asked for (up to the tiled
 * guard in `rasterLimits`). JPEG and WebP are encoded by the browser from one
 * canvas and stop at its ceiling.
 */
export class RasterExporter implements Exporter {
  type: ExportFormat;

  // Written out rather than as a parameter property: this project builds with
  // `erasableSyntaxOnly`, which rules out the shorthand.
  constructor(type: ExportFormat) {
    this.type = type;
  }

  async export(options: ExportOptions): Promise<Blob> {
    const spec = FORMAT_SPECS[this.type];
    const requested = options.scale ?? 2;

    if (this.type === 'png' && options.stage) {
      const bounds = exportBounds(options);
      const plan = plannedScale(bounds.width, bounds.height, requested, canTile());
      if (plan.tiled) return this.tiled(options, bounds, plan.scale);
    }

    /**
     * Mounted first, awaited, and only then captured.
     *
     * The canvas culls to the viewport, so the stage holds what is on screen
     * rather than what is in the document — and the capture is deliberately
     * synchronous, so it cannot wait for a commit itself. Splitting the two
     * keeps the asynchronous half out of the half that must not yield.
     */
    const release = await mountForCapture(options);
    let canvas: HTMLCanvasElement;
    try {
      ({ canvas } = captureRaster(options, spec));
    } finally {
      release();
    }
    // A quality means nothing to a lossless encoder, so none is passed.
    const quality = spec.lossy ? (options.quality ?? 0.92) : undefined;
    return encodeCanvasWithWorker(canvas, null, spec.mime, quality);
  }

  /** A PNG past the single-canvas ceiling, a band at a time. */
  private async tiled(options: ExportOptions, bounds: { x: number; y: number; width: number; height: number }, scale: number): Promise<Blob> {
    const width = Math.max(1, Math.round(bounds.width * scale));
    const height = Math.max(1, Math.round(bounds.height * scale));
    const release = await mountForCapture(options);
    try {
      return await encodeTiledPng(
        width,
        height,
        (y, rows) => captureBand(options, FORMAT_SPECS.png, bounds, scale, y, rows, width),
        { bandHeight: bandHeight(width), signal: options.signal, onProgress: options.onProgress }
      );
    } finally {
      release();
    }
  }
}

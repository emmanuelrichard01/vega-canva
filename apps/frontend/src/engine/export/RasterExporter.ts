import { captureRaster, canvasToBlob, mountForCapture } from './raster';
import { FORMAT_SPECS, type Exporter, type ExportFormat, type ExportOptions } from './ExportTypes';

/**
 * PNG, JPEG and WebP.
 *
 * One class parameterised by format rather than three near-identical ones.
 * They differ only in the mime string handed to the encoder and in whether
 * `quality` means anything — everything up to that point is the same capture,
 * and three copies of it is three chances for the PNG and the JPEG of the same
 * frame to be framed differently.
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
    // Passing a quality to a lossless encoder is not harmless — Chrome ignores
    // it for PNG but the argument is meaningless, and being explicit keeps the
    // control and the format honest about each other.
    const quality = spec.lossy ? (options.quality ?? 0.92) : undefined;
    return canvasToBlob(canvas, spec.mime, quality);
  }
}

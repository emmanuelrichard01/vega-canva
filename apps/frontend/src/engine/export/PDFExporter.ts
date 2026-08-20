import { captureRaster, canvasToBlob } from './raster';
import { buildPdf, type PdfPage } from './pdfWriter';
import { frameExportBounds } from './bounds';
import { descendantsOfFrame } from '../model/frames';
import { useStore } from '../../hooks/useStore';
import { FORMAT_SPECS, type Exporter, type ExportFormat, type ExportOptions } from './ExportTypes';

/** PostScript points per inch — the unit a PDF page is measured in. */
const POINTS_PER_INCH = 72;
/** CSS pixels per inch, which is what a world unit means in this app. */
const CSS_PIXELS_PER_INCH = 96;

/** World units → points, so a page prints at the size the canvas claims. */
const toPoints = (units: number) => (units / CSS_PIXELS_PER_INCH) * POINTS_PER_INCH;

/**
 * PDF: decide what the pages are, capture each one, hand them to the writer.
 *
 * ## A frame is a page
 *
 * This is the only part of the export system that has to answer "what is a page
 * on an infinite canvas", and frames are the answer the document already
 * contains. A frame declares a size — 1920×1080, A4 — and that declaration is
 * the reason it exists, so it maps onto a page exactly and at true printed
 * size. A board of frames becomes a document of pages.
 *
 * Before this, PDF always produced **one** page cut to the content's bounding
 * box. That is right for a single frame and increasingly wrong for a board: a
 * sprawling canvas came out as one 60-inch-wide "page" that no reader or
 * printer expects, and past about 19,200 world units it exceeded the format's
 * own page limit and produced a file Acrobat would not open. Batch export
 * papered over it by saving one *file* per frame, which is not a document.
 *
 * ## What each mode produces
 *
 * | Asked for | Pages |
 * | --- | --- |
 * | One named frame | that frame, one page |
 * | A board with frames | one page per frame, in board order |
 * | A board with no frames | one page, cut to the content |
 *
 * The no-frames case is not a fallback so much as the honest answer: with no
 * frame to say where the edges are, the content's bounding box is the only
 * finite rectangle the document actually has.
 */
export class PDFExporter implements Exporter {
  type: ExportFormat = 'pdf';

  async export(options: ExportOptions): Promise<Blob> {
    const spec = FORMAT_SPECS.pdf;
    const objects = useStore.getState().objects;

    /**
     * `resolveExportTarget` has already run by the time an exporter is called,
     * so a single named frame arrives as resolved `bounds` and `selectedIds`
     * and needs no special case — it is simply a one-page document.
     */
    const frames = options.frameId
      ? []
      : Object.values(objects)
          .filter((n) => n.type === 'frame' && !n.hidden)
          // Board order, so the document reads in the order the frames were
          // made rather than in whatever order the map happens to iterate.
          .sort((a, b) => a.zIndex - b.zIndex);

    const pages: PdfPage[] =
      frames.length > 0
        ? await Promise.all(
            frames.map((frame) =>
              this.capturePage(
                {
                  ...options,
                  bounds: frameExportBounds(frame),
                  selectedOnly: true,
                  // The frame itself is included because its own fill is the
                  // page's background.
                  selectedIds: [frame.id, ...descendantsOfFrame(frame.id, Object.values(objects))],
                },
                spec,
                options.quality
              )
            )
          )
        : [await this.capturePage(options, spec, options.quality)];

    return buildPdf(pages, {
      title: options.filename ? options.filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') : undefined,
    });
  }

  /** One page: capture the region, encode it, and size the sheet from it. */
  private async capturePage(
    options: ExportOptions,
    spec: typeof FORMAT_SPECS.pdf,
    quality: number | undefined
  ): Promise<PdfPage> {
    const { canvas, bounds } = captureRaster(options, spec);
    const jpeg = await canvasToBlob(canvas, 'image/jpeg', quality ?? 0.92);
    const bytes = new Uint8Array(await jpeg.arrayBuffer());

    /**
     * Page size in points, from the artwork's own world size.
     *
     * The world unit is treated as a CSS pixel at 96 dpi, which is what every
     * frame preset in this app already means by "1080 × 1080". Laying that out
     * at 72 points per inch gives a page whose printed size matches the size
     * the canvas claims, rather than a page that happens to be as many points
     * as the bitmap is pixels — which would make a 2× export come out twice
     * as large on paper.
     */
    return {
      jpeg: bytes,
      pixelW: canvas.width,
      pixelH: canvas.height,
      pageW: toPoints(bounds.width),
      pageH: toPoints(bounds.height),
    };
  }
}

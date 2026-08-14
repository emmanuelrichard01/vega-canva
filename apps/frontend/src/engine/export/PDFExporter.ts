import { captureRaster, canvasToBlob } from './raster';
import { FORMAT_SPECS, type Exporter, type ExportFormat, type ExportOptions } from './ExportTypes';

/** PostScript points per inch — the unit a PDF page is measured in. */
const POINTS_PER_INCH = 72;
/** CSS pixels per inch, which is what a world unit means in this app. */
const CSS_PIXELS_PER_INCH = 96;

/**
 * PDF, written by hand.
 *
 * ## Why not a library
 *
 * jsPDF and pdf-lib are both perfectly good and both cost 300–400 KB in the
 * bundle of an app whose entire point is to load fast on a shared link. What we
 * need is one page containing one image, which is about eighty lines of a
 * format that has been stable since 1993. For an open-source app that other
 * people have to build and audit, a dependency should earn its place; this one
 * does not.
 *
 * ## The shape of the file
 *
 * Five objects, in the order PDF wants them:
 *
 *   1  Catalog        → points at the page tree
 *   2  Pages          → the list of pages
 *   3  Page           → size, resources, content
 *   4  Contents       → the drawing operators
 *   5  XObject        → the image itself, as raw JPEG bytes
 *
 * Then an **xref table** giving the byte offset of every object, and a trailer
 * pointing at the xref. The offsets are the fiddly part and the reason this is
 * assembled as bytes rather than as a string: a single multi-byte character
 * anywhere earlier in the file would shift every subsequent offset and produce
 * a PDF that readers reject as corrupt.
 *
 * ## Why the image is JPEG
 *
 * `/DCTDecode` lets a PDF carry JPEG bytes *verbatim* — no re-encoding, no
 * decompression, and no need to implement Flate. A PNG would have to be
 * decompressed and re-deflated to become `/FlateDecode`, which means shipping
 * a deflate implementation to save nothing anyone would see on a page.
 */
export class PDFExporter implements Exporter {
  type: ExportFormat = 'pdf';

  async export(options: ExportOptions): Promise<Blob> {
    const spec = FORMAT_SPECS.pdf;
    const { canvas, bounds } = captureRaster(options, spec);
    const jpeg = await canvasToBlob(canvas, 'image/jpeg', options.quality ?? 0.92);
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
    const pageW = (bounds.width / CSS_PIXELS_PER_INCH) * POINTS_PER_INCH;
    const pageH = (bounds.height / CSS_PIXELS_PER_INCH) * POINTS_PER_INCH;

    return buildPdf(bytes, canvas.width, canvas.height, pageW, pageH);
  }
}

/** ASCII → bytes. The PDF structure is ASCII by definition. */
const ascii = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

/** Trim to a sensible number of decimals — PDF has no use for float noise. */
const num = (n: number): string => (Math.round(n * 1000) / 1000).toString();

function buildPdf(
  jpeg: Uint8Array,
  pixelW: number,
  pixelH: number,
  pageW: number,
  pageH: number
): Blob {
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;

  const push = (chunk: Uint8Array | string) => {
    const bytes = typeof chunk === 'string' ? ascii(chunk) : chunk;
    parts.push(bytes);
    length += bytes.length;
  };

  /** Record where this object starts before writing it — that is the xref. */
  const beginObject = (n: number, header: string) => {
    offsets[n] = length;
    push(header);
  };

  push('%PDF-1.4\n');
  // A comment of high bytes, which is the conventional way of telling
  // transfer tools this file is binary and must not be newline-translated.
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  beginObject(1, '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  beginObject(2, '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  beginObject(
    3,
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(pageW)} ${num(pageH)}] ` +
      `/Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>\nendobj\n`
  );

  /**
   * The content stream: scale the unit image up to the page and draw it.
   *
   * `cm` sets the transform to [w 0 0 h 0 0], because an XObject image is
   * defined on the unit square — so the matrix *is* the placement. `q`/`Q`
   * save and restore the graphics state around it, which costs nothing and
   * keeps the stream composable if a footer is ever added.
   */
  const content = `q\n${num(pageW)} 0 0 ${num(pageH)} 0 0 cm\n/Im0 Do\nQ\n`;
  beginObject(4, `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);

  beginObject(
    5,
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pixelW} /Height ${pixelH} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`
  );
  push(jpeg);
  push('\nendstream\nendobj\n');

  // The xref table. Entry zero is the head of the free list and is always
  // this exact line; readers check it.
  const xrefStart = length;
  let xref = 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i += 1) {
    xref += `${offsets[i].toString().padStart(10, '0')} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);

  return new Blob(parts as BlobPart[], { type: 'application/pdf' });
}

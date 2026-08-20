/**
 * Writing a PDF by hand.
 *
 * ## Why not a library
 *
 * jsPDF and pdf-lib are both perfectly good and both cost 300–400 KB in the
 * bundle of an app whose entire point is to load fast on a shared link. What we
 * need is pages containing one image each, which is a couple of hundred lines
 * of a format that has been stable since 1993. For an open-source app that
 * other people have to build and audit, a dependency should earn its place;
 * this one does not.
 *
 * ## What a "page" means when the canvas is infinite
 *
 * This is the question the format forces and a whiteboard has no natural answer
 * to. A PDF page is a fixed rectangle at a real printed size; an infinite canvas
 * is neither. The resolution here:
 *
 *  - **A frame is a page.** A frame already declares a size — 1920×1080, A4 —
 *    and that declaration is the whole reason it exists, so it maps onto a page
 *    exactly. A board of frames becomes a document of pages, in board order.
 *  - **A board with no frames is one page, cut to its content.** There is
 *    nothing else honest to do: the content's bounding box is the only finite
 *    rectangle the document actually has.
 *
 * So the infinite canvas never has to be squared with the page model — the
 * *content* is always finite, and frames are the user's own statement of where
 * the edges are.
 *
 * ## The shape of the file
 *
 * Two fixed objects, then three per page, then one for the metadata:
 *
 *   1            Catalog        → points at the page tree
 *   2            Pages          → the list of pages
 *   3 + 3n       Page           → size, resources, content
 *   4 + 3n       Contents       → the drawing operators
 *   5 + 3n       XObject        → the image itself, as raw JPEG bytes
 *   3 + 3N       Info           → title, producer, creation date
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
 *
 * ## Why this is its own module
 *
 * It is pure — bytes in, bytes out — and the exporter beside it is not: that
 * one reaches the Konva stage and the document store, so importing it in Node
 * fails before any assertion runs. Separating them is what lets the xref
 * arithmetic, which is the part most likely to be silently wrong, be tested.
 */

/**
 * The largest page any PDF reader will accept, in points.
 *
 * 200 inches square. This is an implementation limit rather than a rule of the
 * file format, but it is Acrobat's and therefore everyone's, and exceeding it
 * produces a document that is variously clamped, rendered blank, or rejected
 * outright depending on the reader.
 *
 * It matters here specifically **because the canvas is infinite**. A page is
 * sized from the content's own bounding box, so a board spread across roughly
 * twenty screens — about 19,200 world units, which is an afternoon's work on a
 * shared board, not an extreme — asks for a page over the limit. Nothing
 * guarded it, and the failure arrives at the reader rather than at the export.
 */
export const MAX_PDF_POINTS = 14_400;

/** One page: an image, and the rectangle to lay it into. */
export interface PdfPage {
  /** Raw JPEG bytes, embedded verbatim via `/DCTDecode`. */
  jpeg: Uint8Array;
  /** The bitmap's own dimensions, which the image dictionary declares. */
  pixelW: number;
  pixelH: number;
  /** The printed page size in points. */
  pageW: number;
  pageH: number;
}

export interface PdfMeta {
  /** Shown as the document title; usually derived from the filename. */
  title?: string;
}

/**
 * A PDF string literal, escaped.
 *
 * The three characters that terminate or nest a literal — `\`, `(` and `)` —
 * have to be escaped or a document title containing a bracket truncates the
 * dictionary and corrupts the file. Non-ASCII is dropped rather than encoded:
 * PDFDocEncoding is not UTF-8, and a mangled title is worse than a plain one.
 */
function pdfString(value: string): string {
  return value
    .replace(/[\\()]/g, (c) => `\\${c}`)
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7E]/g, '')
    .slice(0, 200);
}

/** `D:YYYYMMDDHHmmSS`, the only date format the spec defines. */
function pdfDate(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `D:${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  );
}

/** ASCII → bytes. The PDF structure is ASCII by definition. */
const ascii = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

/** Trim to a sensible number of decimals — PDF has no use for float noise. */
const num = (n: number): string => (Math.round(n * 1000) / 1000).toString();

/**
 * A page brought inside the reader's limit, keeping its proportions.
 *
 * Scaled rather than cropped: the page is a view of the whole board, and
 * cutting it down would silently drop the objects furthest from the centre —
 * the ones most likely to be the reason someone spread out in the first place.
 * A smaller printed page keeps everything and says so in the dimensions.
 */
export function fitPageToLimit(pageW: number, pageH: number): { pageW: number; pageH: number } {
  const largest = Math.max(pageW, pageH);
  if (largest <= MAX_PDF_POINTS) return { pageW, pageH };
  const k = MAX_PDF_POINTS / largest;
  return { pageW: pageW * k, pageH: pageH * k };
}

/**
 * Exported so the file structure can be asserted without a browser.
 *
 * The docstring above calls the xref offsets "the fiddly part", and they were
 * the untested part: a byte-exact table of file positions, assembled by hand,
 * where being wrong produces a file some readers open and others reject. That
 * is precisely the arithmetic this codebase's own rule says to move somewhere
 * it can be checked in Node. Everything it needs is bytes in and bytes out.
 */
export function buildPdf(pages: PdfPage[], meta: PdfMeta = {}): Blob {
  if (pages.length === 0) {
    throw new Error('A PDF needs at least one page.');
  }

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

  /**
   * Object numbers are computed up front, not counted as we go.
   *
   * The page tree has to name every page object before any of them is written,
   * so the numbering is a formula rather than a running total. Three objects
   * per page — the page, its content stream, its image — starting at 3.
   */
  const pageObj = (i: number) => 3 + i * 3;
  const contentObj = (i: number) => 4 + i * 3;
  const imageObj = (i: number) => 5 + i * 3;
  const infoObj = 3 + pages.length * 3;
  const objectCount = infoObj;

  beginObject(1, '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  const kids = pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ');
  beginObject(2, `2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`);

  pages.forEach((page, i) => {
    const { pageW, pageH } = fitPageToLimit(page.pageW, page.pageH);

    beginObject(
      pageObj(i),
      `${pageObj(i)} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(pageW)} ${num(pageH)}] ` +
        `/Resources << /XObject << /Im0 ${imageObj(i)} 0 R >> >> /Contents ${contentObj(i)} 0 R >>\nendobj\n`
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
    beginObject(
      contentObj(i),
      `${contentObj(i)} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`
    );

    beginObject(
      imageObj(i),
      `${imageObj(i)} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.pixelW} /Height ${page.pixelH} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`
    );
    push(page.jpeg);
    push('\nendstream\nendobj\n');
  });

  /**
   * The document information dictionary.
   *
   * The difference between a file that says what it is and one that every
   * reader lists as untitled with no author and no date. A viewer's Properties
   * panel, a document management system and Spotlight all read it, and a design
   * tool that exports blank metadata looks unfinished at exactly the moment the
   * file leaves the app.
   */
  beginObject(
    infoObj,
    `${infoObj} 0 obj\n<< /Title (${pdfString(meta.title || 'Untitled')}) /Producer (Vega Studio) ` +
      `/Creator (Vega Studio) /CreationDate (${pdfDate(new Date())}) >>\nendobj\n`
  );

  // The xref table. Entry zero is the head of the free list and is always
  // this exact line; readers check it.
  const xrefStart = length;
  let xref = `xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objectCount; i += 1) {
    xref += `${offsets[i].toString().padStart(10, '0')} 00000 n \n`;
  }
  push(xref);
  // `/Size` is the number of entries *including* the free one at index zero,
  // which is why it is one more than the object count. Readers that check it
  // reject the file outright when it disagrees.
  push(
    `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R /Info ${infoObj} 0 R >>\n` +
      `startxref\n${xrefStart}\n%%EOF\n`
  );

  return new Blob(parts as BlobPart[], { type: 'application/pdf' });
}

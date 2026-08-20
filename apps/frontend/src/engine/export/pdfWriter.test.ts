import { describe, expect, it } from 'vitest';
import { buildPdf, fitPageToLimit, MAX_PDF_POINTS, type PdfPage } from './pdfWriter';

/**
 * A hand-written binary format, previously asserted by nobody.
 *
 * The module's docstring calls the xref offsets "the fiddly part": a table of
 * byte positions where being wrong by one produces a document that some readers
 * open and others reject as corrupt. Nothing about that failure is visible from
 * the app — the download succeeds either way — so it can only be caught here.
 *
 * The offsets are the point of these tests, and they matter more now that a
 * document can have many pages: the object numbering became a formula, and a
 * formula that is off by one is wrong on every page but the first.
 */

/** Bytes that are not valid ASCII, standing in for real JPEG data. */
const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);

/** An 800×600 capture laid onto a 576×432pt page — 96dpi content at 72dpi. */
function page(over: Partial<PdfPage> = {}): PdfPage {
  return { jpeg: fakeJpeg, pixelW: 800, pixelH: 600, pageW: 576, pageH: 432, ...over };
}

async function bytesOf(pages: PdfPage[], title?: string): Promise<Uint8Array> {
  return new Uint8Array(await buildPdf(pages, { title }).arrayBuffer());
}

/** The file as latin-1 text, so byte offsets and string indices agree. */
function asLatin1(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

async function textOf(pages: PdfPage[] = [page()], title?: string): Promise<string> {
  return asLatin1(await bytesOf(pages, title));
}

/**
 * Every xref entry, checked against the object it claims to point at.
 *
 * Sliced from the table's own header rather than `lastIndexOf('xref')`, which
 * finds the `xref` inside `startxref` — that sits *after* the table, so the
 * slice came back empty and the loop passed without asserting anything. The
 * first draft of this file did exactly that.
 */
function expectXrefIntact(text: string, expectedObjects: number) {
  const table = text.slice(text.lastIndexOf('\nxref\n'));
  const entries = [...table.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));

  expect(entries).toHaveLength(expectedObjects);
  entries.forEach((offset, i) => {
    const objectNumber = i + 1;
    expect(text.slice(offset, offset + 12), `object ${objectNumber} at byte ${offset}`).toMatch(
      new RegExp(`^${objectNumber} 0 obj`)
    );
  });
}

describe('buildPdf', () => {
  it('is a PDF, and says so in the first bytes', async () => {
    const text = await textOf();
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('marks itself binary so transfer tools do not translate newlines', async () => {
    const bytes = await bytesOf([page()]);
    expect(bytes[9]).toBe(0x25);
    expect(bytes[10]).toBeGreaterThan(0x7f);
  });

  it('carries the JPEG through byte for byte', async () => {
    // /DCTDecode exists so the image is embedded verbatim. Any re-encoding
    // here would be silent quality loss on every PDF the app produces.
    const text = await textOf();
    expect(text).toContain(asLatin1(fakeJpeg));
    expect(text).toContain('/Filter /DCTDecode');
    expect(text).toContain(`/Length ${fakeJpeg.length}`);
  });

  it('refuses to build a document with no pages', async () => {
    // Better than emitting a catalogue pointing at an empty page tree, which
    // is a file that opens as zero pages and looks like data loss.
    expect(() => buildPdf([])).toThrow(/at least one page/i);
  });

  it('points every xref entry at the object it claims', async () => {
    // 2 fixed + 3 per page + 1 info.
    expectXrefIntact(await textOf(), 6);
  });

  it('opens the xref table with the free-list head readers check for', async () => {
    expect(await textOf()).toContain('xref\n0 7\n0000000000 65535 f \n');
  });

  it('declares a Size one greater than the object count', async () => {
    // /Size counts entries including the free entry at index zero. Readers that
    // validate it reject the file outright when it disagrees.
    const text = await textOf();
    const objects = [...text.matchAll(/^(\d+) 0 obj/gm)].length;
    expect(text).toContain(`/Size ${objects + 1}`);
  });

  it('puts startxref at the byte where the table begins', async () => {
    const text = await textOf();
    const declared = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(declared, declared + 4)).toBe('xref');
  });

  it('sizes the page in points, not in pixels', async () => {
    // A 2x export must not print twice as large.
    const text = await textOf();
    expect(text).toContain('/MediaBox [0 0 576 432]');
    expect(text).toContain('/Width 800 /Height 600');
  });

  it('places the image over the whole page', async () => {
    // An image XObject is defined on the unit square, so the matrix is the
    // placement: [pageW 0 0 pageH 0 0].
    expect(await textOf()).toContain('576 0 0 432 0 0 cm');
  });

  /**
   * A frame is a page, so a board of frames is a document of pages. This is
   * the whole answer to "what is a page on an infinite canvas", and it is also
   * where the object numbering stops being a list of literals and becomes
   * arithmetic — which is the part that can be quietly wrong.
   */
  describe('with several pages', () => {
    const three = [
      page({ pageW: 1440, pageH: 810 }),
      page({ pageW: 810, pageH: 810 }),
      page({ pageW: 595, pageH: 842 }),
    ];

    it('keeps the xref table intact across every page', async () => {
      // 2 fixed + 3 per page + 1 info = 12.
      expectXrefIntact(await textOf(three), 12);
    });

    it('lists every page in the page tree', async () => {
      const text = await textOf(three);
      expect(text).toContain('/Kids [3 0 R 6 0 R 9 0 R] /Count 3');
    });

    it('gives each page its own size rather than the first one', async () => {
      // The failure this guards is a document where every frame prints at the
      // dimensions of whichever frame happened to be first.
      const text = await textOf(three);
      expect(text).toContain('/MediaBox [0 0 1440 810]');
      expect(text).toContain('/MediaBox [0 0 810 810]');
      expect(text).toContain('/MediaBox [0 0 595 842]');
    });

    it('gives each page its own image, not a shared one', async () => {
      const text = await textOf(three);
      // Each page's resources must name its own XObject.
      expect(text).toContain('/XObject << /Im0 5 0 R >>');
      expect(text).toContain('/XObject << /Im0 8 0 R >>');
      expect(text).toContain('/XObject << /Im0 11 0 R >>');
    });

    it('embeds one image per page', async () => {
      const text = await textOf(three);
      expect([...text.matchAll(/\/Subtype \/Image/g)]).toHaveLength(3);
    });

    it('puts the info dictionary after the last page', async () => {
      const text = await textOf(three);
      expect(text).toContain('/Info 12 0 R');
      expect(text).toContain('12 0 obj\n<< /Title');
    });

    it('holds up at a page count that exercises two-digit numbering', async () => {
      // Object numbers cross from one digit to two at the fourth page, and the
      // xref entry width is fixed — a good place for an off-by-one to appear.
      const many = Array.from({ length: 9 }, (_, i) => page({ pageW: 100 + i, pageH: 200 }));
      expectXrefIntact(await textOf(many), 2 + 9 * 3 + 1);
    });
  });

  /**
   * The limit an infinite canvas walks into.
   *
   * A page is sized from the content's bounding box, so a board spread across
   * roughly twenty screens asks for a page past the 14,400pt ceiling every
   * reader enforces. Nothing guarded it, and the failure surfaced at whoever
   * opened the file rather than at the export.
   */
  describe('the page-size limit', () => {
    it('leaves an ordinary page alone', () => {
      expect(fitPageToLimit(576, 432)).toEqual({ pageW: 576, pageH: 432 });
    });

    it('brings an oversized page inside the limit', () => {
      const fitted = fitPageToLimit(18_000, 9_000);
      expect(Math.max(fitted.pageW, fitted.pageH)).toBeLessThanOrEqual(MAX_PDF_POINTS);
      expect(fitted.pageW).toBe(MAX_PDF_POINTS);
    });

    it('keeps the proportions when it shrinks one', () => {
      // Scaled, not cropped: cropping would silently drop the objects furthest
      // out, which are the reason the board got that big.
      const fitted = fitPageToLimit(18_000, 9_000);
      expect(fitted.pageW / fitted.pageH).toBeCloseTo(2, 9);
    });

    it('measures the limit on the longer side, whichever that is', () => {
      const tall = fitPageToLimit(1_000, 40_000);
      expect(tall.pageH).toBe(MAX_PDF_POINTS);
      expect(Math.max(tall.pageW, tall.pageH)).toBeLessThanOrEqual(MAX_PDF_POINTS);
    });

    it('writes the clamped size into the MediaBox, not the requested one', async () => {
      const text = await textOf([page({ pageW: 20_000, pageH: 10_000 })]);
      expect(text).not.toContain('20000');
      expect(text).toContain(`/MediaBox [0 0 ${MAX_PDF_POINTS} 7200]`);
    });

    it('keeps the content matrix in step with the clamped page', async () => {
      // The image is laid onto the page by that matrix, so a page that shrank
      // while the matrix did not would put the artwork off the sheet.
      const text = await textOf([page({ pageW: 20_000, pageH: 10_000 })]);
      expect(text).toContain(`${MAX_PDF_POINTS} 0 0 7200 0 0 cm`);
    });
  });

  describe('the information dictionary', () => {
    it('names the producer and the creation date', async () => {
      const text = await textOf([page()], 'board');
      expect(text).toContain('/Producer (Vega Studio)');
      expect(text).toMatch(/\/CreationDate \(D:\d{14}\)/);
      expect(text).toContain('/Info 6 0 R');
    });

    it('says Untitled rather than nothing when there is no title', async () => {
      expect(await textOf()).toContain('/Title (Untitled)');
    });

    /**
     * A title is a PDF string literal, and `(`, `)` and `\` end or nest one.
     * An unescaped bracket truncates the dictionary and corrupts the file — so
     * a board named "Pricing (v2)" would have produced an unopenable PDF.
     */
    it('escapes the characters that would terminate the literal', async () => {
      expect(await textOf([page()], 'Pricing (v2)')).toContain('/Title (Pricing \\(v2\\))');
    });

    it('drops non-ASCII rather than emitting bytes the encoding cannot carry', async () => {
      const text = await textOf([page()], 'café ☕ plan');
      const title = /\/Title \(([^)]*)\)/.exec(text)![1];
      // eslint-disable-next-line no-control-regex
      expect(title).not.toMatch(/[^\x20-\x7E]/);
      expect(title).toContain('plan');
    });

    it('still produces a valid xref table once a long title is present', async () => {
      expectXrefIntact(await textOf([page()], 'a-very-long-board-name-'.repeat(8)), 6);
    });
  });
});

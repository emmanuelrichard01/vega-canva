import { describe, expect, it } from 'vitest';
import { assembleDeckPdf, deckPages, deckPdfPage } from './slideDeckPdf';
import type { AnyNode } from '../model/schema';

/**
 * The deck as a PDF: which pages, in which order, at what size, and a file a
 * reader will open. The capture itself needs a stage and is not tested here;
 * the writer's own offsets are covered by `pdfWriter.test`.
 */

const frame = (id: string, x: number, extra: Record<string, unknown> = {}) =>
  ({ id, type: 'frame', x, y: 0, width: 1920, height: 1080, hidden: false, zIndex: 0, title: id.toUpperCase(), ...extra }) as unknown as AnyNode;

const objects = Object.fromEntries(
  [
    frame('c', 4000, { slideOrder: 0 }),
    frame('a', 0, { slideOrder: 1, appearance: { fill: [{ type: 'solid', color: '#14161A' }] } }),
    frame('skip', 6000, { slideOrder: 2, slideHidden: true }),
    frame('b', 2000, { slideOrder: 3 }),
    frame('inner', 100, { frameId: 'a', width: 200, height: 100 }),
  ].map((n) => [n.id, n])
);

/** Bytes as latin-1 text, so string offsets are byte offsets. */
const text = async (blob: Blob) => Array.from(new Uint8Array(await blob.arrayBuffer()), (b) => String.fromCharCode(b)).join('');

describe('the deck as pages', () => {
  it('follows the deck order, leaves out skipped slides and nested frames', () => {
    expect(deckPages(objects).map((p) => p.frameId)).toEqual(['c', 'a', 'b']);
  });

  it('paints a slide without a page colour on white, and keeps a slide its own colour', () => {
    const pages = deckPages(objects);
    expect(pages.find((p) => p.frameId === 'a')!.ground).toBe('#14161A');
    expect(pages.find((p) => p.frameId === 'b')!.ground).toBe('#FFFFFF');
  });

  it('sizes each page from the slide, not the picture, at 96 units to the inch', () => {
    const [first] = deckPages(objects);
    const page = deckPdfPage(first, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), 3840, 2160);
    expect(page.pageW).toBe(1440);
    expect(page.pageH).toBe(810);
    expect([page.pixelW, page.pixelH]).toEqual([3840, 2160]);
  });
});

describe('the file', () => {
  it('is a PDF with one page per played slide and a valid cross-reference table', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);
    const pages = deckPages(objects).map((p) => deckPdfPage(p, jpeg, 1920, 1080));
    const pdf = await text(assembleDeckPdf(pages, { title: 'Seed (round) deck' }));

    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pdf).toMatch(/\/Type\s*\/Pages[\s\S]*?\/Count 3/);
    expect(pdf.match(/\/Type\s*\/Page\b/g)).toHaveLength(3);
    expect(pdf).toContain('/MediaBox [0 0 1440 810]');

    // Every xref entry points at the object it names.
    const xrefAt = Number(/startxref\s+(\d+)/.exec(pdf)![1]);
    expect(pdf.slice(xrefAt, xrefAt + 4)).toBe('xref');
    const entries = [...pdf.slice(xrefAt).matchAll(/^(\d{10}) 00000 n\s*$/gm)].map((m) => Number(m[1]));
    expect(entries.length).toBeGreaterThan(3);
    entries.forEach((offset, i) => expect(pdf.slice(offset).startsWith(`${i + 1} 0 obj`)).toBe(true));
    // A title with brackets is escaped, not allowed to close the string early.
    expect(pdf).toContain('Seed \\(round\\) deck');
  });
});

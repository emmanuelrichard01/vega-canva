import { buildPdf, type PdfMeta, type PdfPage } from './pdfWriter';
import { buildPdfWithWorker, encodeCanvasWithWorker } from './exportWorkerClient';
import { throwIfAborted } from './abort';
import { deckOf } from '../slides/deck';
import { captureSlide } from '../slides/slideRaster';
import { solidFill } from '../slides/themes';
import type { AnyNode, FrameNode } from '../model/schema';
import { useStore } from '../../hooks/useStore';

/**
 * The deck as a PDF: one page per slide, in presentation order, at slide
 * resolution.
 *
 * Unlike the board's PDF export, which takes every frame in stacking order,
 * this is the deck as it is presented: skipped slides are left out, frames
 * nested inside a slide are part of that slide rather than pages of their
 * own, and unfilled placeholders are not printed. The page is the slide's own
 * size at 96 units to the inch, so a 1920×1080 slide is a 20×11.25 inch page
 * holding a 1920×1080 picture.
 *
 * Each page is captured through the same raster path as a PNG export and
 * handed to the hand-written writer in `pdfWriter`, so a deck adds no
 * dependency. Loaded on demand: nothing here is in the room's first chunk.
 */

const POINTS_PER_UNIT = 72 / 96;

export interface DeckPage {
  frameId: string;
  title: string;
  width: number;
  height: number;
  /** The page colour, painted under the slide so a transparent frame prints on white. */
  ground: string;
}

/** The pages a deck prints, in order. */
export function deckPages(objects: Record<string, AnyNode>): DeckPage[] {
  return deckOf(objects)
    .filter((s) => !s.hidden)
    .map(({ frame }) => ({
      frameId: frame.id,
      title: (frame as FrameNode).title || 'Untitled slide',
      width: frame.width,
      height: frame.height,
      ground: solidFill(frame as FrameNode) ?? '#FFFFFF',
    }));
}

/** A page from captured JPEG bytes; sized from the slide, not the bitmap, so the scale never changes the paper. */
export function deckPdfPage(page: DeckPage, jpeg: Uint8Array, pixelW: number, pixelH: number): PdfPage {
  return { jpeg, pixelW, pixelH, pageW: page.width * POINTS_PER_UNIT, pageH: page.height * POINTS_PER_UNIT };
}

/** Assemble pages into a file on this thread. The worker path below falls back to the same writer. */
export function assembleDeckPdf(pages: PdfPage[], meta: PdfMeta = {}): Blob {
  return buildPdf(pages, meta);
}

export interface DeckExportProgress {
  done: number;
  total: number;
}

/**
 * Capture and write the whole deck. `onProgress` hears about each page, so a
 * long deck can show how far along it is; `signal` cancels between slides,
 * rejecting with an `AbortError` (see `abort.ts`).
 */
export async function exportDeckPdf(
  title: string | undefined,
  onProgress?: (p: DeckExportProgress) => void,
  signal?: AbortSignal
): Promise<Blob> {
  const pages = deckPages(useStore.getState().objects as Record<string, AnyNode>);
  if (pages.length === 0) throw new Error('There are no slides to export. Add a frame, or show a skipped slide.');
  const out: PdfPage[] = [];
  for (const [i, page] of pages.entries()) {
    // Between slides, never inside a capture: a capture borrows the stage.
    throwIfAborted(signal);
    const canvas = await captureSlide(page.frameId, { scale: 1 });
    if (!canvas) throw new Error('The board is not ready to draw yet. Try again in a moment.');
    const jpeg = await encodeCanvasWithWorker(canvas, page.ground, 'image/jpeg', 0.92);
    out.push(deckPdfPage(page, new Uint8Array(await jpeg.arrayBuffer()), canvas.width, canvas.height));
    onProgress?.({ done: i + 1, total: pages.length });
  }
  throwIfAborted(signal);
  return buildPdfWithWorker(out, { title });
}

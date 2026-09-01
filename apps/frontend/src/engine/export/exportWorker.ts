import { buildPdf, type PdfMeta, type PdfPage } from './pdfWriter';

export interface CompositeAndEncodeRequest {
  id: string;
  type: 'COMPOSITE_AND_ENCODE';
  bitmap: ImageBitmap;
  width: number;
  height: number;
  background?: string | null;
  mime: string;
  quality?: number;
}

export interface BuildPdfRequest {
  id: string;
  type: 'BUILD_PDF';
  pages: {
    jpeg: Uint8Array;
    pixelW: number;
    pixelH: number;
    pageW: number;
    pageH: number;
  }[];
  meta: PdfMeta;
}

export type ExportWorkerRequest = CompositeAndEncodeRequest | BuildPdfRequest;

export interface ExportWorkerResponse {
  id: string;
  success: boolean;
  arrayBuffer?: ArrayBuffer;
  mime?: string;
  error?: string;
}

self.onmessage = async (e: MessageEvent<ExportWorkerRequest>) => {
  const req = e.data;
  if (!req || !req.id) return;

  try {
    if (req.type === 'COMPOSITE_AND_ENCODE') {
      const { bitmap, width, height, background, mime, quality } = req;
      const offscreen = new OffscreenCanvas(width, height);
      const ctx = offscreen.getContext('2d');
      if (!ctx) {
        bitmap.close();
        throw new Error('Failed to obtain 2D rendering context on OffscreenCanvas');
      }

      ctx.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();

      if (background) {
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, width, height);
      }

      const blob = await offscreen.convertToBlob({ type: mime, quality });
      const arrayBuffer = await blob.arrayBuffer();

      const response: ExportWorkerResponse = {
        id: req.id,
        success: true,
        arrayBuffer,
        mime,
      };
      (self as unknown as { postMessage: (msg: unknown, transfer?: Transferable[]) => void }).postMessage(
        response,
        [arrayBuffer]
      );
      return;
    }

    if (req.type === 'BUILD_PDF') {
      const pages: PdfPage[] = req.pages.map((p) => ({
        jpeg: p.jpeg,
        pixelW: p.pixelW,
        pixelH: p.pixelH,
        pageW: p.pageW,
        pageH: p.pageH,
      }));

      const blob = buildPdf(pages, req.meta);
      const arrayBuffer = await blob.arrayBuffer();

      const response: ExportWorkerResponse = {
        id: req.id,
        success: true,
        arrayBuffer,
        mime: 'application/pdf',
      };
      (self as unknown as { postMessage: (msg: unknown, transfer?: Transferable[]) => void }).postMessage(
        response,
        [arrayBuffer]
      );
      return;
    }

    throw new Error(`Unknown export worker request type`);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const response: ExportWorkerResponse = {
      id: req.id,
      success: false,
      error: errorMsg,
    };
    (self as unknown as { postMessage: (msg: unknown) => void }).postMessage(response);
  }
};

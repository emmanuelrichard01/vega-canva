import { nanoid } from 'nanoid';
import { canvasToBlob } from './raster';
import { buildPdf, type PdfMeta, type PdfPage } from './pdfWriter';
import type { ExportWorkerRequest, ExportWorkerResponse } from './exportWorker';

let workerInstance: Worker | null = null;
const pendingRequests = new Map<string, { resolve: (blob: Blob) => void; reject: (err: Error) => void }>();

function isWorkerSupported(): boolean {
  return (
    typeof Worker !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined' &&
    typeof createImageBitmap !== 'undefined'
  );
}

function getWorker(): Worker | null {
  if (!isWorkerSupported()) return null;
  if (!workerInstance) {
    try {
      workerInstance = new Worker(new URL('./exportWorker.ts', import.meta.url), {
        type: 'module',
      });
      workerInstance.onmessage = (e: MessageEvent<ExportWorkerResponse>) => {
        const { id, success, arrayBuffer, mime, error } = e.data;
        const pending = pendingRequests.get(id);
        if (!pending) return;
        pendingRequests.delete(id);

        if (success && arrayBuffer && mime) {
          pending.resolve(new Blob([arrayBuffer], { type: mime }));
        } else {
          pending.reject(new Error(error || 'Export worker failed'));
        }
      };
      workerInstance.onerror = (err) => {
        console.error('Export worker error:', err);
      };
    } catch (e) {
      console.warn('Failed to initialize export worker, falling back to main thread', e);
      workerInstance = null;
    }
  }
  return workerInstance;
}

/**
 * Composite background and encode canvas using Web Worker OffscreenCanvas.
 * Falls back cleanly to main-thread processing when workers are not available.
 */
export async function encodeCanvasWithWorker(
  canvas: HTMLCanvasElement,
  background: string | null | undefined,
  mime: string,
  quality?: number
): Promise<Blob> {
  const worker = getWorker();
  if (worker) {
    try {
      const bitmap = await createImageBitmap(canvas);
      const id = nanoid();
      return await new Promise<Blob>((resolve, reject) => {
        pendingRequests.set(id, { resolve, reject });
        const request: ExportWorkerRequest = {
          id,
          type: 'COMPOSITE_AND_ENCODE',
          bitmap,
          width: canvas.width,
          height: canvas.height,
          background,
          mime,
          quality,
        };
        worker.postMessage(request, [bitmap]);
      });
    } catch (err) {
      console.warn('Worker canvas encoding failed, falling back to main thread:', err);
    }
  }

  // Fallback: main-thread compositing and encoding
  if (!background) {
    return canvasToBlob(canvas, mime, quality);
  }

  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext('2d');
  if (!ctx) {
    return canvasToBlob(canvas, mime, quality);
  }

  ctx.drawImage(canvas, 0, 0);
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, out.width, out.height);

  return canvasToBlob(out, mime, quality);
}

/**
 * Assembles and compiles multi-page PDF in the Web Worker.
 * Falls back to main thread PDF construction when worker is unavailable.
 */
export async function buildPdfWithWorker(pages: PdfPage[], meta: PdfMeta): Promise<Blob> {
  const worker = getWorker();
  if (worker) {
    try {
      const id = nanoid();
      return await new Promise<Blob>((resolve, reject) => {
        pendingRequests.set(id, { resolve, reject });
        const request: ExportWorkerRequest = {
          id,
          type: 'BUILD_PDF',
          pages: pages.map((p) => ({
            jpeg: p.jpeg,
            pixelW: p.pixelW,
            pixelH: p.pixelH,
            pageW: p.pageW,
            pageH: p.pageH,
          })),
          meta,
        };
        worker.postMessage(request);
      });
    } catch (err) {
      console.warn('Worker PDF building failed, falling back to main thread:', err);
    }
  }

  return buildPdf(pages, meta);
}

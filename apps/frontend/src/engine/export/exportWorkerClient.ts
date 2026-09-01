import { nanoid } from 'nanoid';
import { canvasToBlob } from './raster';
import { buildPdf, type PdfMeta, type PdfPage } from './pdfWriter';
import type { ExportWorkerRequest, ExportWorkerResponse } from './exportWorker';
import { createExportWorker } from './exportWorkerFactory';

/**
 * Main-thread side of the export worker.
 *
 * ## Every request must be able to settle
 *
 * The first version registered a pending promise, posted the message, and
 * relied entirely on a matching `onmessage` to resolve it. `onerror` only
 * called `console.error`. So a worker that died -- threw at module scope,
 * was terminated, ran out of memory on a large board -- left its promise
 * pending forever: the export spinner ran for the rest of the session, the
 * map leaked an entry per attempt, and the main-thread fallback a few lines
 * below was unreachable for the one failure most likely to happen in the
 * wild. The `try/catch` around the `await` could not help, because nothing
 * ever threw.
 *
 * Two things fix that, and both are needed. `failAll` settles everything
 * outstanding when the worker reports an error, and a per-request timeout
 * covers the case a dead worker never reports at all. Both reject, which is
 * what hands the work back to the main thread rather than to nobody.
 */

let workerInstance: Worker | null = null;
const pendingRequests = new Map<
  string,
  { resolve: (blob: Blob) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }
>();

/**
 * Long enough that a genuinely large export is not cut off, short enough that
 * a wedged worker does not read as a hung application. Encoding a poster-sized
 * canvas is seconds; a minute is not a slow export, it is a broken one.
 */
const REQUEST_TIMEOUT_MS = 60_000;

function settle(id: string): { resolve: (b: Blob) => void; reject: (e: Error) => void } | null {
  const pending = pendingRequests.get(id);
  if (!pending) return null;
  clearTimeout(pending.timer);
  pendingRequests.delete(id);
  return pending;
}

/**
 * Reject everything outstanding and drop the worker.
 *
 * The instance is discarded rather than reused: whatever killed it is likely
 * to kill the next request too, and a fresh one is created on demand. Callers
 * see a rejection and take the main-thread path.
 */
function failAll(reason: string): void {
  const queued = [...pendingRequests.values()];
  pendingRequests.clear();
  for (const { reject, timer } of queued) {
    clearTimeout(timer);
    reject(new Error(reason));
  }

  if (workerInstance) {
    workerInstance.terminate();
    workerInstance = null;
  }
}

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
      workerInstance = createExportWorker();
      workerInstance.onmessage = (e: MessageEvent<ExportWorkerResponse>) => {
        const { id, success, arrayBuffer, mime, error } = e.data;
        const pending = settle(id);
        if (!pending) return;

        if (success && arrayBuffer && mime) {
          pending.resolve(new Blob([arrayBuffer], { type: mime }));
        } else {
          pending.reject(new Error(error || 'Export worker failed'));
        }
      };
      workerInstance.onerror = (err) => {
        console.error('Export worker error:', err);
        failAll('Export worker failed');
      };
      // A response that could not be deserialised. Rare, and indistinguishable
      // from a dead worker as far as the waiting caller is concerned.
      workerInstance.onmessageerror = () => {
        failAll('Export worker sent a message that could not be read');
      };
    } catch (e) {
      console.warn('Failed to initialize export worker, falling back to main thread', e);
      workerInstance = null;
    }
  }
  return workerInstance;
}

/**
 * Post a request and wait for the response that carries the same id.
 *
 * The timeout is the backstop for a worker that stops answering without ever
 * firing `onerror` -- which is what a hung or killed worker looks like.
 */
function request(worker: Worker, message: ExportWorkerRequest, transfer?: Transferable[]): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    const timer = setTimeout(() => {
      settle(message.id);
      reject(new Error('Export worker timed out'));
    }, REQUEST_TIMEOUT_MS);

    pendingRequests.set(message.id, { resolve, reject, timer });

    try {
      worker.postMessage(message, transfer ?? []);
    } catch (err) {
      // A structured-clone failure throws here, synchronously, and would
      // otherwise leave the entry we just registered waiting for the timeout.
      settle(message.id);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
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
      return await request(
        worker,
        {
          id: nanoid(),
          type: 'COMPOSITE_AND_ENCODE',
          bitmap,
          width: canvas.width,
          height: canvas.height,
          background,
          mime,
          quality,
        },
        [bitmap]
      );
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
      return await request(worker, {
        id: nanoid(),
        type: 'BUILD_PDF',
        pages: pages.map((p) => ({
          jpeg: p.jpeg,
          pixelW: p.pixelW,
          pixelH: p.pixelH,
          pageW: p.pageW,
          pageH: p.pageH,
        })),
        meta,
      });
    } catch (err) {
      console.warn('Worker PDF building failed, falling back to main thread:', err);
    }
  }

  return buildPdf(pages, meta);
}

import path from 'path';
import { Worker } from 'worker_threads';
import { renderPng } from './rasterCore';

/**
 * SVG to PNG, off the event loop.
 *
 * A card render is a few hundred milliseconds of synchronous WebAssembly, and
 * this process also carries every board's WebSocket traffic. In the compiled
 * server the render runs on one worker thread; under tsx or a test runner,
 * where there is no compiled worker file to start, it runs in-process.
 */

interface Pending {
  resolve: (png: Buffer) => void;
  reject: (err: Error) => void;
}

const workerFile = path.join(__dirname, 'raster.worker.js');
const canUseWorker = typeof __filename !== 'undefined' && __filename.endsWith('.js');

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function failAll(err: Error): void {
  for (const job of pending.values()) job.reject(err);
  pending.clear();
  worker = null;
}

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(workerFile);
  w.unref();
  w.on('message', (msg: { id: number; png?: Uint8Array; error?: string }) => {
    const job = pending.get(msg.id);
    if (!job) return;
    pending.delete(msg.id);
    if (pending.size === 0) w.unref();
    if (msg.png) job.resolve(Buffer.from(msg.png));
    else job.reject(new Error(msg.error ?? 'render failed'));
  });
  w.on('error', (err) => failAll(err));
  w.on('exit', (code) => {
    if (worker === w) failAll(new Error(`raster worker exited with code ${code}`));
  });
  worker = w;
  return w;
}

/**
 * Renders already waiting. A burst of distinct cards — a crawler walking
 * many boards at once — queues on one thread; past this depth a caller should
 * answer with something it already has rather than join the queue.
 */
export const MAX_QUEUED_RENDERS = 6;
let inProcess = 0;

export function rasterBusy(): boolean {
  return pending.size + inProcess >= MAX_QUEUED_RENDERS;
}

export async function svgToPng(svg: string, width?: number): Promise<Buffer> {
  if (!canUseWorker) {
    inProcess++;
    try {
      return Buffer.from(await renderPng(svg, width));
    } finally {
      inProcess--;
    }
  }
  return new Promise<Buffer>((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    const w = getWorker();
    // Held open only while it has work, so an idle worker never keeps the
    // process alive and a pending render is never abandoned at exit.
    w.ref();
    w.postMessage({ id, svg, width });
  });
}

/** Stop the worker, for shutdown. */
export async function closeRaster(): Promise<void> {
  const w = worker;
  worker = null;
  if (w) await w.terminate();
}

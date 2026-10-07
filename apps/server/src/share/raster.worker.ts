import { parentPort } from 'worker_threads';
import { renderPng } from './rasterCore';

/** One render at a time, on its own thread. See `raster.ts`. */
parentPort?.on('message', async (job: { id: number; svg: string; width?: number }) => {
  try {
    const png = await renderPng(job.svg, job.width);
    parentPort?.postMessage({ id: job.id, png }, [png.buffer as ArrayBuffer]);
  } catch (err) {
    parentPort?.postMessage({ id: job.id, error: String((err as Error)?.message ?? err) });
  }
});

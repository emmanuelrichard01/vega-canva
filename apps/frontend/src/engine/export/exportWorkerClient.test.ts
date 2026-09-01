import { describe, it, expect, vi, afterEach } from 'vitest';
import type { PdfPage } from './pdfWriter';

/**
 * The worker constructor is mocked rather than stubbed on `globalThis`.
 *
 * Vite rewrites `new Worker(new URL(...))` at transform time into its own
 * plumbing, so replacing the global `Worker` never reaches the constructor
 * that actually runs -- the first attempt at these tests hung on a real
 * worker instead. `exportWorkerFactory.ts` exists to be mocked here.
 */
const workerFactory = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('./exportWorkerFactory', () => ({
  createExportWorker: () => workerFactory.create(),
}));

/**
 * These build a real PDF on the main thread, which is genuine CPU work, and
 * vitest runs files in parallel -- so the default 5s is not a statement about
 * this code, it is a statement about what else the machine was doing. The
 * suite already learned this once from a 10,000-node benchmark starving an
 * unrelated source scan past its timeout.
 */
const SLOW = 20_000;

const PAGE: PdfPage = {
  jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
  pixelW: 100,
  pixelH: 100,
  pageW: 72,
  pageH: 72,
};

function dummyCanvas(): HTMLCanvasElement {
  return {
    width: 200,
    height: 100,
    toBlob: vi.fn((cb: BlobCallback) => cb(new Blob(['image-bytes'], { type: 'image/png' }))),
  } as unknown as HTMLCanvasElement;
}

/**
 * A stand-in Worker whose behaviour each test chooses.
 *
 * `getWorker` caches its instance at module scope, so every test imports the
 * client fresh -- otherwise a worker installed by one test answers the next.
 */
function installWorker(behaviour: 'error' | 'silent' | 'reply' | 'throw-on-post' | 'absent') {
  const terminate = vi.fn();

  class FakeWorker {
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    terminate = terminate;

    constructor() {
      if (behaviour === 'error') {
        // Asynchronously, as a real worker failing at module scope would.
        queueMicrotask(() => this.onerror?.(new Error('worker blew up')));
      }
    }

    postMessage(message: { id: string }) {
      if (behaviour === 'throw-on-post') throw new DOMException('could not be cloned');
      if (behaviour === 'reply') {
        queueMicrotask(() =>
          this.onmessage?.({
            data: {
              id: message.id,
              success: true,
              arrayBuffer: new Uint8Array([1, 2, 3]).buffer,
              mime: 'application/pdf',
            },
          } as MessageEvent)
        );
      }
      // 'silent' and 'error' deliberately never answer.
    }
  }

  // `isWorkerSupported()` gates on all three before the factory is reached.
  vi.stubGlobal('Worker', class {});
  vi.stubGlobal('OffscreenCanvas', class {});
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({}) as ImageBitmap));

  if (behaviour === 'absent') {
    workerFactory.create.mockImplementation(() => {
      throw new Error('Worker construction failed');
    });
  } else {
    workerFactory.create.mockImplementation(() => new FakeWorker() as unknown as Worker);
  }

  return { terminate };
}

async function freshClient() {
  vi.resetModules();
  return import('./exportWorkerClient');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  workerFactory.create.mockReset();
});

describe('exportWorkerClient without a worker', () => {
  it('falls back when the worker cannot be constructed at all', async () => {
    installWorker('absent');
    const { buildPdfWithWorker } = await freshClient();

    const pdf = await buildPdfWithWorker([PAGE], { title: 'Test Document' });

    expect(pdf.type).toBe('application/pdf');
  }, SLOW);

  it('encodes on the main thread when Workers or OffscreenCanvas are absent', async () => {
    const { encodeCanvasWithWorker } = await freshClient();

    const blob = await encodeCanvasWithWorker(dummyCanvas(), null, 'image/png');

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
  }, SLOW);

  it('builds a PDF on the main thread', async () => {
    const { buildPdfWithWorker } = await freshClient();

    const pdf = await buildPdfWithWorker([PAGE], { title: 'Test Document' });

    expect(pdf.type).toBe('application/pdf');
    expect(pdf.size).toBeGreaterThan(0);
  }, SLOW);
});

describe('exportWorkerClient when the worker fails', () => {
  /**
   * The bug all of this exists for: `onerror` used to only `console.error`,
   * and pending promises were settled solely by a matching `onmessage`. A
   * worker that died left its promise pending forever -- the spinner ran for
   * the rest of the session and the main-thread fallback below was
   * unreachable for the failure most likely to happen in the wild.
   */

  it('rejects outstanding work when the worker errors, and falls back', async () => {
    installWorker('error');
    const { buildPdfWithWorker } = await freshClient();

    const pdf = await buildPdfWithWorker([PAGE], { title: 'Test Document' });

    // Not a hang, and not a rejection reaching the caller: a real PDF, built
    // on the main thread.
    expect(pdf.type).toBe('application/pdf');
    expect(pdf.size).toBeGreaterThan(0);
  }, SLOW);

  it('discards the dead worker rather than reusing it', async () => {
    const { terminate } = installWorker('error');
    const { buildPdfWithWorker } = await freshClient();

    await buildPdfWithWorker([PAGE], { title: 'One' });

    // Whatever killed it will likely kill the next request too.
    expect(terminate).toHaveBeenCalled();
  }, SLOW);

  it('falls back when the worker never answers at all', async () => {
    // A hung or killed worker fires no `onerror`; only the timeout covers it.
    vi.useFakeTimers();
    installWorker('silent');
    const { buildPdfWithWorker } = await freshClient();

    const inFlight = buildPdfWithWorker([PAGE], { title: 'Test Document' });
    await vi.advanceTimersByTimeAsync(61_000);

    const pdf = await inFlight;
    expect(pdf.type).toBe('application/pdf');
  }, SLOW);

  it('falls back when postMessage throws synchronously', async () => {
    // A structured-clone failure throws on the spot, and would otherwise
    // leave the entry just registered waiting out the whole timeout.
    installWorker('throw-on-post');
    const { buildPdfWithWorker } = await freshClient();

    const pdf = await buildPdfWithWorker([PAGE], { title: 'Test Document' });

    expect(pdf.type).toBe('application/pdf');
  }, SLOW);
});

describe('exportWorkerClient when the worker answers', () => {
  it('returns what the worker produced', async () => {
    installWorker('reply');
    const { buildPdfWithWorker } = await freshClient();

    const pdf = await buildPdfWithWorker([PAGE], { title: 'Test Document' });

    // Three bytes, from the stub -- not the main thread's much larger PDF.
    expect(pdf.size).toBe(3);
    expect(pdf.type).toBe('application/pdf');
  }, SLOW);

  it('clears the timeout once a request has settled', async () => {
    vi.useFakeTimers();
    installWorker('reply');
    const { buildPdfWithWorker } = await freshClient();

    const before = vi.getTimerCount();
    await buildPdfWithWorker([PAGE], { title: 'Test Document' });

    // A surviving timeout would fire into an empty map, or worse, settle a
    // later request that had reused the slot.
    expect(vi.getTimerCount()).toBe(before);
  }, SLOW);
});

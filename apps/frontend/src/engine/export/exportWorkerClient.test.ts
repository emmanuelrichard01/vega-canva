import { describe, it, expect, vi } from 'vitest';
import { encodeCanvasWithWorker, buildPdfWithWorker } from './exportWorkerClient';
import type { PdfPage } from './pdfWriter';

describe('exportWorkerClient', () => {
  it('falls back to main thread when Web Workers or OffscreenCanvas are absent', async () => {
    const dummyCanvas = {
      width: 200,
      height: 100,
      toBlob: vi.fn((cb) => cb(new Blob(['image-bytes'], { type: 'image/png' }))),
    } as unknown as HTMLCanvasElement;

    const blob = await encodeCanvasWithWorker(dummyCanvas, null, 'image/png');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
  });

  it('builds PDF using fallback when worker is absent', async () => {
    const page: PdfPage = {
      jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
      pixelW: 100,
      pixelH: 100,
      pageW: 72,
      pageH: 72,
    };

    const pdfBlob = await buildPdfWithWorker([page], { title: 'Test Document' });
    expect(pdfBlob).toBeInstanceOf(Blob);
    expect(pdfBlob.type).toBe('application/pdf');
    expect(pdfBlob.size).toBeGreaterThan(0);
  });
});

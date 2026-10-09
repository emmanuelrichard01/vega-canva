import { crc32 } from './crc32';
import { abortError } from './abort';

/**
 * A PNG written a band of rows at a time.
 *
 * The browser's own encoder needs the whole picture in one canvas, and a
 * canvas has a ceiling (`rasterLimits`). This writes the format directly: the
 * signature, an `IHDR`, the pixel rows (each prefixed with filter type 0)
 * through the platform's zlib (`CompressionStream('deflate')`, which is the
 * exact stream PNG's `IDAT` carries), and `IEND`. Only the band being drawn
 * and the compressed output are ever held, so a board far past the ceiling
 * exports at the density asked for instead of a quietly smaller one.
 *
 * Pure of the stage: the caller supplies each band's RGBA, which is what
 * makes the format testable without a canvas.
 */

const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function header(width: number, height: number): Uint8Array {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  data[8] = 8; // bit depth
  data[9] = 6; // RGBA
  data[10] = 0; // deflate
  data[11] = 0; // adaptive filtering
  data[12] = 0; // no interlace
  return chunk('IHDR', data);
}

export interface TiledPngOptions {
  /** Rows per band; the last band may be shorter. */
  bandHeight: number;
  signal?: AbortSignal;
  onProgress?: (progress: { done: number; total: number }) => void;
}

/** Each band's pixels, `width × rows × 4` bytes, top to bottom. */
export type BandSource = (y: number, rows: number) => Uint8ClampedArray | Uint8Array | Promise<Uint8ClampedArray | Uint8Array>;


/** The IDAT payload most readers are happiest with, and well inside the format's 2³¹ limit. */
const IDAT_MAX = 1 << 20;

export async function encodeTiledPng(width: number, height: number, band: BandSource, options: TiledPngOptions): Promise<Blob> {
  if (typeof CompressionStream === 'undefined') throw new Error('This browser cannot write a large PNG. Try a smaller scale.');
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const stride = w * 4;
  const rowsPer = Math.max(1, Math.floor(options.bandHeight));
  const total = Math.ceil(h / rowsPer);

  const stream = new CompressionStream('deflate');
  const writer = stream.writable.getWriter();
  // Read concurrently, or the writer stalls once its queue fills.
  const compressed = new Response(stream.readable).arrayBuffer();

  try {
    for (let i = 0, y = 0; y < h; i++, y += rowsPer) {
      if (options.signal?.aborted) throw abortError();
      const rows = Math.min(rowsPer, h - y);
      const pixels = await band(y, rows);
      if (pixels.length < rows * stride) throw new Error('A band of the image came back short.');
      const filtered = new Uint8Array(rows * (stride + 1));
      for (let r = 0; r < rows; r++) {
        // Filter type 0 (none) leads each row.
        filtered.set(pixels.subarray(r * stride, (r + 1) * stride), r * (stride + 1) + 1);
      }
      await writer.write(filtered);
      options.onProgress?.({ done: i + 1, total });
      // A macrotask between bands, so the page paints and input is handled
      // while a large export runs.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    await writer.close();
  } catch (error) {
    await writer.abort(error).catch(() => undefined);
    await compressed.catch(() => undefined);
    throw error;
  }

  const zlib = new Uint8Array(await compressed);
  const parts: Uint8Array[] = [SIGNATURE, header(w, h)];
  for (let at = 0; at < zlib.length; at += IDAT_MAX) parts.push(chunk('IDAT', zlib.subarray(at, at + IDAT_MAX)));
  parts.push(chunk('IEND', new Uint8Array()));
  return new Blob(parts as BlobPart[], { type: 'image/png' });
}

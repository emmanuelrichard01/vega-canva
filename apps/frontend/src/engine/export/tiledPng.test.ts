import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { encodeTiledPng } from './tiledPng';
import { crc32 } from './crc32';
import { MAX_CANVAS_AREA, MAX_CANVAS_EDGE, MAX_TILED_AREA, bandColumns, bandHeight, plannedScale } from './rasterLimits';

/**
 * A PNG written a band at a time: a reader must see one ordinary image, every
 * chunk's checksum must hold, and the rows must come back exactly as drawn.
 */

function readPng(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks: Array<{ type: string; data: Uint8Array }> = [];
  let at = 8;
  while (at < bytes.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const data = bytes.subarray(at + 8, at + 8 + length);
    expect(view.getUint32(at + 8 + length), `${type} checksum`).toBe(crc32(bytes.subarray(at + 4, at + 8 + length)));
    chunks.push({ type, data });
    at += 12 + length;
  }
  return chunks;
}

/** A gradient that differs on every pixel, so a misplaced row or column shows. */
function picture(width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      out.set([x * 9 % 256, y * 13 % 256, (x + y) % 256, 255 - (x % 7)], i);
    }
  }
  return out;
}

describe('encodeTiledPng', () => {
  it('writes a valid PNG whose rows are the bands, in order', async () => {
    const width = 5;
    const height = 7;
    const pixels = picture(width, height);
    const asked: Array<[number, number]> = [];
    const blob = await encodeTiledPng(
      width,
      height,
      (y, rows) => {
        asked.push([y, rows]);
        return pixels.subarray(y * width * 4, (y + rows) * width * 4);
      },
      { bandHeight: 3 }
    );
    expect(asked).toEqual([[0, 3], [3, 3], [6, 1]]);
    expect(blob.type).toBe('image/png');

    const chunks = readPng(new Uint8Array(await blob.arrayBuffer()));
    expect(chunks[0].type).toBe('IHDR');
    expect(chunks[chunks.length - 1].type).toBe('IEND');
    const ihdr = new DataView(chunks[0].data.buffer, chunks[0].data.byteOffset);
    expect([ihdr.getUint32(0), ihdr.getUint32(4), chunks[0].data[8], chunks[0].data[9]]).toEqual([5, 7, 8, 6]);

    const zlib = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => Buffer.from(c.data)));
    const raw = inflateSync(zlib);
    expect(raw.length).toBe(height * (width * 4 + 1));
    for (let y = 0; y < height; y++) {
      const row = raw.subarray(y * (width * 4 + 1), (y + 1) * (width * 4 + 1));
      expect(row[0]).toBe(0);
      expect([...row.subarray(1)]).toEqual([...pixels.subarray(y * width * 4, (y + 1) * width * 4)]);
    }
  });

  it('reports each band and stops between bands when cancelled', async () => {
    const controller = new AbortController();
    const seen: number[] = [];
    const run = encodeTiledPng(4, 10, (_y, rows) => new Uint8Array(4 * rows * 4), {
      bandHeight: 2,
      signal: controller.signal,
      onProgress: (p) => {
        seen.push(p.done);
        if (p.done === 2) controller.abort();
      },
    });
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(seen).toEqual([1, 2]);
  });

  it('refuses a band that comes back short rather than writing a torn image', async () => {
    await expect(encodeTiledPng(4, 4, () => new Uint8Array(8), { bandHeight: 4 })).rejects.toThrow(/short/);
  });
});

describe('tiling limits', () => {
  it('tiles a PNG past the single-canvas ceiling instead of shrinking it', () => {
    // 3000 × 3000 at 2× is 36 megapixels: over one canvas, under the tiled guard.
    const single = plannedScale(3000, 3000, 2, false);
    expect(single.tiled).toBe(false);
    expect(single.scale).toBeLessThan(2);
    expect(plannedScale(3000, 3000, 2, true)).toEqual({ scale: 2, tiled: true });
  });

  it('stops at the tiled guard, and never tiles what fits in one canvas', () => {
    const big = plannedScale(6_000, 6_000, 4, true);
    expect(big.tiled).toBe(true);
    expect(big.scale).toBeLessThan(4);
    expect(6_000 * big.scale * 6_000 * big.scale).toBeLessThanOrEqual(MAX_TILED_AREA + 1);
    // Past the guard at its own size, a board is drawn at 1:1 in tiles rather than shrunk.
    expect(plannedScale(10_000, 10_000, 4, true)).toEqual({ scale: 1, tiled: true });
    expect(plannedScale(800, 600, 2, true)).toEqual({ scale: 2, tiled: false });
    expect(800 * 600 * 4).toBeLessThan(MAX_CANVAS_AREA);
  });

  it('splits a band into columns no wider than a canvas may be, covering every pixel once', () => {
    const columns = bandColumns(20_000);
    expect(columns.every((c) => c.width <= MAX_CANVAS_EDGE)).toBe(true);
    expect(columns.reduce((sum, c) => sum + c.width, 0)).toBe(20_000);
    columns.slice(1).forEach((c, i) => expect(c.x).toBe(columns[i].x + columns[i].width));
    expect(bandHeight(20_000) * 20_000 * 4).toBeLessThanOrEqual(4_194_304 * 4 + 20_000 * 4 * 64);
  });
});

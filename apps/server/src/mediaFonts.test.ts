import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { Readable } from 'stream';
import { createApp } from './app';
import { IpDailyByteTracker } from './quota';
import { fakePool, testConfig } from './testSupport';
import { MAX_FONT_BYTES, isAllowedUpload, isFontKey, safeExtension, serveAs } from './media';

/**
 * Uploaded fonts: accepted under their canonical types, capped tighter than
 * other media, and served as fonts so `FontFace` will load them.
 */

const ROOM = 'fontRoom0001';

let server: Server | null = null;
let tracker: IpDailyByteTracker | null = null;

afterEach(async () => {
  tracker?.stop();
  if (server) await new Promise((r) => server!.close(r));
  server = null;
});

/** Stores under the extension the real upload path would choose. */
function keyedStorage(written: string[]) {
  return {
    _handleFile(_req: any, file: any, cb: any) {
      let size = 0;
      file.stream.on('data', (chunk: Buffer) => (size += chunk.length));
      file.stream.on('end', () => {
        const key = `${ROOM}/f${written.length}${safeExtension(file.originalname)}`;
        written.push(key);
        cb(null, { key, size });
      });
    },
    _removeFile(_req: any, _file: any, cb: any) {
      cb(null);
    },
  };
}

async function start(mediaRows: string[] = []) {
  const config = testConfig({});
  const pool = fakePool([
    [/SUM\(size_bytes\)/, () => ({ rows: [{ total: '0' }] })],
    [/SELECT 1 FROM media_refs/, (p) => ({ rows: mediaRows.includes(String(p[1])) ? [{}] : [] })],
  ]);
  const s3 = { send: vi.fn(async () => ({})) };
  const written: string[] = [];
  tracker = new IpDailyByteTracker();
  const app = createApp({
    config,
    pool: pool as any,
    s3: s3 as any,
    bucket: 'bucket',
    sharedRedis: null,
    sessionSecret: config.sessionSecret!,
    quota: tracker,
    health: {
      databaseReady: async () => true,
      draining: () => false,
      historyDepth: () => 0,
      historyDropped: () => 0,
    },
    reap: vi.fn(async () => ({ reapedRooms: 0, roomIds: [], deletedObjects: 0, freedBytes: 0, dryRun: true })),
    storage: keyedStorage(written) as any,
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server!.once('listening', r));
  const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  return { base, s3, written, pool };
}

function uploadFont(base: string, bytes: number, name: string, type: string) {
  const form = new FormData();
  form.append('media', new Blob([new Uint8Array(bytes)], { type }), name);
  return fetch(`${base}/rooms/${ROOM}/media`, { method: 'POST', body: form });
}

describe('font media table', () => {
  it('accepts the four web font formats under their canonical types', () => {
    expect(isAllowedUpload('font/woff2', 'Brand.woff2')).toBe(true);
    expect(isAllowedUpload('font/woff', 'Brand.woff')).toBe(true);
    expect(isAllowedUpload('font/ttf', 'Brand.ttf')).toBe(true);
    expect(isAllowedUpload('font/otf', 'Brand.otf')).toBe(true);
  });

  it('refuses collections and mismatched pairs', () => {
    expect(isAllowedUpload('font/collection', 'Brand.ttc')).toBe(false);
    expect(isAllowedUpload('font/woff2', 'Brand.ttc')).toBe(false);
    expect(isAllowedUpload('application/octet-stream', 'Brand.woff2')).toBe(false);
  });

  it('serves fonts as fonts', () => {
    expect(serveAs('room/x.woff2')).toEqual({ type: 'font/woff2', render: true });
    expect(serveAs('room/x.ttf')).toEqual({ type: 'font/ttf', render: true });
    expect(isFontKey('room/x.OTF')).toBe(true);
    expect(isFontKey('room/x.png')).toBe(false);
  });
});

describe('font uploads', () => {
  it('stores a font and records it', async () => {
    const h = await start();
    const res = await uploadFont(h.base, 2048, 'Brand-Bold.woff2', 'font/woff2');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toMatch(/\/rooms\/fontRoom0001\/media\/f0\.woff2$/);
    expect(h.written).toEqual([`${ROOM}/f0.woff2`]);
  });

  it('refuses a font over the font cap, and removes what was written', async () => {
    const h = await start();
    const res = await uploadFont(h.base, MAX_FONT_BYTES + 1, 'Huge.ttf', 'font/ttf');
    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatch(/Fonts are limited/);
    // The stored object is cleaned up rather than left behind.
    expect(h.s3.send).toHaveBeenCalled();
  });

  it('serves a recorded font with a font type and nosniff', async () => {
    const h = await start([`${ROOM}/brand.woff2`]);
    h.s3.send.mockResolvedValueOnce({ Body: Readable.from([Buffer.from('wOF2data')]), ContentLength: 8 } as never);
    const res = await fetch(`${h.base}/rooms/${ROOM}/media/brand.woff2`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('font/woff2');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-disposition')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import { Readable } from 'stream';
import { musicKey, registerMusicRoutes } from './music';

describe('musicKey', () => {
  it('admits only the manifest and versioned category tracks', () => {
    expect(musicKey('v1/manifest.json')).toBe('music/v1/manifest.json');
    expect(musicKey('v1/lofi/lukrembo-jay.m4a')).toBe('music/v1/lofi/lukrembo-jay.m4a');
  });

  it('refuses everything else in the bucket', () => {
    for (const p of [
      'v1/../room/media/x.png',
      '../daily/vega.dump',
      'v1/lofi/Track.m4a',
      'v1/lofi/a.mp3',
      'manifest.json',
      'v1/a/b/c.m4a',
      'v1/lofi/x.m4a?x=1',
      '',
    ]) {
      expect(musicKey(p)).toBeNull();
    }
  });
});

async function serve(send: (cmd: any) => Promise<any>) {
  const app = express();
  registerMusicRoutes(app, { s3: { send } as any, bucket: 'b' });
  const server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, close: () => server.close() };
}

describe('GET /music/*', () => {
  it('passes a range through and answers 206 with the storage range', async () => {
    let seen: any;
    const { base, close } = await serve(async (cmd) => {
      seen = cmd.input;
      return { Body: Readable.from([Buffer.from('abcd')]), ContentLength: 4, ContentRange: 'bytes 0-3/100' };
    });
    try {
      const res = await fetch(`${base}/music/v1/piano/pufino-enlivening.m4a`, { headers: { Range: 'bytes=0-3' } });
      expect(res.status).toBe(206);
      expect(res.headers.get('content-range')).toBe('bytes 0-3/100');
      expect(res.headers.get('content-type')).toBe('audio/mp4');
      expect(res.headers.get('cache-control')).toContain('immutable');
      expect(await res.text()).toBe('abcd');
      expect(seen).toMatchObject({ Bucket: 'b', Key: 'music/v1/piano/pufino-enlivening.m4a', Range: 'bytes=0-3' });
    } finally {
      close();
    }
  });

  it('caches the manifest briefly and never touches storage for a bad path', async () => {
    let calls = 0;
    const { base, close } = await serve(async () => {
      calls++;
      return { Body: Readable.from([Buffer.from('{}')]), ContentLength: 2 };
    });
    try {
      const ok = await fetch(`${base}/music/v1/manifest.json`);
      expect(ok.status).toBe(200);
      expect(ok.headers.get('cache-control')).toBe('public, max-age=300');
      const bad = await fetch(`${base}/music/v1/../secret.txt`);
      expect(bad.status).toBe(404);
      expect(calls).toBe(1);
    } finally {
      close();
    }
  });

  it('maps a missing object to 404', async () => {
    const { base, close } = await serve(async () => {
      throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
    });
    try {
      expect((await fetch(`${base}/music/v1/retro/none.m4a`)).status).toBe(404);
    } finally {
      close();
    }
  });
});

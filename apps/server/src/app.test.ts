import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { Readable } from 'stream';
import { createApp } from './app';
import { IpDailyByteTracker } from './quota';
import { mintShareToken } from './shareToken';
import { fakePool, testConfig } from './testSupport';
import type { Config } from './config';

/**
 * The HTTP API, built by `createApp` against fakes and called over a real
 * socket, so routing, middleware order and headers are all the real ones.
 */

const ROOM = 'apiRoom0001';

interface Harness {
  base: string;
  pool: ReturnType<typeof fakePool>;
  s3: { send: ReturnType<typeof vi.fn> };
  written: string[];
  reap: ReturnType<typeof vi.fn>;
  state: { draining: boolean };
  config: Config;
}

let server: Server | null = null;
let tracker: IpDailyByteTracker | null = null;

afterEach(async () => {
  tracker?.stop();
  if (server) await new Promise((r) => server!.close(r));
  server = null;
});

/** Uploads are counted and recorded instead of sent to S3. */
function countingStorage(written: string[]) {
  return {
    _handleFile(_req: any, file: any, cb: any) {
      let size = 0;
      file.stream.on('data', (chunk: Buffer) => (size += chunk.length));
      file.stream.on('end', () => {
        const key = `${ROOM}/m${written.length}.png`;
        written.push(key);
        cb(null, { key, size });
      });
    },
    _removeFile(_req: any, _file: any, cb: any) {
      cb(null);
    },
  };
}

async function start(overrides: Partial<Config> = {}, mediaRows: string[] = []): Promise<Harness> {
  const config = testConfig(overrides);
  const pool = fakePool([
    [/SUM\(size_bytes\)/, () => ({ rows: [{ total: '0' }] })],
    [/SELECT 1 FROM media_refs/, (p) => ({ rows: mediaRows.includes(String(p[1])) ? [{}] : [] })],
    [/FROM room_updates/, () => ({ rows: [] })],
  ]);
  const s3 = { send: vi.fn(async () => ({})) };
  const written: string[] = [];
  const reap = vi.fn(async (o: any) => ({ reapedRooms: 0, roomIds: [], deletedObjects: 0, freedBytes: 0, dryRun: !!o.dryRun }));
  const state = { draining: false };
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
      draining: () => state.draining,
      historyDepth: () => 0,
      historyDropped: () => 0,
    },
    reap,
    storage: countingStorage(written) as any,
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server!.once('listening', r));
  const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  return { base, pool, s3, written, reap, state, config };
}

function upload(h: Harness, bytes: number, headers: Record<string, string> = {}) {
  const form = new FormData();
  form.append('media', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'a.png');
  return fetch(`${h.base}/rooms/${ROOM}/media`, { method: 'POST', body: form, headers });
}

const invite = (h: Harness, role: 'viewer' | 'commenter' | 'editor', ttlSeconds = 0) =>
  mintShareToken(h.config.shareSecret!, { roomId: ROOM, role, ttlSeconds });

describe('uploads', () => {
  it('charges the client address, so a fresh session does not reset the allowance', async () => {
    const h = await start({ quotas: { maxIpDailyBytes: 1500 } as Config['quotas'] });
    const first = await upload(h, 1000);
    expect(first.status).toBe(200);
    // No cookie: the server mints a new session for this request.
    const second = await upload(h, 1000);
    expect(second.status).toBe(413);
  });

  it('refuses before streaming when the declared size would break the allowance', async () => {
    const h = await start({ quotas: { maxIpDailyBytes: 500 } as Config['quotas'] });
    const res = await upload(h, 4000);
    expect(res.status).toBe(413);
    expect(h.written).toHaveLength(0);
  });

  it('needs an editor', async () => {
    const h = await start();
    const res = await upload(h, 10, { 'X-Invite-Token': invite(h, 'viewer') });
    expect(res.status).toBe(403);
  });

  it('refuses a bare room id when signed invites are enforced', async () => {
    const h = await start({ enforceShareTokens: true });
    expect((await upload(h, 10)).status).toBe(403);
    expect((await upload(h, 10, { 'X-Invite-Token': invite(h, 'editor') })).status).toBe(200);
  });
});

describe('invite minting', () => {
  const mint = (h: Harness, role: string, headers: Record<string, string> = {}, ttlSeconds = 0) =>
    fetch(`${h.base}/rooms/${ROOM}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ role, ttlSeconds }),
    });

  it('lets a room-id holder mint any role when invites are not enforced', async () => {
    const h = await start();
    expect((await mint(h, 'editor')).status).toBe(200);
  });

  it('never mints above the caller’s own role', async () => {
    const h = await start();
    const viewer = { 'X-Invite-Token': invite(h, 'viewer') };
    expect((await mint(h, 'editor', viewer)).status).toBe(403);
    expect((await mint(h, 'commenter', viewer)).status).toBe(403);
    expect((await mint(h, 'viewer', viewer)).status).toBe(200);
  });

  it('refuses a caller with no invite when invites are enforced, but not the admin', async () => {
    const h = await start({ enforceShareTokens: true });
    expect((await mint(h, 'viewer')).status).toBe(403);
    const admin = { Authorization: `Bearer ${h.config.adminSecret}` };
    expect((await mint(h, 'editor', admin)).status).toBe(200);
  });

  it('does not outlive the invite it was minted from', async () => {
    const h = await start();
    const res = await mint(h, 'viewer', { 'X-Invite-Token': invite(h, 'editor', 3600) }, 0);
    const body = await res.json();
    expect(body.ttlSeconds).toBeGreaterThan(0);
    expect(body.ttlSeconds).toBeLessThanOrEqual(3600);
  });
});

describe('media proxy', () => {
  it('serves only objects this server recorded', async () => {
    const h = await start();
    const res = await fetch(`${h.base}/rooms/${ROOM}/media/unknown.png`);
    expect(res.status).toBe(404);
    expect(h.s3.send).not.toHaveBeenCalled();
  });

  it('streams a recorded object with safe headers and no session cookie', async () => {
    const h = await start({}, [`${ROOM}/pic.png`]);
    h.s3.send.mockResolvedValueOnce({ Body: Readable.from([Buffer.from('PNGDATA')]), ContentLength: 7 });
    const res = await fetch(`${h.base}/rooms/${ROOM}/media/pic.png`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('PNGDATA');
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    // Publicly cacheable, so it must never carry anybody's identity.
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('survives an object store stream that fails mid-download', async () => {
    const h = await start({}, [`${ROOM}/pic.png`]);
    const failing = new Readable({
      read() {
        this.push(Buffer.from('partial'));
        this.destroy(new Error('connection reset'));
      },
    });
    h.s3.send.mockResolvedValueOnce({ Body: failing });
    await fetch(`${h.base}/rooms/${ROOM}/media/pic.png`).then((r) => r.text()).catch(() => null);
    // The process is still serving.
    expect((await fetch(`${h.base}/healthz`)).status).toBe(200);
  });
});

describe('history and cards under enforced invites', () => {
  it('needs at least a viewer invite to read history', async () => {
    const h = await start({ enforceShareTokens: true });
    expect((await fetch(`${h.base}/rooms/${ROOM}/history`)).status).toBe(403);
    const ok = await fetch(`${h.base}/rooms/${ROOM}/history`, { headers: { 'X-Invite-Token': invite(h, 'viewer') } });
    expect(ok.status).toBe(200);
  });

  it('does not describe a board by its bare room id', async () => {
    const h = await start({ enforceShareTokens: true });
    const res = await fetch(`${h.base}/cards/room/${ROOM}`);
    expect(await res.json()).toEqual({ found: false });
    const put = await fetch(`${h.base}/rooms/${ROOM}/card`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(put.status).toBe(403);
  });
});

describe('admin and health', () => {
  it('closes the admin routes without the admin credential', async () => {
    const h = await start();
    expect((await fetch(`${h.base}/admin/reap`, { method: 'POST' })).status).toBe(401);
    const wrong = await fetch(`${h.base}/admin/reap`, { method: 'POST', headers: { Authorization: 'Bearer nope' } });
    expect(wrong.status).toBe(401);
    expect(h.reap).not.toHaveBeenCalled();

    const ok = await fetch(`${h.base}/admin/reap?dryRun=true`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${h.config.adminSecret}` },
    });
    expect(ok.status).toBe(200);
    expect(h.reap).toHaveBeenCalledWith({ maxAgeDays: 90, dryRun: true });
  });

  it('stays closed when no admin secret is configured', async () => {
    const h = await start({ adminSecret: null });
    const res = await fetch(`${h.base}/admin/stats`, { headers: { Authorization: 'Bearer ' } });
    expect(res.status).toBe(401);
  });

  it('reports not-ready while draining and keeps storage totals private', async () => {
    const h = await start();
    const ready = await fetch(`${h.base}/readyz`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).not.toHaveProperty('storage');
    h.state.draining = true;
    expect((await fetch(`${h.base}/readyz`)).status).toBe(503);
  });

  it('issues a session only where one is asked for', async () => {
    const h = await start();
    expect((await fetch(`${h.base}/healthz`)).headers.get('set-cookie')).toBeNull();
    const session = await fetch(`${h.base}/api/session`);
    expect(session.headers.get('set-cookie')).toContain('vega_session=');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import * as Y from 'yjs';
import { createApp } from '../app';
import { IpDailyByteTracker } from '../quota';
import { mintShareToken } from '../shareToken';
import { fakePool, testConfig } from '../testSupport';
import type { Config } from '../config';
import { MAX_HISTORY_PAGE } from '../historyVersions';

/**
 * Time Travel's REST surface: the paged update log and version history,
 * against a fake pool over a real socket.
 */

const ROOM = 'historyRoom01';

let server: Server | null = null;
let tracker: IpDailyByteTracker | null = null;

afterEach(async () => {
  tracker?.stop();
  if (server) await new Promise((r) => server!.close(r));
  server = null;
});

type Handlers = Parameters<typeof fakePool>[0];

async function start(handlers: Handlers, overrides: Partial<Config> = {}) {
  const config = testConfig(overrides);
  const pool = fakePool(handlers);
  tracker = new IpDailyByteTracker();
  const app = createApp({
    config,
    pool: pool as any,
    s3: { send: vi.fn(async () => ({})) } as any,
    bucket: 'bucket',
    sharedRedis: null,
    sessionSecret: config.sessionSecret!,
    quota: tracker,
    health: { databaseReady: async () => true, draining: () => false, historyDepth: () => 0, historyDropped: () => 0 },
    reap: vi.fn() as any,
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server!.once('listening', r));
  const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  return { base, pool, config };
}

/** `n` real updates, each adding one object. */
function updates(n: number): Uint8Array[] {
  const doc = new Y.Doc();
  const out: Uint8Array[] = [];
  doc.on('update', (u: Uint8Array) => out.push(u));
  for (let i = 0; i < n; i++) doc.getMap('objects').set(`o${i}`, new Y.Map());
  return out;
}

function logRows(list: Uint8Array[], firstId = 1) {
  return list.map((u, i) => ({
    id: String(firstId + i),
    update_data: Buffer.from(u),
    created_at: new Date(Date.UTC(2026, 9, 7, 10, i)),
  }));
}

describe('GET /rooms/:id/history', () => {
  it('pages the log oldest first and says where the next page starts', async () => {
    const rows = logRows(updates(5));
    const h = await start([
      [/SELECT id, update_data, created_at\s+FROM room_updates/, (p) => {
        const after = Number(p[1]);
        const limit = Number(p[2]);
        return { rows: rows.filter((r) => Number(r.id) > after).slice(0, limit) };
      }],
      [/COALESCE\(r.updates_trimmed/, () => ({ rows: [{ updates_trimmed: '12', total: '5', replay_base: Buffer.from([1, 2]) }] })],
      [/COALESCE\(updates_trimmed, 0\) AS updates_trimmed FROM rooms/, () => ({ rows: [{ updates_trimmed: '12' }] })],
      [/GROUP BY session/, () => ({
        rows: [{ start_id: '1', end_id: '5', started_at: rows[0].created_at, ended_at: rows[4].created_at, count: '5' }],
      })],
    ]);

    const first = await (await fetch(`${h.base}/rooms/${ROOM}/history?limit=2`)).json();
    expect(first.updates.map((u: { id: number }) => u.id)).toEqual([1, 2]);
    expect(first.nextAfter).toBe(2);
    expect(first.baseline).toBe(Buffer.from([1, 2]).toString('base64'));
    expect(first.trimmedCount).toBe(12);
    expect(first.sessions).toEqual([
      { startId: 1, endId: 5, startedAt: rows[0].created_at.toISOString(), endedAt: rows[4].created_at.toISOString(), count: 5 },
    ]);

    const second = await (await fetch(`${h.base}/rooms/${ROOM}/history?after=2&limit=2`)).json();
    expect(second.updates.map((u: { id: number }) => u.id)).toEqual([3, 4]);
    expect(second.nextAfter).toBe(4);
    // Only the first page carries the baseline and the session summary.
    expect(second.baseline).toBeUndefined();
    expect(second.sessions).toBeUndefined();
    // Every page reports the trim counter, so a fold mid-load is detectable.
    expect(second.trimmedCount).toBe(12);

    const last = await (await fetch(`${h.base}/rooms/${ROOM}/history?after=4&limit=2`)).json();
    expect(last.updates.map((u: { id: number }) => u.id)).toEqual([5]);
    expect(last.nextAfter).toBeNull();
  });

  it('caps the page size and refuses nonsense cursors', async () => {
    const h = await start([]);
    await fetch(`${h.base}/rooms/${ROOM}/history?limit=100000`);
    const page = h.pool.queries.find((q) => /SELECT id, update_data/.test(q.sql))!;
    expect(page.params[2]).toBe(MAX_HISTORY_PAGE + 1); // +1 to detect a next page
    expect((await fetch(`${h.base}/rooms/${ROOM}/history?after=-3`)).status).toBe(400);
    expect((await fetch(`${h.base}/rooms/${ROOM}/history?limit=0`)).status).toBe(400);
  });

  it('keeps the viewer floor under enforced invites', async () => {
    const h = await start([], { enforceShareTokens: true });
    expect((await fetch(`${h.base}/rooms/${ROOM}/history`)).status).toBe(403);
    const token = mintShareToken(h.config.shareSecret!, { roomId: ROOM, role: 'viewer', ttlSeconds: 0 });
    expect((await fetch(`${h.base}/rooms/${ROOM}/history`, { headers: { 'X-Invite-Token': token } })).status).toBe(200);
  });
});

describe('versions', () => {
  const versionRow = {
    id: '9',
    kind: 'named',
    name: 'Launch',
    description: null,
    started_at: new Date(Date.UTC(2026, 9, 7)),
    ended_at: new Date(Date.UTC(2026, 9, 7)),
    update_count: 0,
    authors: [],
    created_by_name: 'Ana',
  };

  it('lists versions to a viewer and refuses a viewer every write', async () => {
    const h = await start([[/FROM room_versions\s+WHERE room_id = \$1\s+ORDER BY/, () => ({ rows: [versionRow] })]], {
      enforceShareTokens: true,
    });
    const viewer = mintShareToken(h.config.shareSecret!, { roomId: ROOM, role: 'viewer', ttlSeconds: 0 });
    const headers = { 'X-Invite-Token': viewer, 'Content-Type': 'application/json' };

    const list = await (await fetch(`${h.base}/rooms/${ROOM}/versions`, { headers })).json();
    expect(list.versions[0]).toMatchObject({ id: 9, kind: 'named', name: 'Launch', createdByName: 'Ana' });

    const body = JSON.stringify({ name: 'Mine' });
    expect((await fetch(`${h.base}/rooms/${ROOM}/versions`, { method: 'POST', headers, body })).status).toBe(403);
    expect((await fetch(`${h.base}/rooms/${ROOM}/versions/9`, { method: 'PUT', headers, body })).status).toBe(403);
    expect((await fetch(`${h.base}/rooms/${ROOM}/versions/9`, { method: 'DELETE', headers })).status).toBe(403);
    expect(h.pool.queries.some((q) => /INSERT|UPDATE|DELETE/.test(q.sql))).toBe(false);
  });

  it('names the board as it stood at a moment of the log', async () => {
    const list = updates(3);
    const rows = logRows(list);
    const h = await start([
      [/COUNT\(\*\) AS n FROM room_versions/, () => ({ rows: [{ n: '0' }] })],
      [/SELECT replay_base FROM rooms/, () => ({ rows: [{ replay_base: null }] })],
      [/SELECT created_at FROM room_updates WHERE room_id = \$1 AND id = \$2/, (p) => ({
        rows: rows.filter((r) => Number(r.id) === Number(p[1])).map((r) => ({ created_at: r.created_at })),
      })],
      [/SELECT update_data FROM room_updates/, (p) => ({
        rows: rows.filter((r) => Number(r.id) <= Number(p[1])),
      })],
      [/INSERT INTO room_versions/, (p) => ({
        rows: [{ ...versionRow, name: p[1], description: p[2], created_by_name: p[5] }],
      })],
    ]);

    const res = await fetch(`${h.base}/rooms/${ROOM}/versions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Before review', description: 'Two cards', atUpdateId: 2, createdByName: 'Ana' }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ name: 'Before review', description: 'Two cards', createdByName: 'Ana' });

    const insert = h.pool.queries.find((q) => /INSERT INTO room_versions/.test(q.sql))!;
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(insert.params[3] as Buffer));
    expect([...doc.getMap('objects').keys()].sort()).toEqual(['o0', 'o1']);
  });

  it('refuses a moment that has left the log, and a missing name', async () => {
    const h = await start([[/COUNT\(\*\) AS n FROM room_versions/, () => ({ rows: [{ n: '0' }] })]]);
    const post = (body: unknown) =>
      fetch(`${h.base}/rooms/${ROOM}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect((await post({ name: 'x', atUpdateId: 99 })).status).toBe(404);
    expect((await post({ name: '' })).status).toBe(400);
  });

  it('returns a version with its state, and 404 for one that is gone', async () => {
    const h = await start([[/SELECT .*state FROM room_versions/s, (p) =>
      Number(p[1]) === 9 ? { rows: [{ ...versionRow, state: Buffer.from([7]) }] } : { rows: [] }]]);
    const found = await (await fetch(`${h.base}/rooms/${ROOM}/versions/9`)).json();
    expect(found.state).toBe(Buffer.from([7]).toString('base64'));
    expect((await fetch(`${h.base}/rooms/${ROOM}/versions/10`)).status).toBe(404);
    expect((await fetch(`${h.base}/rooms/${ROOM}/versions/abc`)).status).toBe(400);
  });

  it('renames into a named version and deletes only named ones', async () => {
    const h = await start([
      [/UPDATE room_versions/, (p) => ({ rows: [{ ...versionRow, id: String(p[1]), name: p[2] }] })],
      [/DELETE FROM room_versions/, (p) => ({ rows: [], rowCount: Number(p[1]) === 9 ? 1 : 0 })],
    ]);
    const renamed = await fetch(`${h.base}/rooms/${ROOM}/versions/9`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Kept' }),
    });
    expect(await renamed.json()).toMatchObject({ id: 9, name: 'Kept', kind: 'named' });
    const del = h.pool.queries.find((q) => /UPDATE room_versions/.test(q.sql))!;
    expect(del.sql).toMatch(/kind = 'named'/);

    expect((await fetch(`${h.base}/rooms/${ROOM}/versions/9`, { method: 'DELETE' })).status).toBe(204);
    expect((await fetch(`${h.base}/rooms/${ROOM}/versions/8`, { method: 'DELETE' })).status).toBe(404);
    const deletion = h.pool.queries.find((q) => /DELETE FROM room_versions/.test(q.sql))!;
    expect(deletion.sql).toMatch(/kind = 'named'/);
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import * as Y from 'yjs';
import {
  MAX_STATUS_IDS,
  countPeople,
  hocuspocusLive,
  parseStatusIds,
  registerStatusRoutes,
  type LiveReader,
} from './status';
import { fakePool } from '../testSupport';

const pass = (_req: any, _res: any, next: any) => next();

let server: Server | null = null;
afterEach(async () => {
  if (server) await new Promise((r) => server!.close(r));
  server = null;
});

async function start(opts: { enforce?: boolean; live?: LiveReader; rows?: any[]; fail?: boolean } = {}) {
  const pool = fakePool([
    [/FROM rooms r/, () => {
      if (opts.fail) throw new Error('db down');
      return { rows: opts.rows ?? [] };
    }],
  ]);
  const app = express();
  registerStatusRoutes(app, {
    pool: pool as any,
    access: { shareSecret: null, enforceShareTokens: Boolean(opts.enforce) },
    limiter: pass,
    minRoomIdLength: 8,
    live: opts.live,
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server!.once('listening', r));
  const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  return { base, pool };
}

describe('parseStatusIds', () => {
  it('keeps valid, distinct ids in order and drops the rest', () => {
    expect(parseStatusIds('abcdefgh, abcdefgh,short,ijklmnop', 8)).toEqual(['abcdefgh', 'ijklmnop']);
  });

  it('caps the list', () => {
    const many = Array.from({ length: MAX_STATUS_IDS + 10 }, (_, i) => `room${String(i).padStart(6, '0')}`).join(',');
    expect(parseStatusIds(many, 8)).toHaveLength(MAX_STATUS_IDS);
  });

  it('ignores anything that is not a string', () => {
    expect(parseStatusIds(['abcdefgh'], 8)).toEqual([]);
    expect(parseStatusIds(undefined, 8)).toEqual([]);
  });
});

describe('countPeople', () => {
  it('counts people, not tabs, and ignores states with no user', () => {
    const states = [
      { user: { id: 'u1', name: 'Ana', color: '#f00' } },
      { user: { id: 'u1', name: 'Ana', color: '#f00' } },
      { user: { name: 'Ben', color: '#0f0' } },
      { user: { name: 'Ben', color: '#0f0' } },
      { user: { name: '  ' } },
      { cursor: { x: 1 } },
      null,
    ];
    expect(countPeople(states)).toBe(2);
  });
});

describe('hocuspocusLive', () => {
  it('reads the name and the preview switch from the loaded document', () => {
    const doc = new Y.Doc();
    doc.getMap('metadata').set('name', 'Renamed just now');
    const states = new Map<number, unknown>([[1, { user: { name: 'Ana', color: '#f00' } }]]);
    const live = hocuspocusLive({
      documents: new Map([['roomAAAAAA', Object.assign(doc, { awareness: { getStates: () => states } }) as any]]),
    });
    expect(live('roomAAAAAA')).toEqual({ title: 'Renamed just now', hidden: false, count: 1 });
    expect(live('roomBBBBBB')).toBeNull();

    doc.getMap('metadata').set('sharePreview', 'off');
    expect(live('roomAAAAAA')?.hidden).toBe(true);
  });
});

describe('GET /api/rooms/status', () => {
  it('reports existence, title and a head count — never names', async () => {
    const { base } = await start({
      rows: [
        { id: 'roomAAAAAA', updated_at: '2026-10-01T10:00:00Z', card_name: 'Q4 roadmap', card_hidden: false },
        { id: 'roomBBBBBB', updated_at: null, card_name: 'Secret', card_hidden: true },
        { id: 'roomEEEEEE', updated_at: null, card_name: 'Old name', card_hidden: false },
      ],
      live: (id) =>
        id === 'roomCCCCCC' ? { title: 'Live only', hidden: false, count: 3 }
          : id === 'roomEEEEEE' ? { title: 'New name', hidden: false, count: 1 }
            : null,
    });
    const res = await fetch(`${base}/api/rooms/status?ids=roomAAAAAA,roomBBBBBB,roomCCCCCC,roomDDDDDD,roomEEEEEE`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const body = await res.json();
    expect(body.restricted).toBe(false);
    const byId = Object.fromEntries(body.rooms.map((r: any) => [r.id, r]));
    expect(byId.roomAAAAAA).toEqual({ id: 'roomAAAAAA', exists: true, title: 'Q4 roadmap', updatedAt: '2026-10-01T10:00:00.000Z', onlineCount: 0 });
    // A board that hides its previews gives neither its name nor its occupancy.
    expect(byId.roomBBBBBB).toMatchObject({ exists: true, title: null, onlineCount: 0 });
    // Live but never stored still exists.
    expect(byId.roomCCCCCC).toMatchObject({ exists: true, title: 'Live only', onlineCount: 3 });
    expect(byId.roomDDDDDD).toMatchObject({ exists: false, title: null, onlineCount: 0 });
    // The live document's name beats the stale stored card.
    expect(byId.roomEEEEEE.title).toBe('New name');
    expect(JSON.stringify(body)).not.toMatch(/online"\s*:\s*\[/);
  });

  it('honours a live board that has turned previews off even when the stored card has not', async () => {
    const { base } = await start({
      rows: [{ id: 'roomAAAAAA', updated_at: null, card_name: 'Visible', card_hidden: false }],
      live: () => ({ title: 'Visible', hidden: true, count: 4 }),
    });
    const body = await (await fetch(`${base}/api/rooms/status?ids=roomAAAAAA`)).json();
    expect(body.rooms[0]).toMatchObject({ title: null, onlineCount: 0 });
  });

  it('reveals nothing when signed invites are required', async () => {
    const { base, pool } = await start({ enforce: true, rows: [{ id: 'roomAAAAAA', updated_at: null }] });
    const body = await (await fetch(`${base}/api/rooms/status?ids=roomAAAAAA`)).json();
    expect(body).toEqual({ restricted: true, rooms: [] });
    expect(pool.queries).toHaveLength(0);
  });

  it('does not query for an empty or invalid list', async () => {
    const { base, pool } = await start();
    const body = await (await fetch(`${base}/api/rooms/status?ids=x,y`)).json();
    expect(body.rooms).toEqual([]);
    expect(pool.queries).toHaveLength(0);
  });

  it('answers 500 rather than a partial picture when the database fails', async () => {
    const { base } = await start({ fail: true });
    const res = await fetch(`${base}/api/rooms/status?ids=roomAAAAAA`);
    expect(res.status).toBe(500);
  });
});

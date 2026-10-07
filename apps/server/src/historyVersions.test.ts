import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  SESSION_GAP_MS,
  composeState,
  foldWithCheckpoints,
  mergeAuthors,
  planCheckpoints,
  readVersionInput,
  updateClients,
} from './historyVersions';
import { pruneRoomUpdatesWith } from './historyRetention';
import { fakePool } from './testSupport';

const MIN = 60_000;

/**
 * A client that records its identity and then writes objects, one update each.
 * `updates[0]` is the identity: every later update depends on it, because a
 * Yjs client's clock is contiguous.
 */
function author(clientID: number, name: string) {
  const doc = new Y.Doc();
  doc.clientID = clientID;
  const updates: Uint8Array[] = [];
  doc.on('update', (u: Uint8Array) => updates.push(u));
  doc.getMap('identities').set(String(clientID), { name, color: '#123456' });
  return {
    doc,
    updates,
    write(id: string) {
      const node = new Y.Map();
      node.set('id', id);
      doc.getMap('objects').set(id, node);
      return updates[updates.length - 1];
    },
  };
}

function objectIds(state: Uint8Array): string[] {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return [...doc.getMap('objects').keys()].sort();
}

describe('planCheckpoints', () => {
  it('cuts a session wherever the pause exceeds the gap', () => {
    const rows = [0, 1, 2, 30, 31, 90].map((m) => ({ at: m * MIN }));
    const segments = planCheckpoints(rows, null, 20 * MIN);
    expect(segments.map((s) => [s.from, s.to])).toEqual([[0, 2], [3, 4], [5, 5]]);
    expect(segments.every((s) => !s.extends)).toBe(true);
  });

  it('continues the previous autosave when the fold resumes the same session', () => {
    const rows = [{ at: 10 * MIN }, { at: 11 * MIN }];
    expect(planCheckpoints(rows, 5 * MIN, 20 * MIN)[0].extends).toBe(true);
    expect(planCheckpoints(rows, -60 * MIN, 20 * MIN)[0].extends).toBe(false);
  });

  it('plans nothing for nothing', () => {
    expect(planCheckpoints([], null)).toEqual([]);
  });
});

describe('foldWithCheckpoints', () => {
  it('captures the document at the end of each session, with who worked in it', () => {
    const ana = author(11, 'Ana');
    const seed = Y.encodeStateAsUpdate(ana.doc); // identities only
    const rows = [
      { at: 0, update: ana.write('a') },
      { at: MIN, update: ana.write('b') },
      { at: 60 * MIN, update: ana.write('c') },
    ];
    const { baseline, checkpoints } = foldWithCheckpoints(seed, rows, null, SESSION_GAP_MS);
    expect(checkpoints).toHaveLength(2);
    expect(objectIds(checkpoints[0].state)).toEqual(['a', 'b']);
    expect(objectIds(checkpoints[1].state)).toEqual(['a', 'b', 'c']);
    expect(checkpoints[0].updateCount).toBe(2);
    expect(checkpoints[0].authors).toEqual([{ id: '11', name: 'Ana', color: '#123456' }]);
    expect(objectIds(baseline)).toEqual(['a', 'b', 'c']);
  });

  it('skips an unreadable row instead of abandoning the fold', () => {
    const ana = author(12, 'Ana');
    const rows = [
      { at: 0, update: ana.write('a') },
      { at: 1, update: new Uint8Array([255, 1, 2, 3]) },
    ];
    const { baseline } = foldWithCheckpoints(ana.updates[0], rows, null);
    expect(objectIds(baseline)).toEqual(['a']);
  });
});

describe('helpers', () => {
  it('attributes a pure deletion through the delete set', () => {
    const ana = author(21, 'Ana');
    ana.write('a');
    ana.doc.getMap('objects').delete('a');
    const deletion = ana.updates[ana.updates.length - 1];
    expect(updateClients(deletion)).toContain('21');
  });

  it('merges author lists without duplicates', () => {
    const a = { id: '1', name: 'A', color: '' };
    const b = { id: '2', name: 'B', color: '' };
    expect(mergeAuthors([a], [b, a])).toEqual([a, b]);
  });

  it('composes a state from parts, idempotently', () => {
    const ana = author(31, 'Ana');
    const u1 = ana.write('a');
    const u2 = ana.write('b');
    expect(objectIds(composeState([ana.updates[0], u1, u1, null, u2]))).toEqual(['a', 'b']);
  });

  it('validates names and descriptions', () => {
    expect(readVersionInput({ name: '  Launch   draft ' })).toEqual({ ok: true, name: 'Launch draft', description: '' });
    expect(readVersionInput({ name: '' }).ok).toBe(false);
    expect(readVersionInput({ name: 'x'.repeat(81) }).ok).toBe(false);
    expect(readVersionInput({ name: 'ok', description: 'd'.repeat(501) }).ok).toBe(false);
    expect(readVersionInput(null).ok).toBe(false);
  });
});

describe('pruneRoomUpdatesWith', () => {
  it('folds leaving rows into the baseline and an autosave before deleting them', async () => {
    const ana = author(41, 'Ana');
    const u1 = ana.write('a');
    const u2 = ana.write('b');
    const pool = fakePool([
      [/SELECT MIN\(id\) AS min_id/, () => ({ rows: [{ min_id: '10' }] })],
      [/SELECT update_data, created_at FROM room_updates/, () => ({
        rows: [
          { update_data: Buffer.from(u1), created_at: new Date(0) },
          { update_data: Buffer.from(u2), created_at: new Date(MIN) },
        ],
      })],
      [/SELECT replay_base FROM rooms/, () => ({ rows: [{ replay_base: Buffer.from(ana.updates[0]) }] })],
      [/FROM room_versions\s+WHERE room_id = \$1 AND kind = 'auto'\s+ORDER BY ended_at DESC LIMIT 1/, () => ({ rows: [] })],
      [/DELETE FROM room_updates/, () => ({ rows: [], rowCount: 2 })],
    ]);

    const discarded = await pruneRoomUpdatesWith(pool as any, 'room-1', 5);
    expect(discarded).toBe(2);

    const baselineWrite = pool.queries.find((q) => /UPDATE rooms SET replay_base/.test(q.sql))!;
    expect(objectIds(new Uint8Array(baselineWrite.params[1] as Buffer))).toEqual(['a', 'b']);

    const insert = pool.queries.find((q) => /INSERT INTO room_versions/.test(q.sql))!;
    expect(objectIds(new Uint8Array(insert.params[1] as Buffer))).toEqual(['a', 'b']);
    expect(insert.params[4]).toBe(2);

    // Ordering: everything is folded before anything is deleted.
    const order = pool.queries.map((q) => q.sql);
    const deleteAt = order.findIndex((s) => /DELETE FROM room_updates/.test(s));
    const insertAt = order.findIndex((s) => /INSERT INTO room_versions/.test(s));
    expect(insertAt).toBeLessThan(deleteAt);
  });

  it('extends the previous autosave when the session carries on', async () => {
    const ana = author(42, 'Ana');
    const u1 = ana.write('a');
    const pool = fakePool([
      [/SELECT MIN\(id\) AS min_id/, () => ({ rows: [{ min_id: '10' }] })],
      [/SELECT update_data, created_at FROM room_updates/, () => ({
        rows: [{ update_data: Buffer.from(u1), created_at: new Date(5 * MIN) }],
      })],
      [/SELECT replay_base FROM rooms/, () => ({ rows: [{ replay_base: Buffer.from(ana.updates[0]) }] })],
      [/ORDER BY ended_at DESC LIMIT 1/, () => ({
        rows: [{ id: '7', ended_at: new Date(4 * MIN), authors: [{ id: '9', name: 'Ben', color: '' }] }],
      })],
    ]);
    await pruneRoomUpdatesWith(pool as any, 'room-1', 5);
    const update = pool.queries.find((q) => /UPDATE room_versions/.test(q.sql))!;
    expect(update.params[0]).toBe('7');
    expect(JSON.parse(update.params[4] as string).map((a: { name: string }) => a.name)).toEqual(['Ben', 'Ana']);
    expect(pool.queries.some((q) => /INSERT INTO room_versions/.test(q.sql))).toBe(false);
  });

  it('does nothing below the limit', async () => {
    const pool = fakePool([[/SELECT MIN\(id\) AS min_id/, () => ({ rows: [{ min_id: null }] })]]);
    expect(await pruneRoomUpdatesWith(pool as any, 'room-1', 5)).toBe(0);
    expect(pool.queries).toHaveLength(1);
  });
});

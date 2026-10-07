import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { ReplayEngine, LruCache, changedBetween, frameFromState, jsonEqual } from './frames';
import { TimelineBuilder, buildTimeline, buildTimelineSliced, type RawUpdate } from './sessionTimeline';

/** A log of `n` transactions: creates, then moves of the first object. */
function makeLog(n: number) {
  const doc = new Y.Doc();
  const log: RawUpdate[] = [];
  let tick = 0;
  doc.on('update', (u: Uint8Array) => {
    let binary = '';
    u.forEach((b) => (binary += String.fromCharCode(b)));
    log.push({ id: tick + 1, createdAt: new Date(1_700_000_000_000 + tick * 1000).toISOString(), update: btoa(binary) });
    tick++;
  });
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  for (let i = 0; i < n; i++) {
    if (i < 5) {
      const node = new Y.Map<unknown>();
      node.set('type', 'sticky');
      node.set('x', i * 10);
      node.set('y', 0);
      objects.set(`n${i}`, node);
    } else {
      objects.get('n0')!.set('x', i * 100);
    }
  }
  return log;
}

function engineFor(log: RawUpdate[], keyframeEvery = 8) {
  const builder = new TimelineBuilder({ keyframeEvery, maxKeyframes: 64 });
  builder.push(log);
  builder.step(Infinity);
  const timeline = builder.snapshot();
  builder.destroy();
  return new ReplayEngine({ log: () => log, keyframes: () => timeline.keyframes, baseline: null }, 8);
}

describe('ReplayEngine', () => {
  it('reproduces the board at any index, forwards and backwards', () => {
    const log = makeLog(40);
    const engine = engineFor(log);
    expect(Object.keys(engine.seek(2).state.objects).sort()).toEqual(['n0', 'n1', 'n2']);
    expect(engine.seek(39).state.objects.n0.x).toBe(3900);
    expect(engine.seek(20).state.objects.n0.x).toBe(2000);
    expect(engine.seek(-1).state.objects).toEqual({});
  });

  it('keeps unchanged objects as the same reference across steps', () => {
    const log = makeLog(30);
    const engine = engineFor(log);
    const a = engine.seek(10).state.objects;
    const b = engine.seek(11).state.objects;
    expect(b.n1).toBe(a.n1);
    expect(b.n0).not.toBe(a.n0);
  });

  it('reports exactly what changed between two seeks', () => {
    const log = makeLog(30);
    const engine = engineFor(log);
    engine.seek(10);
    expect(engine.seek(12).changedIds).toEqual(['n0']);
    // A rewind rebuilds from a keyframe but still reports only real changes.
    expect(engine.seek(3).changedIds.sort()).toEqual(['n0', 'n4']);
  });

  it('serves a revisited index from the snapshot cache', () => {
    const log = makeLog(30);
    const engine = engineFor(log);
    const first = engine.seek(25);
    engine.seek(5);
    const again = engine.seek(25);
    expect(again.cached).toBe(true);
    expect(again.state).toBe(first.state);
  });

  it('peeks at a frame without moving the playhead document', () => {
    const log = makeLog(30);
    const engine = engineFor(log);
    engine.seek(29);
    expect(engine.peek(6).objects.n0.x).toBe(600);
    expect(engine.current.n0.x).toBe(2900);
    // The next forward step still continues from where the playhead was.
    expect(engine.seek(29).cached).toBe(true);
  });

  it('never replays from row zero when a keyframe is nearer', () => {
    const log = makeLog(64);
    const counting = log.map((row) => ({ ...row }));
    let reads = 0;
    const proxied = new Proxy(counting, {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
        return Reflect.get(target, key, receiver);
      },
    });
    const builder = new TimelineBuilder({ keyframeEvery: 8 });
    builder.push(log);
    builder.step(Infinity);
    const keyframes = builder.snapshot().keyframes;
    builder.destroy();
    const engine = new ReplayEngine({ log: () => proxied, keyframes: () => keyframes, baseline: null });
    engine.seek(60);
    expect(reads).toBeLessThanOrEqual(8);
  });
});

describe('frame helpers', () => {
  it('compares plain data structurally', () => {
    expect(jsonEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(jsonEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
  });

  it('lists ids that differ by reference, including removals', () => {
    const shared = { x: 1 };
    expect(changedBetween({ a: shared, b: { x: 2 } }, { a: shared, c: { x: 3 } }).sort()).toEqual(['b', 'c']);
  });

  it('reads a saved state, reusing equal entries', () => {
    const doc = new Y.Doc();
    const node = new Y.Map<unknown>();
    node.set('x', 5);
    doc.getMap('objects').set('a', node);
    const previous = { a: { x: 5 } };
    const state = frameFromState(Y.encodeStateAsUpdate(doc), previous);
    expect(state.objects.a).toBe(previous.a);
    expect(frameFromState(new Uint8Array([1, 2, 3])).objects).toEqual({});
  });

  it('evicts the least recently used entry', () => {
    const cache = new LruCache<string>(2);
    cache.set(1, 'a');
    cache.set(2, 'b');
    cache.get(1);
    cache.set(3, 'c');
    expect(cache.has(2)).toBe(false);
    expect(cache.has(1)).toBe(true);
  });
});

describe('incremental timeline build', () => {
  it('produces the same timeline from pages and slices as from one pass', async () => {
    const log = makeLog(60);
    const whole = buildTimeline(log);
    const builder = new TimelineBuilder();
    builder.push(log.slice(0, 25));
    builder.step(0); // a zero budget still makes progress, a few rows at a time
    expect(builder.processed).toBeGreaterThan(0);
    expect(builder.done).toBe(false);
    builder.push(log.slice(25));
    let slices = 0;
    await buildTimelineSliced(builder, { sliceMs: 0, onProgress: () => slices++ });
    expect(builder.done).toBe(true);
    expect(slices).toBeGreaterThan(1);
    const sliced = builder.snapshot();
    builder.destroy();
    expect(sliced.moments.map((m) => [m.index, m.label])).toEqual(whole.moments.map((m) => [m.index, m.label]));
    // Moments carry the server row id of their last update.
    expect(sliced.moments[sliced.moments.length - 1].rowId).toBe(60);
  });

  it('thins keyframes instead of growing without bound', () => {
    const log = makeLog(200);
    const builder = new TimelineBuilder({ keyframeEvery: 2, maxKeyframes: 10 });
    builder.push(log);
    builder.step(Infinity);
    const { keyframes } = builder.snapshot();
    builder.destroy();
    expect(keyframes.length).toBeLessThanOrEqual(10);
    expect(keyframes[keyframes.length - 1].index).toBeGreaterThan(150);
  });
});

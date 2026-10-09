import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TrackLoader, type TrackStore } from './trackLoader';
import { DECODE_LEAD, FALLBACK_LEAD, SCHEDULE_LEAD, transitionStep } from './crossfade';
import type { LibraryTrack } from './manifest';

const track = (id: string): LibraryTrack =>
  ({ id, category: 'lofi', title: id, artist: 'A', duration: 120, url: `https://cdn.test/${id}.m4a`, artwork: null, licence: 'x' }) as LibraryTrack;

/** A decoder that records how many decodes ran at once, and finishes each on demand. */
function fakeContext() {
  const state = { inFlight: 0, maxInFlight: 0, started: 0, finish: [] as (() => void)[] };
  const ctx = {
    decodeAudioData: vi.fn(
      () =>
        new Promise<AudioBuffer>((resolve) => {
          state.inFlight += 1;
          state.started += 1;
          state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
          state.finish.push(() => {
            state.inFlight -= 1;
            resolve({ duration: 0.5, sampleRate: 8000, numberOfChannels: 1, getChannelData: () => new Float32Array(4000) } as unknown as AudioBuffer);
          });
        })
    ),
  };
  return { ctx: ctx as unknown as BaseAudioContext, state };
}

const bytesResponse = () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(16) }) as unknown as Response;
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** An in-memory stand-in for Cache Storage. */
function memoryStore(seed: string[] = []): TrackStore & { puts: string[] } {
  const kept = new Set(seed);
  const puts: string[] = [];
  return {
    puts,
    match: async (url) => (kept.has(url) ? ({ arrayBuffer: async () => new ArrayBuffer(16), blob: async () => new Blob(['x']) } as unknown as Response) : undefined),
    put: async (url) => {
      kept.add(url);
      puts.push(url);
    },
  };
}

describe('TrackLoader on-device cache', () => {
  it('decodes a kept track without touching the network', async () => {
    const { ctx, state } = fakeContext();
    const fetchImpl = vi.fn(async () => bytesResponse());
    const loader = new TrackLoader(ctx, fetchImpl as unknown as typeof fetch, 25_000, memoryStore([track('kept').url]));
    loader.want(track('kept'));
    await flush();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(state.started).toBe(1);
  });

  it('keeps a finished download for next time', async () => {
    const { ctx } = fakeContext();
    const store = memoryStore();
    const loader = new TrackLoader(ctx, vi.fn(async () => bytesResponse()) as unknown as typeof fetch, 25_000, store);
    loader.want(track('fresh'), { decode: false });
    await flush();
    expect(store.puts).toEqual([track('fresh').url]);
    expect(await loader.localUrl(track('missing'))).toBeNull();
  });
});

describe('TrackLoader', () => {
  it('never decodes more than one track at a time, and holds at most the retained ones, while skipping fast', async () => {
    const { ctx, state } = fakeContext();
    const loader = new TrackLoader(ctx, vi.fn(async () => bytesResponse()) as unknown as typeof fetch);
    const ids = Array.from({ length: 12 }, (_, i) => `t${i}`);
    for (let i = 0; i < ids.length; i++) {
      // Each skip: the new track is current, the next is fetched only.
      loader.want(track(ids[i]));
      loader.want(track(ids[(i + 1) % ids.length]), { decode: false });
      loader.retain([ids[i], ids[(i + 1) % ids.length]]);
      await flush();
      // Finish whatever decode is running.
      state.finish.splice(0).forEach((f) => f());
      await flush();
      expect(loader.decodedCount()).toBeLessThanOrEqual(2);
    }
    expect(state.maxInFlight).toBe(1);
    loader.retain([ids[11]]);
    expect(loader.decodedCount()).toBeLessThanOrEqual(1);
  });

  it('fetches the next track without decoding it until asked', async () => {
    const { ctx, state } = fakeContext();
    const loader = new TrackLoader(ctx, vi.fn(async () => bytesResponse()) as unknown as typeof fetch);
    loader.want(track('next'), { decode: false });
    await flush();
    expect(state.started).toBe(0);
    loader.want(track('next'));
    await flush();
    expect(state.started).toBe(1);
  });

  it('decodes the earliest retained track first when several wait', async () => {
    const { ctx, state } = fakeContext();
    const order: string[] = [];
    const loader = new TrackLoader(ctx, vi.fn(async () => bytesResponse()) as unknown as typeof fetch);
    loader.onReady = (id) => order.push(id);
    loader.want(track('first'));
    loader.want(track('b'));
    loader.want(track('a'));
    loader.retain(['a', 'b', 'first']);
    await flush();
    for (let i = 0; i < 4; i++) {
      state.finish.splice(0).forEach((f) => f());
      await flush();
    }
    // `first` was already decoding when the order was named; of the rest, `a` outranks `b`.
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
  });

  it('aborts a download when its track is dropped', async () => {
    const { ctx } = fakeContext();
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Promise<Response>(() => {});
    });
    const loader = new TrackLoader(ctx, fetchImpl as unknown as typeof fetch);
    loader.want(track('gone'));
    expect(signal?.aborted).toBe(false);
    loader.retain([]);
    expect(signal?.aborted).toBe(true);
  });

  it('gives up on a download that stalls, and retries it after a backoff', async () => {
    const { ctx } = fakeContext();
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    );
    const loader = new TrackLoader(ctx, fetchImpl as unknown as typeof fetch, 25_000);
    const t = track('hung');
    loader.want(t);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(25_001);
    // Failed, not loading: still within its backoff, so wanting it again does nothing yet.
    loader.want(t, {}, performance.now());
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    loader.want(t, {}, performance.now() + 60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('transition lead', () => {
  it('commits a ready next track 12 s ahead, not 3', () => {
    expect(SCHEDULE_LEAD).toBeGreaterThanOrEqual(10);
    expect(SCHEDULE_LEAD).toBeLessThanOrEqual(15);
    expect(transitionStep(SCHEDULE_LEAD + 0.5, true)).toBe('wait');
    expect(transitionStep(SCHEDULE_LEAD, true)).toBe('commit');
    expect(transitionStep(5, true)).toBe('commit');
  });

  it('waits for a next track that is not ready, and loops the current one only at the last moment', () => {
    expect(transitionStep(SCHEDULE_LEAD, false)).toBe('wait');
    expect(transitionStep(FALLBACK_LEAD + 0.5, false)).toBe('wait');
    expect(transitionStep(FALLBACK_LEAD, false)).toBe('loop');
  });

  it('decodes the next track well before it must commit', () => {
    expect(DECODE_LEAD).toBeGreaterThan(SCHEDULE_LEAD);
  });
});

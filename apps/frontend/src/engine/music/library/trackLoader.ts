/**
 * Downloads and decodes library tracks into trimmed, cue-marked buffers.
 *
 * - One download per track at a time, each with its own `AbortController`.
 *   A download that makes no progress for `STALL_MS` is aborted and counts as
 *   failed, so a hung connection never stays "loading". A failure is retried
 *   with a backoff (`retryDelay`) for as long as the track is still wanted.
 *   The player keeps whatever is playing going in the meantime.
 * - Downloading and decoding are separate. A track wanted with
 *   `decode: false` is fetched and its compressed bytes (a few MB) are held;
 *   it is decoded only once the player asks, shortly before it is needed.
 * - At most one `decodeAudioData` is in flight, so rapid skipping cannot pile
 *   up large decodes. When several tracks wait, the earliest named in `retain`
 *   goes first.
 * - Decoded audio is large (about 10 MB a minute), so only the tracks the
 *   player names in `retain` are kept: what plays now, what comes next, and
 *   anything still fading out. A track dropped from `retain` has its download
 *   aborted and its buffers released.
 * - Finished downloads are kept on the device in Cache Storage (`TrackStore`),
 *   newest `MAX_CACHED_TRACKS`, so a track heard before needs no network: the
 *   loader reads it from disk, and `localUrl` hands the player a blob URL to
 *   stream from at once. Tracks are immutable under a versioned path, so a
 *   cached copy never goes stale. Storage that is full or unavailable (private
 *   windows) just means no cache.
 * - The request is CORS, without credentials: the bucket route serves the
 *   audio to any origin and needs no cookie.
 */
import { analyseCues, readGaplessInfo, retryDelay, trimWindow, type Cues, type TrimWindow } from './gapless';
import type { LibraryTrack } from './manifest';

export interface DecodedTrack {
  buffer: AudioBuffer;
  /** The real audio inside the buffer, with encoder priming and padding left out. */
  window: TrimWindow;
  cues: Cues;
}

/** Tracks kept on the device, about 2.5 MB each. */
export const MAX_CACHED_TRACKS = 24;
const CACHE_NAME = 'vega-music-v1';

/** Where finished downloads are kept between visits. */
export interface TrackStore {
  match(url: string): Promise<Response | undefined>;
  put(url: string, bytes: ArrayBuffer): Promise<void>;
}

/** Cache Storage, or null where there is none (tests, very old browsers, some private modes). */
export function browserTrackStore(): TrackStore | null {
  if (typeof caches === 'undefined') return null;
  const open = () => caches.open(CACHE_NAME);
  return {
    async match(url) {
      try {
        return (await (await open()).match(url)) ?? undefined;
      } catch {
        return undefined;
      }
    },
    async put(url, bytes) {
      try {
        const cache = await open();
        await cache.put(url, new Response(bytes, { headers: { 'Content-Type': 'audio/mp4' } }));
        // Keys come back in insertion order: the oldest go first.
        const keys = await cache.keys();
        for (const old of keys.slice(0, Math.max(0, keys.length - MAX_CACHED_TRACKS))) await cache.delete(old);
      } catch {
        // Quota or a storage that refuses writes: carry on without the cache.
      }
    },
  };
}

/** A download with no new bytes for this long is given up. */
export const STALL_MS = 25_000;

interface Entry {
  state: 'loading' | 'fetched' | 'decoding' | 'ready' | 'failed';
  decoded: DecodedTrack | null;
  /** The compressed file, held between download and decode. */
  bytes: ArrayBuffer | null;
  /** Whether the player has asked for this track to be decoded. */
  decode: boolean;
  /** Position in the last `retain`; lower decodes first. */
  rank: number;
  attempts: number;
  /** `performance.now()` after which a failed download may be tried again. */
  retryAt: number;
  abort: AbortController;
}

export interface WantOptions {
  /** False to fetch only; the track is decoded once wanted again with decode on. Default true. */
  decode?: boolean;
}

export class TrackLoader {
  private entries = new Map<string, Entry>();
  private ctx: BaseAudioContext;
  private fetchImpl: typeof fetch;
  private stallMs: number;
  private decoding = false;
  private store: TrackStore | null;
  /** Called when a track finishes decoding, so the player can schedule with it. */
  onReady: ((id: string) => void) | null = null;

  constructor(
    ctx: BaseAudioContext,
    fetchImpl: typeof fetch = (...args) => fetch(...args),
    stallMs = STALL_MS,
    store: TrackStore | null = browserTrackStore()
  ) {
    this.store = store;
    this.ctx = ctx;
    this.fetchImpl = fetchImpl;
    this.stallMs = stallMs;
  }

  /** A blob URL for a track kept on the device, or null. The caller revokes it. */
  async localUrl(track: LibraryTrack): Promise<string | null> {
    const hit = await this.store?.match(track.url);
    if (!hit) return null;
    try {
      return URL.createObjectURL(await hit.blob());
    } catch {
      return null;
    }
  }

  get(id: string): DecodedTrack | null {
    return this.entries.get(id)?.decoded ?? null;
  }

  /** How many decoded buffers are held. */
  decodedCount(): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.decoded) n += 1;
    return n;
  }

  /** Starts a download, or retries a failed one once its backoff has passed. Otherwise only upgrades to decoding. */
  want(track: LibraryTrack, options: WantOptions = {}, now = performance.now()): void {
    const decode = options.decode !== false;
    const existing = this.entries.get(track.id);
    if (existing && (existing.state !== 'failed' || now < existing.retryAt)) {
      if (decode && !existing.decode) {
        existing.decode = true;
        this.pump();
      }
      return;
    }
    const entry: Entry = {
      state: 'loading',
      decoded: null,
      bytes: null,
      decode,
      rank: existing?.rank ?? Number.MAX_SAFE_INTEGER,
      attempts: existing?.attempts ?? 0,
      retryAt: 0,
      abort: new AbortController(),
    };
    this.entries.set(track.id, entry);
    void this.download(track, entry);
  }

  /** Forgets every track not named here, aborting its download. The order names decode priority. */
  retain(ids: Iterable<string>): void {
    const order = [...ids];
    const keep = new Set(order);
    for (const [id, entry] of [...this.entries]) {
      if (keep.has(id)) {
        entry.rank = order.indexOf(id);
        continue;
      }
      entry.abort.abort();
      entry.bytes = null;
      this.entries.delete(id);
    }
  }

  private async download(track: LibraryTrack, entry: Entry): Promise<void> {
    const { signal } = entry.abort;
    let stall: ReturnType<typeof setTimeout> | undefined;
    const bump = () => {
      clearTimeout(stall);
      stall = setTimeout(() => entry.abort.abort(), this.stallMs);
    };
    try {
      const kept = this.store ? await this.store.match(track.url) : undefined;
      if (kept) {
        const bytes = await kept.arrayBuffer();
        if (this.entries.get(track.id) !== entry) return;
        entry.bytes = bytes;
        entry.state = 'fetched';
        this.pump();
        return;
      }
      if (signal.aborted || this.entries.get(track.id) !== entry) return;
      bump();
      const res = await this.fetchImpl(track.url, { mode: 'cors', credentials: 'omit', signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = await readBytes(res, signal, bump);
      if (this.entries.get(track.id) !== entry) return;
      // A copy: decoding detaches the buffer it is given.
      void this.store?.put(track.url, bytes.slice(0));
      entry.bytes = bytes;
      entry.state = 'fetched';
      this.pump();
    } catch {
      this.fail(track.id, entry);
    } finally {
      clearTimeout(stall);
    }
  }

  private fail(id: string, entry: Entry) {
    if (this.entries.get(id) !== entry) return;
    entry.state = 'failed';
    entry.bytes = null;
    entry.retryAt = performance.now() + retryDelay(entry.attempts) * 1000;
    entry.attempts += 1;
  }

  /** Starts the next decode if none is running. */
  private pump(): void {
    if (this.decoding) return;
    let next: [string, Entry] | null = null;
    for (const pair of this.entries) {
      const e = pair[1];
      if (e.state !== 'fetched' || !e.decode) continue;
      if (!next || e.rank < next[1].rank) next = pair;
    }
    if (!next) return;
    this.decoding = true;
    const [id, entry] = next;
    entry.state = 'decoding';
    void this.decode(id, entry).finally(() => {
      this.decoding = false;
      this.pump();
    });
  }

  private async decode(id: string, entry: Entry): Promise<void> {
    const bytes = entry.bytes!;
    entry.bytes = null;
    try {
      // Read the edit list before decoding: decodeAudioData detaches the buffer.
      const info = readGaplessInfo(bytes);
      const buffer = await this.ctx.decodeAudioData(bytes);
      if (this.entries.get(id) !== entry) return;
      const window = trimWindow(buffer.duration, info);
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
      const cues = analyseCues(channels, buffer.sampleRate, window);
      entry.state = 'ready';
      entry.decoded = { buffer, window, cues };
      this.onReady?.(id);
    } catch {
      this.fail(id, entry);
    }
  }
}

/** The body as one buffer, noting progress as chunks arrive so a stall can be told from a slow download. */
async function readBytes(res: Response, signal: AbortSignal, progress: () => void): Promise<ArrayBuffer> {
  if (!res.body || typeof res.body.getReader !== 'function') {
    const bytes = await res.arrayBuffer();
    progress();
    return bytes;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const onAbort = () => void reader.cancel().catch(() => {});
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw new Error('aborted');
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
      progress();
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out.buffer;
}

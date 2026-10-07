// @vitest-environment jsdom
/**
 * The player against a fake audio context and fake media elements: how it
 * decides the host has no CORS, and what it does when the browser suspends or
 * interrupts the context.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryPlayer } from './libraryPlayer';
import type { LibraryTrack } from './manifest';

class FakeParam {
  value = 0;
  cancelScheduledValues = vi.fn();
  setValueAtTime = vi.fn();
  linearRampToValueAtTime = vi.fn();
  setValueCurveAtTime = vi.fn();
  setTargetAtTime = vi.fn();
}
class FakeNode {
  gain = new FakeParam();
  connect<T>(n: T): T {
    return n;
  }
  disconnect() {}
}
class FakeContext {
  static last: FakeContext | null = null;
  state: string = 'suspended';
  currentTime = 0;
  destination = new FakeNode();
  private listeners = new Set<() => void>();
  resume = vi.fn(async () => {
    this.set('running');
  });
  suspend = vi.fn(async () => this.set('suspended'));
  constructor() {
    FakeContext.last = this;
  }
  addEventListener(_: string, fn: () => void) {
    this.listeners.add(fn);
  }
  set(state: string) {
    this.state = state;
    this.listeners.forEach((fn) => fn());
  }
  createGain() {
    return new FakeNode();
  }
  createMediaElementSource() {
    return new FakeNode();
  }
  createBufferSource() {
    return Object.assign(new FakeNode(), { start: vi.fn(), stop: vi.fn(), buffer: null, onended: null });
  }
  decodeAudioData = vi.fn(() => new Promise(() => {}));
}

class FakeAudio {
  static all: FakeAudio[] = [];
  static failPlay = false;
  crossOrigin: string | null = null;
  src = '';
  currentTime = 0;
  volume = 1;
  duration = NaN;
  readyState = 4;
  paused = true;
  preload = '';
  private handlers = new Map<string, Set<(e?: unknown) => void>>();
  constructor() {
    FakeAudio.all.push(this);
  }
  addEventListener(type: string, fn: (e?: unknown) => void) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: (e?: unknown) => void) {
    this.handlers.get(type)?.delete(fn);
  }
  emit(type: string) {
    [...(this.handlers.get(type) ?? [])].forEach((fn) => fn());
  }
  play = vi.fn(async () => {
    this.paused = false;
    if (FakeAudio.failPlay) return;
    this.emit('playing');
  });
  pause() {
    this.paused = true;
  }
  removeAttribute() {}
  load() {}
}

const track = (id: string): LibraryTrack =>
  ({ id, category: 'lofi', title: id, artist: 'A', duration: 120, url: `https://cdn.test/${id}.m4a`, artwork: null, licence: 'x' }) as LibraryTrack;

function makePlayer(fetchImpl: typeof fetch) {
  const events = { nextTrack: vi.fn(() => null), onAdvance: vi.fn(), onChange: vi.fn(), onError: vi.fn() };
  return { player: new LibraryPlayer(events, { fetch: fetchImpl }), events };
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

beforeEach(() => {
  FakeAudio.all = [];
  FakeAudio.failPlay = false;
  FakeContext.last = null;
  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('deciding that the host has no CORS', () => {
  it('retries the routed element when the probe says CORS is allowed (a transient error)', async () => {
    const probe = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
    const { player } = makePlayer(probe as unknown as typeof fetch);
    FakeAudio.failPlay = true; // the element errors before it ever sounds
    await player.play(track('a'));
    FakeAudio.failPlay = false;
    const first = FakeAudio.all[0];
    expect(first.crossOrigin).toBe('anonymous');
    first.emit('error');
    await settle();
    expect(probe).toHaveBeenCalledTimes(1);
    const second = FakeAudio.all[1];
    expect(second.crossOrigin).toBe('anonymous');
    // The next track still starts on the routed path.
    await player.play(track('b'));
    expect(FakeAudio.all[FakeAudio.all.length - 1].crossOrigin).toBe('anonymous');
  });

  it('falls back to an unrouted element when the probe fails and that element plays, then resets for the next track', async () => {
    const probe = vi.fn(async () => {
      throw new TypeError('blocked by CORS');
    });
    const { player } = makePlayer(probe as unknown as typeof fetch);
    FakeAudio.failPlay = true;
    await player.play(track('a'));
    FakeAudio.failPlay = false;
    FakeAudio.all[0].emit('error');
    await settle();
    const unrouted = FakeAudio.all[1];
    expect(unrouted.crossOrigin).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/no CORS/));
    // Reset: the next track tries the routed path again.
    await player.play(track('b'));
    expect(FakeAudio.all[FakeAudio.all.length - 1].crossOrigin).toBe('anonymous');
  });

  it('does not conclude "no CORS" when the unrouted element cannot play either', async () => {
    const probe = vi.fn(async () => {
      throw new TypeError('offline');
    });
    const { player } = makePlayer(probe as unknown as typeof fetch);
    FakeAudio.failPlay = true;
    await player.play(track('a'));
    FakeAudio.all[0].emit('error');
    await settle();
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe('the audio context lifecycle', () => {
  it('resumes a context the browser interrupted while music is wanted', async () => {
    const { player, events } = makePlayer(vi.fn() as unknown as typeof fetch);
    await player.play(track('a'));
    const ctx = FakeContext.last!;
    ctx.resume.mockClear();
    ctx.set('interrupted');
    await settle();
    expect(ctx.resume).toHaveBeenCalled();
    expect(player.snapshot().playing).toBe(true);
    expect(events.onChange).toHaveBeenCalled();
  });

  it('reports paused when the context cannot be resumed', async () => {
    const { player } = makePlayer(vi.fn() as unknown as typeof fetch);
    await player.play(track('a'));
    const ctx = FakeContext.last!;
    ctx.resume.mockImplementation(async () => {
      throw new DOMException('not allowed', 'NotAllowedError');
    });
    ctx.set('suspended');
    await settle();
    expect(player.snapshot().playing).toBe(false);
  });

  it('resumes when the tab becomes visible again', async () => {
    const { player } = makePlayer(vi.fn() as unknown as typeof fetch);
    await player.play(track('a'));
    const ctx = FakeContext.last!;
    ctx.state = 'suspended';
    ctx.resume.mockClear();
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(ctx.resume).toHaveBeenCalled();
  });

  it('leaves a context alone that the player itself paused', async () => {
    const { player } = makePlayer(vi.fn() as unknown as typeof fetch);
    await player.play(track('a'));
    const ctx = FakeContext.last!;
    player.pause();
    ctx.resume.mockClear();
    ctx.set('suspended');
    await settle();
    expect(ctx.resume).not.toHaveBeenCalled();
  });

  it('can be primed inside a gesture before any await', () => {
    const { player } = makePlayer(vi.fn() as unknown as typeof fetch);
    player.prime();
    expect(FakeContext.last!.resume).toHaveBeenCalledTimes(1);
  });
});

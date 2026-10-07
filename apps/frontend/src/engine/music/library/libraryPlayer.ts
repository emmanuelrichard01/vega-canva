/**
 * Library playback on the Web Audio clock: gapless loops and crossfades.
 *
 * - **First play streams.** A track that has not been decoded yet plays from
 *   an `<audio>` element routed into the graph, so it starts as soon as its
 *   first seconds arrive. Meanwhile the whole file is downloaded and decoded.
 * - **Everything after that is buffers.** Transitions, loops and the next
 *   track play from decoded `AudioBufferSourceNode`s started at an exact time
 *   on the audio clock, with the encoder's priming and padding trimmed off.
 * - **Every transition is an equal-power crossfade** written as gain curves
 *   on the audio clock (`setValueCurveAtTime`), never stepped from a timer:
 *   5 s between tracks, 3 s when a track loops into its own start, 1.2 s when
 *   someone skips. Fades land on the track's cues (`analyseCues`), so a
 *   fading tail never overlaps a silent intro.
 * - **The next track is fetched as soon as the current one starts**, minutes
 *   before it is needed. If it still is not ready when the fade is due, the
 *   current track loops into itself and the download is retried; playback
 *   never stops for the network.
 * - A timer only decides *when to commit* a transition, `SCHEDULE_LEAD`
 *   seconds ahead (long enough for a throttled hidden tab); the audio clock
 *   decides exactly when it happens. The next track is decoded only once its
 *   transition is `DECODE_LEAD` seconds away.
 * - The context's lifecycle is watched: if the browser suspends or interrupts
 *   it while music is wanted, the player resumes it and re-plans the
 *   transition; if it cannot, it reports paused rather than pretending.
 *
 * The audio route needs CORS on the media (`crossOrigin = 'anonymous'`). When
 * a routed element fails, a `fetch` probe tells a host without CORS from a
 * transient error. Only when the unrouted element then plays *and* the probe
 * fails does the player fall back to unrouted elements whose volume follows
 * the same curves from a short timer, and stop decoding, until the next
 * track. Any other failure retries the routed element.
 */
import { DECODE_LEAD, fadeLength, LOOP_FADE, SKIP_FADE, TRACK_FADE, transitionStep } from './crossfade';
import { envelopeAt, fadeCurve, planCrossfade, steady, type Envelope, type FadePlan } from './gapless';
import { TrackLoader, type DecodedTrack } from './trackLoader';
import type { LibraryTrack } from './manifest';

/** Perceptual volume: a slider position in [0, 1] to a gain. */
const volumeToGain = (v: number) => {
  const c = Math.min(1, Math.max(0, v));
  return c * c;
};

const TICK_MS = 100;
/** Decoded audio at this rate takes two thirds of the memory of 48 kHz; used when the device reports 4 GB or less. */
const LOW_MEMORY_RATE = 32000;
/** Unrouted elements follow their curves at this rate. */
const EMULATE_MS = 30;
/** Routed attempts on a stream before the player gives up on it. */
const ROUTED_ATTEMPTS = 2;
/** The CORS probe is abandoned after this long. */
const PROBE_MS = 8000;
/** How long `resume()` may take before the context is declared unable to run. */
const RESUME_MS = 2000;
/** After a stream fails to stand in for a missing buffer, wait this long (seconds of audio time) before trying another. */
const STREAM_RETRY_S = 5;
const PAUSE_FADE = 0.45;
const RESUME_FADE = 0.3;
const SEEK_FADE = 0.12;
/** A streamed track's fade finishes this long before the element's reported end. */
const STREAM_END_MARGIN = 0.2;
/** Small offset so nothing is scheduled in the audio thread's past. */
const LEAD = 0.03;

export interface DeckSnapshot {
  trackId: string | null;
  playing: boolean;
  position: number;
  duration: number;
  buffering: boolean;
}

export interface LibraryPlayerEvents {
  /** What the queue plays after the current track, or null to stop at its end. */
  nextTrack: () => LibraryTrack | null;
  /** The track the queue named became current. */
  onAdvance: (track: LibraryTrack) => void;
  onChange: () => void;
  onError: (track: LibraryTrack, message: string) => void;
}

interface Voice {
  track: LibraryTrack;
  /** Null for an unrouted element, whose gain is emulated through `el.volume`. */
  gain: GainNode | null;
  env: Envelope;
  /** Audio-clock time at which the track position equals `offset`. */
  startAt: number;
  offset: number;
  decoded: DecodedTrack | null;
  source: AudioBufferSourceNode | null;
  el: HTMLAudioElement | null;
  /** Producing sound (a stream that has started, or any buffer). */
  audible: boolean;
  ended: boolean;
  disposed: boolean;
  /** An unrouted element standing in for a routed one after a failed CORS probe. */
  noCors?: boolean;
}

interface Pending {
  from: Voice;
  to: Voice;
  plan: FadePlan;
  /** True when `to` is the queue's next track; false when the current track loops while the next one loads. */
  advances: boolean;
}

export class LibraryPlayer {
  private ctx: AudioContext | null = null;
  private bus: GainNode | null = null;
  private fader: GainNode | null = null;
  private faderEnv: Envelope = steady(1);
  private loader: TrackLoader | null = null;
  private current: Voice | null = null;
  private pending: Pending | null = null;
  private retiring: { voice: Voice; until: number }[] = [];
  private volume = 0.6;
  private wantPlaying = false;
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private emulator: ReturnType<typeof setInterval> | null = null;
  /** Set when a routed element failed, an unrouted one played, and a CORS probe failed: no CORS on the media. Cleared at the next track. */
  private unrouted = false;
  /** Audio-clock time before which no stream voice stands in for a missing buffer. */
  private streamBlockedUntil = 0;
  private reviving = false;
  private events: LibraryPlayerEvents;
  private fetchImpl: typeof fetch;

  constructor(events: LibraryPlayerEvents, deps: { fetch?: typeof fetch } = {}) {
    this.events = events;
    this.fetchImpl = deps.fetch ?? ((...args) => fetch(...args));
  }

  // ---------------------------------------------------------------- public

  snapshot(): DeckSnapshot {
    const v = this.current;
    if (!v) return { trackId: null, playing: this.wantPlaying, position: 0, duration: 0, buffering: false };
    const duration = this.lengthOf(v);
    return {
      trackId: v.track.id,
      playing: this.wantPlaying,
      position: Math.min(duration, Math.max(0, this.positionOf(v))),
      duration,
      buffering: this.wantPlaying && (!v.audible || (v.el !== null && v.el.readyState < 3 && !v.el.paused)),
    };
  }

  /** Fetches and decodes `track` ahead of time. A changed queue also re-plans a committed transition. */
  preload(track: LibraryTrack | null): void {
    if (!track || !this.loader) return;
    if (!this.unrouted) this.loader.want(track, { decode: false });
    if (this.pending?.advances && this.pending.to.track.id !== track.id) this.cancelPending();
    this.tick();
  }

  /**
   * Creates and resumes the context. Call synchronously inside the gesture
   * that will start music, before any `await`: browsers grant playback to the
   * activation that is still live.
   */
  prime(): void {
    const ctx = this.ensureContext();
    if (ctx.state !== 'running') void ctx.resume().catch(() => {});
  }

  /** Plays `track` from `from` seconds: a short crossfade from whatever plays, or a soft start from silence. */
  async play(track: LibraryTrack, from = 0): Promise<void> {
    const ctx = this.ensureContext();
    // A new track gets a fresh try at the routed (gapless) path.
    this.unrouted = false;
    this.streamBlockedUntil = 0;
    const wasAudible = this.wantPlaying && this.current !== null && !this.current.ended;
    this.wantPlaying = true;
    this.clearSuspend();
    this.cancelPending();
    if (ctx.state !== 'running') {
      try {
        await ctx.resume();
      } catch {
        // Resumed by the next gesture instead.
      }
    }
    if (!this.unrouted) this.loader!.want(track);
    if (wasAudible && this.current) {
      // Keeps playing at full level until the new track is actually sounding; see `handOver`.
      this.retiring.push({ voice: this.current, until: Infinity });
    } else {
      for (const v of this.voices()) this.dispose(v);
      this.retiring = [];
    }

    const decoded = this.decodedFor(track.id);
    const incoming = decoded ? this.bufferVoice(track, decoded, from, ctx.currentTime + LEAD) : this.streamVoice(track, from);
    this.current = incoming;
    this.ensureTimer();

    if (incoming.el) {
      const el = incoming.el;
      const begin = () => this.handOver(incoming);
      el.addEventListener('playing', begin, { once: true });
      try {
        await el.play();
      } catch (e) {
        if ((e as DOMException)?.name === 'AbortError' || incoming.disposed) return;
        // Autoplay refusal or a load failure. Whatever was playing keeps playing.
        el.removeEventListener('playing', begin);
        this.recoverFrom(incoming, 'Playback was blocked or the track could not be loaded.');
      }
    } else {
      this.handOver(incoming);
    }
    this.events.onChange();
  }

  /**
   * Brings `incoming` up now that it sounds: crossfaded over whatever was
   * left playing for it, or faded up from silence.
   */
  private handOver(incoming: Voice) {
    if (incoming.disposed || !this.ctx) return;
    const t = this.ctx.currentTime + LEAD;
    const waiting = this.retiring.filter((r) => r.until === Infinity);
    if (!this.wantPlaying) {
      // Paused while it loaded.
      incoming.el?.pause();
      this.setEnv(incoming, steady(1));
      for (const r of waiting) r.until = t;
      return;
    }
    if (waiting.length > 0) {
      this.setEnv(incoming, { t0: t, t1: t + SKIP_FADE, from: 0, to: 1 });
      for (const r of waiting) {
        this.setEnv(r.voice, { t0: t, t1: t + SKIP_FADE, from: envelopeAt(r.voice.env, t), to: 0 });
        r.until = t + SKIP_FADE + 0.05;
      }
    } else {
      this.setEnv(incoming, steady(1));
      this.setFader({ t0: t, t1: t + RESUME_FADE, from: envelopeAt(this.faderEnv, t), to: 1 });
    }
    this.events.onChange();
  }

  /** Fades out, then suspends the audio clock, which freezes every scheduled transition in place. */
  pause(): void {
    if (!this.wantPlaying || !this.ctx) return;
    this.wantPlaying = false;
    this.cancelPending();
    const ctx = this.ctx;
    const now = ctx.currentTime;
    this.setFader({ t0: now, t1: now + PAUSE_FADE, from: envelopeAt(this.faderEnv, now), to: 0 });
    this.clearSuspend();
    this.suspendTimer = setTimeout(() => {
      this.suspendTimer = null;
      if (this.wantPlaying) return;
      for (const v of this.voices()) v.el?.pause();
      void ctx.suspend().catch(() => {});
    }, PAUSE_FADE * 1000 + 60);
    this.events.onChange();
  }

  async resume(): Promise<void> {
    const v = this.current;
    if (!v || !this.ctx) return;
    if (v.ended) return this.play(v.track, 0);
    this.wantPlaying = true;
    this.clearSuspend();
    if (this.ctx.state !== 'running') {
      try {
        await this.ctx.resume();
      } catch {
        // Resumed by the next gesture instead.
      }
    }
    for (const voice of this.voices()) if (voice.el && !voice.ended) void voice.el.play().catch(() => {});
    const now = this.ctx.currentTime;
    this.setFader({ t0: now, t1: now + RESUME_FADE, from: envelopeAt(this.faderEnv, now), to: 1 });
    this.ensureTimer();
    this.events.onChange();
  }

  seek(seconds: number): void {
    const ctx = this.ctx;
    this.cancelPending();
    const v = this.current;
    if (!v || !ctx) return;
    const target = Math.max(0, Math.min(seconds, this.lengthOf(v) - 0.25));
    const decoded = v.decoded ?? (this.unrouted ? null : this.loader?.get(v.track.id) ?? null);
    const now = ctx.currentTime;
    if (decoded) {
      // A fresh source at the new position, crossfaded in over a few milliseconds: no click.
      const next = this.bufferVoice(v.track, decoded, target, now + LEAD);
      this.current = next;
      if (this.wantPlaying && v.audible && !v.ended) {
        this.setEnv(next, { t0: now + LEAD, t1: now + LEAD + SEEK_FADE, from: 0, to: 1 });
        this.fadeOutAndRetire(v, now + LEAD, now + LEAD + SEEK_FADE);
      } else {
        this.setEnv(next, steady(1));
        this.dispose(v);
      }
    } else if (v.el) {
      const el = v.el;
      if (!this.wantPlaying) {
        el.currentTime = target;
      } else {
        // Dip, jump, return: an element cannot be crossfaded with itself.
        this.setEnv(v, { t0: now, t1: now + 0.05, from: envelopeAt(v.env, now), to: 0 });
        setTimeout(() => {
          if (v.disposed) return;
          el.addEventListener(
            'seeked',
            () => {
              const t = this.ctx!.currentTime;
              this.setEnv(v, { t0: t, t1: t + 0.08, from: 0, to: 1 });
            },
            { once: true }
          );
          el.currentTime = target;
        }, 60);
      }
    }
    this.events.onChange();
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.ctx && this.bus) this.bus.gain.setTargetAtTime(volumeToGain(this.volume), this.ctx.currentTime, 0.03);
  }

  stop(): void {
    this.wantPlaying = false;
    this.pending = null;
    for (const v of this.voices()) this.dispose(v);
    this.current = null;
    this.retiring = [];
    this.stopTimer();
    this.events.onChange();
  }

  // ---------------------------------------------------------------- graph

  private ensureContext(): AudioContext {
    if (this.ctx) return this.ctx;
    const Ctor: typeof AudioContext =
      (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = newContext(Ctor);
    const bus = ctx.createGain();
    bus.gain.value = volumeToGain(this.volume);
    const fader = ctx.createGain();
    fader.gain.value = 0;
    this.faderEnv = steady(0);
    // The tracks are mastered (-16 LUFS, -1.5 dBTP), so they go straight out: no compressor colouring them.
    bus.connect(fader).connect(ctx.destination);
    this.ctx = ctx;
    this.bus = bus;
    this.fader = fader;
    this.loader = new TrackLoader(ctx);
    this.loader.onReady = () => this.tick();
    ctx.addEventListener('statechange', this.onContextState);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.onPageHide);
    window.addEventListener('pageshow', this.onPageShow);
    return ctx;
  }

  // ---------------------------------------------------------------- context lifecycle

  private onContextState = () => void this.revive();
  private onVisibility = () => {
    if (!document.hidden) void this.revive();
  };
  /** A page going away or into the back/forward cache: nothing committed ahead of time survives that. */
  private onPageHide = () => this.cancelPending();
  private onPageShow = () => void this.revive();

  /**
   * If music is wanted but the browser suspended or interrupted the context
   * (a call, another app, a frozen tab), resumes it and re-plans the
   * transition. If it cannot run, says so: the player reports paused.
   */
  private async revive(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || !this.wantPlaying || this.reviving || ctx.state === 'running') return;
    this.reviving = true;
    let ok = false;
    try {
      // `interrupted` is iOS's word for a call or another app holding the audio session.
      if ((ctx.state as string) !== 'closed') {
        await Promise.race([ctx.resume(), new Promise<void>((_, reject) => setTimeout(() => reject(new Error('resume timed out')), RESUME_MS))]);
        ok = (ctx.state as string) === 'running';
      }
    } catch {
      ok = false;
    }
    this.reviving = false;
    if (!this.wantPlaying) return;
    if (!ok) {
      this.giveUp();
      return;
    }
    // Transitions committed before the stall refer to a clock that stood still.
    this.cancelPending();
    for (const v of this.voices()) if (v.el && !v.ended && !v.disposed) void v.el.play().catch(() => {});
    this.ensureTimer();
    this.tick();
    this.events.onChange();
  }

  /** The context cannot run: stop wanting playback so the interface says paused. */
  private giveUp() {
    this.wantPlaying = false;
    this.cancelPending();
    for (const v of this.voices()) v.el?.pause();
    this.setFader(steady(0));
    this.events.onChange();
  }

  private voices(): Voice[] {
    const out: Voice[] = [];
    if (this.current) out.push(this.current);
    if (this.pending) out.push(this.pending.to);
    for (const r of this.retiring) out.push(r.voice);
    return out;
  }

  private bufferVoice(track: LibraryTrack, decoded: DecodedTrack, offset: number, startAt: number): Voice {
    const ctx = this.ctx!;
    const source = ctx.createBufferSource();
    source.buffer = decoded.buffer;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(gain).connect(this.bus!);
    const length = decoded.window.end - decoded.window.start;
    const at = Math.max(0, Math.min(offset, length - 0.01));
    // The duration argument stops playback at the window's end, before the encoder padding.
    const when = Math.max(startAt, ctx.currentTime);
    source.start(when, decoded.window.start + at, length - at);
    const voice: Voice = {
      track,
      gain,
      env: steady(0),
      startAt: when,
      offset: at,
      decoded,
      source,
      el: null,
      audible: true,
      ended: false,
      disposed: false,
    };
    source.onended = () => this.ended(voice);
    return voice;
  }

  private streamVoice(track: LibraryTrack, from: number, routed = !this.unrouted, attempt = 0): Voice {
    const ctx = this.ctx!;
    const el = new Audio();
    el.preload = 'auto';
    if (routed) el.crossOrigin = 'anonymous';
    el.src = track.url;
    if (from > 0) el.currentTime = from;
    let gain: GainNode | null = null;
    if (routed) {
      gain = ctx.createGain();
      gain.gain.value = 0;
      ctx.createMediaElementSource(el).connect(gain).connect(this.bus!);
    } else {
      el.volume = 0;
    }
    const voice: Voice = {
      track,
      gain,
      env: steady(0),
      startAt: ctx.currentTime,
      offset: from,
      decoded: null,
      source: null,
      el,
      audible: false,
      ended: false,
      disposed: false,
    };
    el.addEventListener('playing', () => {
      voice.audible = true;
      // The routed element failed, the probe says CORS is refused, and this unrouted one plays: the host has no CORS.
      if (!routed && voice.noCors && !this.unrouted) {
        this.unrouted = true;
        console.warn('[music] The music host sends no CORS headers; playing without gapless transitions.');
      }
      if (voice === this.current) this.events.onChange();
    });
    for (const ev of ['waiting', 'canplay', 'durationchange']) el.addEventListener(ev, () => voice === this.current && this.events.onChange());
    el.addEventListener('ended', () => this.ended(voice));
    el.addEventListener('error', () => {
      if (voice.disposed) return;
      if (routed && !voice.audible) {
        void this.retryStream(voice, attempt);
        return;
      }
      this.streamFailed(voice, 'This track could not be loaded.');
    });
    if (!routed) this.ensureEmulator();
    return voice;
  }

  /** A stream failed: the current voice recovers; a committed next one is undone and tried again later. */
  private streamFailed(voice: Voice, message: string) {
    if (voice === this.current) this.recoverFrom(voice, message);
    else if (this.pending?.to === voice) {
      this.streamBlockedUntil = (this.ctx?.currentTime ?? 0) + STREAM_RETRY_S;
      this.cancelPending();
    }
  }

  /**
   * A routed element failed before it sounded. A `fetch` probe says why:
   * refused (no CORS), so play it unrouted; answered (the host allows CORS),
   * so the failure was transient and the routed element is tried again.
   */
  private async retryStream(failed: Voice, attempt: number): Promise<void> {
    const corsOk = await this.probeCors(failed.track.url);
    if (failed.disposed) return;
    if (failed !== this.current) {
      this.streamFailed(failed, 'This track could not be loaded.');
      return;
    }
    if (!corsOk) this.replaceStream(failed, false, attempt);
    else if (attempt + 1 < ROUTED_ATTEMPTS) this.replaceStream(failed, true, attempt + 1);
    else this.recoverFrom(failed, 'This track could not be loaded.');
  }

  /** Whether the host answers a CORS request. Only headers are read; the body is cancelled. */
  private async probeCors(url: string): Promise<boolean> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), PROBE_MS);
    try {
      await this.fetchImpl(url, { mode: 'cors', credentials: 'omit', signal: abort.signal });
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
      abort.abort();
    }
  }

  /** Swaps a routed element that failed to load for a fresh one (routed or not) at the same place. */
  private replaceStream(failed: Voice, routed: boolean, attempt: number) {
    const replacement = this.streamVoice(failed.track, failed.offset, routed, attempt);
    replacement.noCors = !routed;
    replacement.env = failed.env;
    this.dispose(failed);
    this.current = replacement;
    if (this.wantPlaying) {
      replacement.el!.addEventListener('playing', () => this.handOver(replacement), { once: true });
      void replacement.el!.play().catch(() => this.recoverFrom(replacement, 'This track could not be loaded.'));
    }
  }

  /** A voice failed: report it, and fall back to whatever was still playing while it loaded. */
  private recoverFrom(failed: Voice, message: string) {
    this.events.onError(failed.track, message);
    if (failed === this.current) {
      this.dispose(failed);
      const waiting = this.retiring.filter((r) => r.until === Infinity && !r.voice.disposed);
      const fallback = waiting.pop()?.voice ?? null;
      this.retiring = this.retiring.filter((r) => r.voice !== fallback);
      this.current = fallback;
      if (!fallback) this.wantPlaying = false;
    }
    this.events.onChange();
  }

  /** Writes an envelope to a voice's gain on the audio clock, and remembers it. */
  private setEnv(voice: Voice, env: Envelope) {
    const before = voice.env;
    voice.env = env;
    if (voice.gain) this.writeParam(voice.gain.gain, env, before);
  }

  private setFader(env: Envelope) {
    const before = this.faderEnv;
    this.faderEnv = env;
    if (this.fader) this.writeParam(this.fader.gain, env, before);
  }

  /**
   * Replaces a parameter's automation with an envelope.
   *
   * Cancelling restores the value from before any curve in progress, so the
   * value the old envelope has *now* is pinned first: no jump.
   */
  private writeParam(param: AudioParam, env: Envelope, before: Envelope) {
    const now = this.ctx!.currentTime;
    const held = envelopeAt(before, now);
    param.cancelScheduledValues(now);
    param.setValueAtTime(held, now);
    const start = Math.max(env.t0, now + 0.001);
    // Too short to draw (a curve needs a positive duration): jump to the end value.
    if (env.t1 <= env.t0 || env.t1 < start + 0.001) {
      param.setValueAtTime(env.to, Math.max(now, env.t1));
      return;
    }
    const curve = fadeCurve(env, start);
    // Glide from the pinned value to where the curve begins (normally the same value).
    if (start > now + 0.002) param.linearRampToValueAtTime(curve[0], start - 0.001);
    param.setValueCurveAtTime(curve, start, env.t1 - start);
  }

  private fadeOutAndRetire(voice: Voice, t0: number, t1: number) {
    this.setEnv(voice, { t0, t1, from: envelopeAt(voice.env, t0), to: 0 });
    this.retiring.push({ voice, until: t1 + 0.05 });
  }

  private dispose(voice: Voice) {
    if (voice.disposed) return;
    voice.disposed = true;
    if (voice.source) {
      voice.source.onended = null;
      try {
        voice.source.stop();
      } catch {
        // Never started or already stopped.
      }
      voice.source.disconnect();
    }
    if (voice.el) {
      voice.el.pause();
      voice.el.removeAttribute('src');
      voice.el.load();
    }
    voice.gain?.disconnect();
  }

  // ---------------------------------------------------------------- timeline

  private positionOf(v: Voice): number {
    if (v.el) return v.el.currentTime || v.offset;
    const now = this.ctx?.currentTime ?? 0;
    return v.offset + Math.max(0, now - v.startAt);
  }

  private lengthOf(v: Voice): number {
    if (v.decoded) return v.decoded.window.end - v.decoded.window.start;
    if (v.el && Number.isFinite(v.el.duration) && v.el.duration > 0) return v.el.duration;
    return v.track.duration;
  }

  /** The audio-clock time at which `v` reaches track position `p`. */
  private clockAt(v: Voice, p: number): number {
    const now = this.ctx!.currentTime;
    if (v.el) return now + (p - v.el.currentTime);
    return v.startAt + (p - v.offset);
  }

  private decodedFor(id: string): DecodedTrack | null {
    return this.unrouted ? null : this.loader?.get(id) ?? null;
  }

  /** When the transition out of `cur` into `next` would run. */
  private planFor(cur: Voice, next: LibraryTrack, now: number): FadePlan {
    const own = cur.decoded ?? this.decodedFor(cur.track.id);
    const length = this.lengthOf(cur);
    const end = cur.el ? length - STREAM_END_MARGIN : length;
    const out = Math.min(end, own ? own.cues.out : end);
    const incoming = this.decodedFor(next.id);
    const nextSpan = incoming ? incoming.cues.out - incoming.cues.in : next.duration;
    const fade = fadeLength(out - (own?.cues.in ?? 0), nextSpan, next.id === cur.track.id ? LOOP_FADE : TRACK_FADE);
    return planCrossfade(now, this.clockAt(cur, out), this.clockAt(cur, end), fade, LEAD);
  }

  /** Commits the transition out of the current voice to the audio clock. */
  private schedule(cur: Voice, next: LibraryTrack, plan: FadePlan) {
    let target = next;
    let decoded = this.decodedFor(next.id);
    let advances = true;
    if (!decoded) {
      // The next track is not ready: keep the current one going, looped, and keep retrying.
      const own = cur.decoded ?? this.decodedFor(cur.track.id);
      if (own) {
        target = cur.track;
        decoded = own;
        advances = next.id === cur.track.id;
      }
    }
    let incoming: Voice;
    if (decoded) {
      incoming = this.bufferVoice(target, decoded, decoded.cues.in, plan.start);
    } else {
      // Nothing decodable (no CORS, or every download failing): an element, started by timer.
      incoming = this.streamVoice(target, 0);
      const el = incoming.el!;
      const delay = Math.max(0, (plan.start - this.ctx!.currentTime) * 1000 - 40);
      setTimeout(() => {
        if (!incoming.disposed) void el.play().catch(() => {});
      }, delay);
    }
    this.setEnv(incoming, { t0: plan.start, t1: plan.end, from: 0, to: 1 });
    this.setEnv(cur, { t0: plan.start, t1: plan.end, from: envelopeAt(cur.env, plan.start), to: 0 });
    this.pending = { from: cur, to: incoming, plan, advances };
  }

  /** Undoes a committed transition that has not started; one already under way is completed instead. */
  private cancelPending() {
    const p = this.pending;
    if (!p || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (now >= p.plan.start) {
      this.promote();
      return;
    }
    this.pending = null;
    this.dispose(p.to);
    this.setEnv(p.from, steady(envelopeAt(p.from.env, now)));
  }

  private promote() {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    this.current = p.to;
    this.retiring.push({ voice: p.from, until: p.plan.end + 0.05 });
    if (p.advances) {
      this.unrouted = false;
      this.events.onAdvance(p.to.track);
    } else this.events.onChange();
  }

  /** A voice's audio ran out. */
  private ended(voice: Voice) {
    voice.ended = true;
    if (voice.disposed || voice !== this.current) return;
    if (this.pending) {
      this.promote();
      return;
    }
    // Normally a transition took over long before this. Reaching here means the queue ends, or timers were frozen.
    const next = this.wantPlaying ? this.events.nextTrack() : null;
    if (next) void this.play(next).then(() => this.events.onAdvance(next));
    else {
      this.wantPlaying = false;
      this.events.onChange();
    }
  }

  private tick = () => {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    if (this.pending && now >= this.pending.plan.start) this.promote();

    this.retiring = this.retiring.filter((r) => {
      if (now < r.until) return true;
      this.dispose(r.voice);
      return false;
    });

    const cur = this.current;
    const next = cur ? this.events.nextTrack() : null;
    if (this.loader) {
      if (cur && !this.unrouted) this.loader.want(cur.track);
      // The next track is fetched now and decoded when its transition nears.
      if (next && !this.unrouted) this.loader.want(next, { decode: false });
      this.loader.retain(
        [cur?.track.id, next?.id, this.pending?.to.track.id, ...this.retiring.map((r) => r.voice.track.id)].filter((id): id is string => Boolean(id))
      );
    }

    if (!this.wantPlaying) {
      if (this.retiring.length === 0 && !this.pending) this.stopTimer();
      return;
    }
    if (!cur || !cur.audible || cur.ended || this.pending || !next) return;
    const plan = this.planFor(cur, next, now);
    const untilStart = plan.start - now;
    if (untilStart <= DECODE_LEAD && !this.unrouted) this.loader?.want(next);
    const nextReady = this.decodedFor(next.id) !== null;
    if (transitionStep(untilStart, nextReady) === 'wait') return;
    // With nothing decoded to play from, a stream stands in; after one failed, pause before another.
    if (!nextReady && !(cur.decoded ?? this.decodedFor(cur.track.id)) && now < this.streamBlockedUntil) return;
    this.schedule(cur, next, plan);
  };

  /** Drives the volume of unrouted elements along the same curves the routed ones follow. */
  private emulate = () => {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const master = volumeToGain(this.volume) * envelopeAt(this.faderEnv, now);
    let any = false;
    for (const v of this.voices()) {
      if (!v.el || v.gain || v.disposed) continue;
      any = true;
      v.el.volume = Math.min(1, Math.max(0, master * envelopeAt(v.env, now)));
    }
    if (!any && this.emulator) {
      clearInterval(this.emulator);
      this.emulator = null;
    }
  };

  private ensureEmulator() {
    this.emulator ??= setInterval(this.emulate, EMULATE_MS);
  }

  private ensureTimer() {
    this.timer ??= setInterval(this.tick, TICK_MS);
  }

  private stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private clearSuspend() {
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    this.suspendTimer = null;
  }
}

/** The context, at a lower sample rate on devices that report little memory: decoded audio is large. */
function newContext(Ctor: typeof AudioContext): AudioContext {
  const memory = (navigator as { deviceMemory?: number }).deviceMemory;
  if (typeof memory === 'number' && memory <= 4) {
    try {
      return new Ctor({ latencyHint: 'playback', sampleRate: LOW_MEMORY_RATE });
    } catch {
      // A browser that cannot pick the rate uses its own.
    }
  }
  return new Ctor({ latencyHint: 'playback' });
}

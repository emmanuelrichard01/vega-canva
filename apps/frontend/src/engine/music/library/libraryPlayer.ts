/**
 * Two HTML audio decks that stream library tracks and crossfade between them.
 *
 * - Streaming is the browser's own: `<audio>` issues range requests, so a
 *   track starts after its first few seconds arrive and seeking fetches only
 *   what is needed.
 * - The idle deck preloads the next track while the current one plays, so a
 *   transition is a crossfade between two buffered files, not a cut followed
 *   by a network wait.
 * - Gains are ramped on a short timer with equal-power curves. Element volume
 *   is used rather than Web Audio, because routing cross-origin media through
 *   Web Audio needs CORS headers on the bucket and is silent without them.
 */
import { deckGains, fadeLength, fadeStart } from './crossfade';
import type { LibraryTrack } from './manifest';

const TICK_MS = 50;
/** A manual skip fades quickly; an automatic transition takes the full crossfade. */
const SKIP_FADE = 0.8;
const PAUSE_FADE = 0.45;

export interface DeckSnapshot {
  trackId: string | null;
  playing: boolean;
  position: number;
  duration: number;
  buffering: boolean;
}

export interface LibraryPlayerEvents {
  /** The current track is about to end; returns the track to crossfade into, or null to stop. */
  nextTrack: () => LibraryTrack | null;
  /** The crossfade target became current. */
  onAdvance: (track: LibraryTrack) => void;
  onChange: () => void;
  onError: (track: LibraryTrack, message: string) => void;
}

interface Deck {
  el: HTMLAudioElement;
  track: LibraryTrack | null;
}

function makeDeck(): Deck {
  const el = new Audio();
  el.preload = 'auto';
  return { el, track: null };
}

export class LibraryPlayer {
  private a: Deck = makeDeck();
  private b: Deck = makeDeck();
  /** Index into [a, b] of the deck that is current. */
  private live: 0 | 1 = 0;
  private volume = 0.6;
  private timer: ReturnType<typeof setInterval> | null = null;
  private fade: { from: Deck; to: Deck; started: number; length: number; reason: 'auto' | 'skip' } | null = null;
  private pausing: { started: number } | null = null;
  private wantPlaying = false;

  private events: LibraryPlayerEvents;

  constructor(events: LibraryPlayerEvents) {
    this.events = events;
    for (const deck of [this.a, this.b]) {
      deck.el.addEventListener('error', () => {
        if (deck.track && deck === this.current) this.events.onError(deck.track, 'This track could not be loaded.');
      });
      for (const ev of ['playing', 'pause', 'waiting', 'durationchange', 'ended', 'loadedmetadata']) {
        deck.el.addEventListener(ev, () => {
          if (deck === this.current) this.events.onChange();
          if (ev === 'ended' && deck === this.current && !this.fade) this.handleEnded();
        });
      }
    }
  }

  private get current(): Deck {
    return this.live === 0 ? this.a : this.b;
  }

  private get spare(): Deck {
    return this.live === 0 ? this.b : this.a;
  }

  snapshot(): DeckSnapshot {
    const d = this.current;
    const duration = Number.isFinite(d.el.duration) && d.el.duration > 0 ? d.el.duration : d.track?.duration ?? 0;
    return {
      trackId: d.track?.id ?? null,
      playing: this.wantPlaying,
      position: d.el.currentTime || 0,
      duration,
      buffering: this.wantPlaying && d.el.readyState < 3 && !d.el.paused,
    };
  }

  /** Puts `track` on the spare deck without playing it, so it is ready when needed. */
  preload(track: LibraryTrack | null): void {
    const spare = this.spare;
    if (this.fade || !track || spare.track?.id === track.id) return;
    spare.track = track;
    spare.el.src = track.url;
    spare.el.volume = 0;
    spare.el.load();
  }

  /** Plays `track` now: a quick fade from whatever is playing, or a soft start from silence. */
  async play(track: LibraryTrack, from = 0): Promise<void> {
    this.wantPlaying = true;
    this.pausing = null;
    const outgoing = this.current;
    const incoming = outgoing.track?.id === track.id && !this.fade ? outgoing : this.spare;
    if (incoming !== outgoing) {
      if (incoming.track?.id !== track.id) {
        incoming.track = track;
        incoming.el.src = track.url;
      }
      incoming.el.currentTime = from;
      incoming.el.volume = 0;
      this.live = incoming === this.a ? 0 : 1;
      this.fade = {
        from: outgoing,
        to: incoming,
        started: performance.now(),
        length: outgoing.track && !outgoing.el.paused ? SKIP_FADE : 0.35,
        reason: 'skip',
      };
    } else {
      if (from) incoming.el.currentTime = from;
      this.fade = { from: incoming, to: incoming, started: performance.now(), length: 0.35, reason: 'skip' };
    }
    this.ensureTimer();
    try {
      await incoming.el.play();
    } catch (e) {
      // Autoplay refusals and network failures surface the same way: not playing.
      this.wantPlaying = false;
      if ((e as DOMException)?.name !== 'AbortError') this.events.onError(track, 'Playback was blocked or the track could not be loaded.');
    }
    this.events.onChange();
  }

  /** Fades out, then pauses. */
  pause(): void {
    if (!this.wantPlaying) return;
    this.wantPlaying = false;
    this.fade = null;
    this.pausing = { started: performance.now() };
    this.ensureTimer();
    this.events.onChange();
  }

  async resume(): Promise<void> {
    const d = this.current;
    if (!d.track) return;
    await this.play(d.track, d.el.currentTime);
  }

  seek(seconds: number): void {
    const d = this.current;
    if (!d.track) return;
    d.el.currentTime = Math.max(0, Math.min(seconds, (Number.isFinite(d.el.duration) ? d.el.duration : d.track.duration) - 0.25));
    this.events.onChange();
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    if (!this.fade && !this.pausing && this.wantPlaying) this.current.el.volume = this.volume * this.volume;
  }

  stop(): void {
    this.wantPlaying = false;
    this.fade = null;
    this.pausing = null;
    for (const d of [this.a, this.b]) {
      d.el.pause();
      d.el.removeAttribute('src');
      d.el.load();
      d.track = null;
    }
    this.stopTimer();
    this.events.onChange();
  }

  private handleEnded() {
    const next = this.events.nextTrack();
    if (next) void this.play(next).then(() => this.events.onAdvance(next));
    else {
      this.wantPlaying = false;
      this.events.onChange();
    }
  }

  private ensureTimer() {
    this.timer ??= setInterval(this.tick, TICK_MS);
  }

  private stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick = () => {
    const gain = this.volume * this.volume;
    const now = performance.now();

    if (this.pausing) {
      const p = Math.min(1, (now - this.pausing.started) / (PAUSE_FADE * 1000));
      const d = this.current;
      d.el.volume = gain * (1 - p);
      this.spare.el.pause();
      if (p >= 1) {
        d.el.pause();
        this.pausing = null;
        this.stopTimer();
        this.events.onChange();
      }
      return;
    }

    if (this.fade) {
      const { from, to, started, length } = this.fade;
      const elapsed = (now - started) / 1000;
      const g = deckGains(elapsed, length, gain);
      to.el.volume = Math.min(1, g.in);
      if (from !== to) from.el.volume = Math.min(1, g.out);
      if (elapsed >= length) {
        if (from !== to) {
          from.el.pause();
          from.el.volume = 0;
        }
        to.el.volume = gain;
        this.fade = null;
      }
      return;
    }

    if (!this.wantPlaying) {
      this.stopTimer();
      return;
    }

    // Start the automatic crossfade when the current track nears its end.
    const d = this.current;
    if (!d.track || d.el.paused) return;
    const duration = Number.isFinite(d.el.duration) && d.el.duration > 0 ? d.el.duration : d.track.duration;
    const next = this.events.nextTrack();
    if (!next) return;
    const length = fadeLength(duration, next.duration);
    if (length > 0.5 && d.el.currentTime >= fadeStart(duration, length)) {
      const incoming = this.spare;
      if (incoming.track?.id !== next.id) {
        incoming.track = next;
        incoming.el.src = next.url;
      }
      incoming.el.currentTime = 0;
      incoming.el.volume = 0;
      this.live = incoming === this.a ? 0 : 1;
      this.fade = { from: d, to: incoming, started: now, length, reason: 'auto' };
      void incoming.el.play().then(
        () => this.events.onAdvance(next),
        () => this.events.onError(next, 'The next track could not be played.')
      );
    }
  };
}

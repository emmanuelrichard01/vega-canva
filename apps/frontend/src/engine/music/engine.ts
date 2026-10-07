/**
 * The generative music engine: one AudioContext, a master chain, and a
 * lookahead scheduler that composes and performs a bar at a time.
 *
 * - The context is created on the first `play()`, which must come from a user
 *   gesture; browsers refuse audio that starts any other way.
 * - Scheduling runs on the audio clock with a short lookahead. A timer only
 *   decides *when to compose*; every note is placed on `ctx.currentTime`
 *   precisely, so timer jitter never reaches the music.
 * - Each play or variation gets its own bus. Stopping fades the master and
 *   disconnects the bus, so notes already scheduled into the future fall
 *   silent instead of playing on after a pause.
 * - When paused the context is suspended, which costs no CPU at all.
 */
import { createSession, composeBar, stationById, type Session, type StationId } from './stations';
import { barsDue, barSeconds, eventTime, secondsPerBeat, volumeToGain } from './timing';
import { createCrackle, createImpulse, createKit, playVoice, type Kit, type Outputs } from './voices';

/** How far ahead notes are placed. Longer while hidden, when timers are throttled. */
const LOOKAHEAD_VISIBLE = 0.35;
const LOOKAHEAD_HIDDEN = 2.5;
const TICK_MS = 60;
const FADE_IN = 1.6;
const FADE_OUT = 1.1;
const CROSSFADE = 2.4;
/** Hidden this long while playing, the engine pauses itself. */
export const HIDDEN_AUTO_PAUSE_MS = 45 * 60 * 1000;

export interface NowPlaying {
  station: StationId;
  seed: number;
  /** Tonic pitch class and mode. */
  key: Session['key'];
  bpm: number;
}

interface Bus {
  session: Session;
  gain: GainNode;
  outputs: Outputs;
  nextBar: number;
  nextBarStart: number;
  voicing: number[] | null;
  extras: AudioNode[];
}

type Listener = () => void;

export class MusicEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private fade: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private kit: Kit | null = null;
  private bus: Bus | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private hiddenTimer: ReturnType<typeof setTimeout> | null = null;
  private volume = 0.6;
  private playing = false;
  private listeners = new Set<Listener>();

  /** Called when the engine pauses itself (the hidden-tab guard). */
  onAutoPause: (() => void) | null = null;

  get isPlaying() {
    return this.playing;
  }

  get nowPlaying(): NowPlaying | null {
    if (!this.bus) return null;
    const s = this.bus.session;
    return { station: s.station.id, seed: s.seed, key: s.key, bpm: s.bpm };
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  private ensureContext(): AudioContext {
    if (this.ctx) return this.ctx;
    const Ctor: typeof AudioContext =
      (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor({ latencyHint: 'playback' });

    const master = ctx.createGain();
    master.gain.value = volumeToGain(this.volume);
    const fade = ctx.createGain();
    fade.gain.value = 0.0001;
    // Glue, then a brick wall: the stations stay polite at any volume.
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -20;
    glue.ratio.value = 3;
    glue.attack.value = 0.02;
    glue.release.value = 0.25;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -4;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.1;
    master.connect(fade).connect(glue).connect(limiter).connect(ctx.destination);

    const reverb = ctx.createConvolver();
    reverb.buffer = createImpulse(ctx);
    const reverbReturn = ctx.createGain();
    reverbReturn.gain.value = 0.55;
    reverb.connect(reverbReturn).connect(master);

    this.ctx = ctx;
    this.master = master;
    this.fade = fade;
    this.reverb = reverb;
    this.kit = createKit(ctx);
    document.addEventListener('visibilitychange', this.onVisibility);
    return ctx;
  }

  private buildBus(session: Session): Bus {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = session.station.id === 'lofi' ? 3400 : 16000;
    tone.Q.value = 0.3;
    gain.connect(tone).connect(this.master!);

    const extras: AudioNode[] = [tone];

    // A tempo-synced dotted-eighth delay with a darkening feedback loop.
    const delay = ctx.createDelay(2);
    delay.delayTime.value = secondsPerBeat(session.bpm) * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2200;
    delay.connect(damp).connect(fb).connect(delay);
    const delayOut = ctx.createGain();
    delayOut.gain.value = 0.35;
    damp.connect(delayOut).connect(gain);
    extras.push(delay, fb, damp, delayOut);

    const reverbSend = ctx.createGain();
    reverbSend.gain.value = 1;
    reverbSend.connect(this.reverb!);
    extras.push(reverbSend);

    if (session.station.id === 'lofi') {
      const crackle = ctx.createBufferSource();
      crackle.buffer = createCrackle(ctx);
      crackle.loop = true;
      const level = ctx.createGain();
      level.gain.value = 0.05;
      crackle.connect(level).connect(gain);
      crackle.start();
      extras.push(crackle, level);
    }

    return {
      session,
      gain,
      outputs: { ctx, dry: gain, reverb: reverbSend, delay, kit: this.kit! },
      nextBar: 0,
      nextBarStart: ctx.currentTime + 0.12,
      voicing: null,
      extras,
    };
  }

  private retire(bus: Bus, over: number) {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    bus.gain.gain.cancelScheduledValues(now);
    bus.gain.gain.setValueAtTime(Math.max(0.0001, bus.gain.gain.value), now);
    bus.gain.gain.exponentialRampToValueAtTime(0.0001, now + over);
    setTimeout(() => {
      for (const node of bus.extras) {
        if (node instanceof AudioBufferSourceNode) {
          try {
            node.stop();
          } catch {
            // Already stopped.
          }
        }
        node.disconnect();
      }
      bus.gain.disconnect();
    }, over * 1000 + 200);
  }

  private tick = () => {
    const ctx = this.ctx;
    const bus = this.bus;
    if (!ctx || !bus || !this.playing) return;
    const { session } = bus;
    const lookahead = document.hidden ? LOOKAHEAD_HIDDEN : LOOKAHEAD_VISIBLE;
    const starts = barsDue(bus.nextBarStart, ctx.currentTime, lookahead, session.bpm, session.station.beatsPerBar);
    const spb = secondsPerBeat(session.bpm);
    for (const start of starts) {
      const plan = composeBar(session, bus.nextBar, bus.voicing);
      for (const ev of plan.events) {
        const t = eventTime(start, ev.beat, session.bpm, session.station.swing);
        if (t < ctx.currentTime) continue;
        playVoice(ev.voice, bus.outputs, { t, dur: ev.dur * spb, midi: ev.midi, vel: ev.vel, spb });
      }
      bus.voicing = plan.voicing;
      bus.nextBar += 1;
      bus.nextBarStart = start + barSeconds(session.bpm, session.station.beatsPerBar);
    }
  };

  /** Starts (or switches to) a station. Call from a user gesture. */
  async play(station: StationId, seed: number): Promise<void> {
    const ctx = this.ensureContext();
    if (ctx.state !== 'running') await ctx.resume();
    const session = createSession(stationById(station), seed);
    const previous = this.bus;
    const next = this.buildBus(session);
    const now = ctx.currentTime;
    const wasPlaying = this.playing;

    next.gain.gain.setValueAtTime(0.0001, now);
    next.gain.gain.exponentialRampToValueAtTime(1, now + (previous && wasPlaying ? CROSSFADE : 0.05));
    if (previous) this.retire(previous, wasPlaying ? CROSSFADE : 0.05);
    this.bus = next;

    if (!wasPlaying) {
      const fade = this.fade!.gain;
      fade.cancelScheduledValues(now);
      fade.setValueAtTime(Math.max(0.0001, fade.value), now);
      fade.exponentialRampToValueAtTime(1, now + FADE_IN);
    }

    this.playing = true;
    if (!this.timer) this.timer = setInterval(this.tick, TICK_MS);
    this.tick();
    this.emit();
  }

  /** Fades out, then suspends the context so nothing runs while paused. */
  async pause(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || !this.playing) return;
    this.playing = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const now = ctx.currentTime;
    const fade = this.fade!.gain;
    fade.cancelScheduledValues(now);
    fade.setValueAtTime(Math.max(0.0001, fade.value), now);
    fade.exponentialRampToValueAtTime(0.0001, now + FADE_OUT);
    const bus = this.bus;
    this.bus = null;
    if (bus) this.retire(bus, FADE_OUT);
    this.emit();
    await new Promise((r) => setTimeout(r, FADE_OUT * 1000 + 250));
    // Playback may have resumed during the fade.
    if (!this.playing && ctx.state === 'running') await ctx.suspend();
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(volumeToGain(this.volume), this.ctx.currentTime, 0.05);
    }
  }

  private onVisibility = () => {
    if (this.hiddenTimer) {
      clearTimeout(this.hiddenTimer);
      this.hiddenTimer = null;
    }
    if (document.hidden && this.playing) {
      // Run a tick now so the longer lookahead fills before throttling starts.
      this.tick();
      this.hiddenTimer = setTimeout(() => {
        if (document.hidden && this.playing) {
          void this.pause();
          this.onAutoPause?.();
        }
      }, HIDDEN_AUTO_PAUSE_MS);
    }
  };

  /** Releases the context entirely. */
  async dispose(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.hiddenTimer) clearTimeout(this.hiddenTimer);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.playing = false;
    this.bus = null;
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx) await ctx.close();
  }
}

let shared: MusicEngine | null = null;
/** The one engine for the page. */
export function musicEngine(): MusicEngine {
  shared ??= new MusicEngine();
  return shared;
}

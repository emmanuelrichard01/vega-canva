/**
 * The instruments: small Web Audio synth patches, one function per voice.
 *
 * Each call builds a short-lived node chain for one note and schedules its
 * own stop, so nothing needs tracking afterwards. Levels are set low on
 * purpose; the master chain adds gain and limiting once, for everything.
 */
import { midiToHz } from './theory';
import type { Voice } from './stations';

/** The nodes every note can reach. */
export interface Outputs {
  ctx: BaseAudioContext;
  /** Dry signal for this station session. */
  dry: AudioNode;
  /** Send into the shared reverb. */
  reverb: AudioNode;
  /** Send into the tempo-synced delay. */
  delay: AudioNode;
  /** Shared resources built once per context. */
  kit: Kit;
}

export interface Kit {
  noise: AudioBuffer;
  pianoWave: PeriodicWave;
  chipPulse: PeriodicWave;
}

export function createKit(ctx: BaseAudioContext): Kit {
  const len = Math.floor(ctx.sampleRate);
  const noise = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noise.getChannelData(0);
  // A fixed LCG so the noise buffer, like everything else, is deterministic.
  let s = 0x2545f491;
  for (let i = 0; i < len; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    data[i] = (s / 4294967296) * 2 - 1;
  }
  // Piano partials: a bright attack that the per-note filter then darkens.
  const pianoReal = new Float32Array([0, 1, 0.42, 0.2, 0.11, 0.06, 0.035, 0.02, 0.012]);
  const pianoWave = ctx.createPeriodicWave(pianoReal, new Float32Array(pianoReal.length));
  // A 25% pulse, the classic chiptune lead.
  const n = 32;
  const pr = new Float32Array(n);
  const pi = new Float32Array(n);
  for (let k = 1; k < n; k++) pi[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * 0.25);
  const chipPulse = ctx.createPeriodicWave(pr, pi);
  return { noise, pianoWave, chipPulse };
}

/** A reverb impulse: decaying stereo noise, built offline once. */
export function createImpulse(ctx: BaseAudioContext, seconds = 2.8, decay = 3): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  let s = 0x9e3779b9;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      d[i] = ((s / 4294967296) * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

/** Vinyl surface noise: a quiet hiss bed with sparse, soft clicks. Looped. */
export function createCrackle(ctx: BaseAudioContext, seconds = 5): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let s = 0x1b873593;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  let lp = 0;
  for (let i = 0; i < len; i++) {
    lp = lp * 0.97 + (rnd() * 2 - 1) * 0.03;
    d[i] = lp * 0.5;
    if (rnd() < 0.00035) {
      const amp = 0.15 + rnd() * 0.35;
      const sign = rnd() < 0.5 ? -1 : 1;
      for (let k = 0; k < 24 && i + k < len; k++) d[i + k] += sign * amp * Math.exp(-k / 4);
    }
  }
  return buf;
}

const env = (g: GainNode, t: number, peak: number, attack: number, hold: number, release: number) => {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.setValueAtTime(Math.max(0.0002, peak), t + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
};

const percEnv = (g: GainNode, t: number, peak: number, decay: number) => {
  g.gain.setValueAtTime(Math.max(0.0002, peak), t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
};

function osc(ctx: BaseAudioContext, type: OscillatorType, freq: number, t: number, stop: number, detune = 0) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (detune) o.detune.setValueAtTime(detune, t);
  o.start(t);
  o.stop(stop);
  return o;
}

function noiseSource(out: Outputs, t: number, stop: number) {
  const src = out.ctx.createBufferSource();
  src.buffer = out.kit.noise;
  // A different window into the buffer each hit, so repeats don't sound identical.
  src.start(t, (t * 7.31) % 0.8);
  src.stop(stop);
  return src;
}

function send(node: AudioNode, out: Outputs, dry: number, wet: number, echo = 0) {
  const ctx = out.ctx;
  const d = ctx.createGain();
  d.gain.value = dry;
  node.connect(d).connect(out.dry);
  if (wet > 0) {
    const w = ctx.createGain();
    w.gain.value = wet;
    node.connect(w).connect(out.reverb);
  }
  if (echo > 0) {
    const e = ctx.createGain();
    e.gain.value = echo;
    node.connect(e).connect(out.delay);
  }
}

export interface PlayArgs {
  t: number;
  /** Seconds. */
  dur: number;
  midi?: number;
  vel: number;
  /** Seconds per beat, for patches whose shape follows the tempo. */
  spb: number;
}

export function playVoice(voice: Voice, out: Outputs, a: PlayArgs): void {
  const ctx = out.ctx;
  const f = a.midi != null ? midiToHz(a.midi) : 0;
  const { t, dur, vel } = a;

  switch (voice) {
    case 'pad': {
      const release = 2.6;
      const end = t + dur + release;
      const g = ctx.createGain();
      env(g, t, vel * 0.055, 1.6, Math.max(0, dur - 1.6), release);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 0.4;
      lp.frequency.setValueAtTime(600, t);
      lp.frequency.linearRampToValueAtTime(1300 + vel * 500, t + dur * 0.6);
      lp.frequency.linearRampToValueAtTime(700, end);
      for (const det of [-7, 7]) osc(ctx, 'sawtooth', f, t, end, det).connect(lp);
      osc(ctx, 'triangle', f / 2, t, end).connect(lp);
      lp.connect(g);
      send(g, out, 0.8, 0.6);
      return;
    }
    case 'pluck': {
      const g = ctx.createGain();
      percEnv(g, t, vel * 0.16, 1.9);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(3200, t);
      lp.frequency.exponentialRampToValueAtTime(900, t + 0.6);
      osc(ctx, 'triangle', f, t, t + 2).connect(lp);
      const h = ctx.createGain();
      h.gain.value = 0.35;
      osc(ctx, 'sine', f * 2, t, t + 2).connect(h).connect(lp);
      lp.connect(g);
      send(g, out, 0.7, 0.75);
      return;
    }
    case 'piano': {
      const register = Math.max(0, Math.min(1, ((a.midi ?? 60) - 36) / 48));
      const decay = 4.2 - register * 2.6;
      const end = t + Math.min(dur + 0.4, decay);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vel * 0.2, t + 0.006);
      g.gain.setTargetAtTime(0.0001, t + 0.006, decay / 4);
      g.gain.setTargetAtTime(0.0001, end - 0.15, 0.05);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(1800 + vel * 4200, t);
      lp.frequency.setTargetAtTime(900 + register * 900, t + 0.01, 0.5);
      for (const det of [-3, 3]) {
        const o = ctx.createOscillator();
        o.setPeriodicWave(out.kit.pianoWave);
        o.frequency.setValueAtTime(f, t);
        o.detune.setValueAtTime(det, t);
        o.start(t);
        o.stop(end + 0.1);
        o.connect(lp);
      }
      // The hammer: a few milliseconds of filtered noise.
      const hammer = ctx.createGain();
      percEnv(hammer, t, vel * 0.05, 0.03);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = Math.min(6000, f * 4);
      noiseSource(out, t, t + 0.05).connect(bp).connect(hammer).connect(g);
      lp.connect(g);
      send(g, out, 0.85, 0.35);
      return;
    }
    case 'epiano': {
      const release = 0.5;
      const end = t + dur + release;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vel * 0.1, t + 0.012);
      g.gain.setTargetAtTime(vel * 0.06, t + 0.012, 0.6);
      g.gain.setTargetAtTime(0.0001, t + dur, release / 3);
      const carrier = osc(ctx, 'sine', f, t, end);
      const mod = osc(ctx, 'sine', f, t, end);
      const index = ctx.createGain();
      index.gain.setValueAtTime(f * 1.1, t);
      index.gain.setTargetAtTime(f * 0.15, t, 0.35);
      mod.connect(index).connect(carrier.frequency);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2600;
      carrier.connect(lp).connect(g);
      send(g, out, 0.9, 0.3);
      return;
    }
    case 'bass': {
      const end = t + dur + 0.2;
      const g = ctx.createGain();
      env(g, t, vel * 0.3, 0.012, Math.max(0, dur - 0.05), 0.18);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 420;
      osc(ctx, 'triangle', f, t, end).connect(lp);
      const s = ctx.createGain();
      s.gain.value = 0.6;
      osc(ctx, 'sine', f, t, end).connect(s).connect(lp);
      lp.connect(g);
      send(g, out, 1, 0.05);
      return;
    }
    case 'subBass': {
      const end = t + dur + 0.1;
      const g = ctx.createGain();
      env(g, t, vel * 0.16, 0.008, Math.max(0, dur - 0.08), 0.08);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 3;
      lp.frequency.setValueAtTime(900, t);
      lp.frequency.exponentialRampToValueAtTime(220, t + 0.18);
      osc(ctx, 'sawtooth', f, t, end).connect(lp).connect(g);
      send(g, out, 1, 0);
      return;
    }
    case 'kick': {
      const g = ctx.createGain();
      percEnv(g, t, vel * 0.7, 0.38);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(130, t);
      o.frequency.exponentialRampToValueAtTime(46, t + 0.11);
      o.start(t);
      o.stop(t + 0.42);
      o.connect(g);
      send(g, out, 1, 0);
      return;
    }
    case 'snare': {
      const g = ctx.createGain();
      percEnv(g, t, vel * 0.22, 0.2);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1900;
      bp.Q.value = 0.7;
      noiseSource(out, t, t + 0.25).connect(bp).connect(g);
      const body = ctx.createGain();
      percEnv(body, t, vel * 0.12, 0.09);
      osc(ctx, 'triangle', 190, t, t + 0.12).connect(body).connect(g);
      send(g, out, 0.9, 0.25);
      return;
    }
    case 'clap': {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      for (const [dt, p] of [[0, 1], [0.011, 0.8], [0.023, 0.9]] as const) {
        g.gain.setValueAtTime(vel * 0.2 * p, t + dt);
        g.gain.exponentialRampToValueAtTime(vel * 0.05, t + dt + 0.009);
      }
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1500;
      bp.Q.value = 1.1;
      noiseSource(out, t, t + 0.24).connect(bp).connect(g);
      send(g, out, 0.85, 0.35);
      return;
    }
    case 'hat':
    case 'openHat': {
      const decay = voice === 'hat' ? 0.05 : 0.24;
      const g = ctx.createGain();
      percEnv(g, t, vel * 0.16, decay);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 7200;
      noiseSource(out, t, t + decay + 0.02).connect(hp).connect(g);
      send(g, out, 0.9, 0.1);
      return;
    }
    case 'arp': {
      const end = t + dur + 0.25;
      const g = ctx.createGain();
      percEnv(g, t, vel * 0.11, Math.max(0.15, dur + 0.15));
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 5;
      // A slow sweep shared by every note: the cutoff is a function of time, so it is continuous across notes.
      const sweep = 900 + 1700 * (0.5 + 0.5 * Math.sin((2 * Math.PI * t) / 19));
      lp.frequency.setValueAtTime(sweep * 1.6, t);
      lp.frequency.exponentialRampToValueAtTime(sweep * 0.6, t + 0.18);
      osc(ctx, 'sawtooth', f, t, end, 4).connect(lp);
      osc(ctx, 'square', f, t, end, -4).connect(lp);
      lp.connect(g);
      send(g, out, 0.7, 0.3, 0.45);
      return;
    }
    case 'stab': {
      const end = t + dur + 0.2;
      const g = ctx.createGain();
      percEnv(g, t, vel * 0.08, dur + 0.15);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 2;
      lp.frequency.setValueAtTime(2400, t);
      lp.frequency.exponentialRampToValueAtTime(700, t + 0.2);
      for (const det of [-9, 9]) osc(ctx, 'sawtooth', f, t, end, det).connect(lp);
      lp.connect(g);
      send(g, out, 0.75, 0.45);
      return;
    }
    case 'chipLead': {
      const end = t + dur + 0.05;
      const g = ctx.createGain();
      env(g, t, vel * 0.075, 0.004, Math.max(0, dur - 0.04), 0.04);
      const o = ctx.createOscillator();
      o.setPeriodicWave(out.kit.chipPulse);
      o.frequency.setValueAtTime(f, t);
      // Delayed vibrato, the 8-bit signature.
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 6;
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(0, t);
      depth.gain.linearRampToValueAtTime(f * 0.012, t + Math.min(dur, 0.3));
      lfo.connect(depth).connect(o.frequency);
      lfo.start(t);
      lfo.stop(end);
      o.start(t);
      o.stop(end);
      o.connect(g);
      send(g, out, 0.85, 0.15, 0.25);
      return;
    }
    case 'chipBass': {
      const end = t + dur + 0.03;
      const g = ctx.createGain();
      env(g, t, vel * 0.22, 0.003, Math.max(0, dur - 0.03), 0.03);
      osc(ctx, 'triangle', f, t, end).connect(g);
      send(g, out, 1, 0);
      return;
    }
    case 'chipNoise': {
      const g = ctx.createGain();
      percEnv(g, t, vel * 0.12, 0.05);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 5200;
      noiseSource(out, t, t + 0.07).connect(hp).connect(g);
      send(g, out, 1, 0);
      return;
    }
  }
}

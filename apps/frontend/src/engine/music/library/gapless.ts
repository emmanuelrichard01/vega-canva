/**
 * Gapless playback maths for library tracks. Pure: no Web Audio here.
 *
 * Three problems make naive looping audible, and each has a function here:
 *
 * - **Encoder priming.** AAC starts with priming samples (1024 from ffmpeg,
 *   2112 from Apple's encoder) and ends on a partly padded frame. The MP4 edit
 *   list (`elst`) says which samples are real. Some browsers trim them in
 *   `decodeAudioData` and some do not, so `trimWindow` compares the decoded
 *   length with the edit list and decides which happened.
 * - **Musical edges.** Most tracks fade out over their last few seconds and
 *   some start with silence. A crossfade placed at the file's very end would
 *   overlap a near-silent tail with a near-silent start: a dip. `analyseCues`
 *   finds where the music actually starts and where its tail begins.
 * - **Timing.** Every transition is a pair of equal-power curves scheduled on
 *   the audio clock. `planCrossfade` says when; `fadeCurve` and `envelopeAt`
 *   say how loud.
 */

// ------------------------------------------------------------------ priming

export interface GaplessInfo {
  /** Seconds of encoder priming at the start of the decoded stream. */
  priming: number;
  /** Seconds of real audio after the priming. */
  duration: number;
}

interface Box {
  type: string;
  /** Start of the payload. */
  body: number;
  end: number;
}

function* boxes(view: DataView, from: number, to: number): Generator<Box> {
  let at = from;
  while (at + 8 <= to) {
    let size = view.getUint32(at);
    const type = String.fromCharCode(view.getUint8(at + 4), view.getUint8(at + 5), view.getUint8(at + 6), view.getUint8(at + 7));
    let header = 8;
    if (size === 1) {
      if (at + 16 > to) return;
      size = Number(view.getBigUint64(at + 8));
      header = 16;
    } else if (size === 0) {
      size = to - at;
    }
    if (size < header || at + size > to) return;
    yield { type, body: at + header, end: at + size };
    at += size;
  }
}

const child = (view: DataView, parent: Box, type: string): Box | null => {
  for (const b of boxes(view, parent.body, parent.end)) if (b.type === type) return b;
  return null;
};

/** Timescale and duration from an `mvhd` or `mdhd` box (both share the layout we read). */
function timing(view: DataView, box: Box): { timescale: number; duration: number } {
  const version = view.getUint8(box.body);
  return version === 1
    ? { timescale: view.getUint32(box.body + 20), duration: Number(view.getBigUint64(box.body + 24)) }
    : { timescale: view.getUint32(box.body + 12), duration: view.getUint32(box.body + 16) };
}

/**
 * Priming and real duration from an MP4/M4A file's first audio track.
 * Null when the file is not MP4 or has no edit list (MP3, WAV, Ogg).
 */
export function readGaplessInfo(data: ArrayBuffer | Uint8Array): GaplessInfo | null {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    const root: Box = { type: 'root', body: 0, end: bytes.byteLength };
    const moov = child(view, root, 'moov');
    if (!moov) return null;
    const mvhd = child(view, moov, 'mvhd');
    if (!mvhd) return null;
    const movie = timing(view, mvhd);
    for (const trak of boxes(view, moov.body, moov.end)) {
      if (trak.type !== 'trak') continue;
      const mdia = child(view, trak, 'mdia');
      const hdlr = mdia && child(view, mdia, 'hdlr');
      if (!mdia || !hdlr) continue;
      const handler = String.fromCharCode(...bytes.subarray(hdlr.body + 8, hdlr.body + 12));
      if (handler !== 'soun') continue;
      const mdhd = child(view, mdia, 'mdhd');
      const edts = child(view, trak, 'edts');
      const elst = edts && child(view, edts, 'elst');
      if (!mdhd || !elst) return null;
      const media = timing(view, mdhd);
      const version = view.getUint8(elst.body);
      const count = view.getUint32(elst.body + 4);
      let at = elst.body + 8;
      for (let i = 0; i < count; i++) {
        const segment = version === 1 ? Number(view.getBigUint64(at)) : view.getUint32(at);
        const mediaTime = version === 1 ? Number(view.getBigInt64(at + 8)) : view.getInt32(at + 4);
        at += version === 1 ? 20 : 12;
        // -1 is an empty edit (a delay before the track starts); the next entry is the real one.
        if (mediaTime < 0) continue;
        if (!media.timescale || !movie.timescale) return null;
        const priming = mediaTime / media.timescale;
        const duration = segment > 0 ? segment / movie.timescale : media.duration / media.timescale - priming;
        return duration > 0 ? { priming, duration } : null;
      }
      return null;
    }
  } catch {
    // A truncated or unusual file: play it untrimmed.
  }
  return null;
}

export interface TrimWindow {
  /** Seconds into the decoded buffer where the music starts. */
  start: number;
  /** Seconds into the decoded buffer where it ends. */
  end: number;
}

/**
 * Which part of a decoded buffer is real audio.
 *
 * A browser that kept the priming decodes roughly `priming + duration` (plus
 * up to a frame of padding); one that trimmed decodes roughly `duration`.
 */
export function trimWindow(decoded: number, info: GaplessInfo | null): TrimWindow {
  if (!info || info.duration <= 0) return { start: 0, end: decoded };
  // Padding is under one frame, so a trimmed decode stays short of priming + duration; allow only rounding from resampling.
  const tolerance = Math.min(info.priming / 2, 0.00004);
  const start = decoded >= info.priming + info.duration - tolerance ? info.priming : 0;
  return { start, end: Math.min(decoded, start + info.duration) };
}

// ------------------------------------------------------------------ cues

export interface Cues {
  /** Seconds into the window where the music has arrived; playback after a transition starts here. */
  in: number;
  /** Seconds into the window by which a crossfade out must have finished. */
  out: number;
}

const FRAME = 0.1;
/** A transition may start where the next 4 s never fall this far below the track's typical level (400 ms average). */
const IN_BELOW = 14;
const IN_SPAN = 40;
/** A tail begins where the 1 s average falls this far below the typical level. */
const OUT_BELOW = 9;
/** How much of a tail plays under the fade before it is cut. */
const TAIL_ALLOWANCE = 0.5;
/** Limits, so a long quiet section is never mistaken for an intro or outro. */
const MAX_IN = 20;
const MAX_TAIL_CUT = 20;

/** Power mean of `levels[from..to)` in dB. */
function meanDb(levels: readonly number[], from: number, to: number): number {
  const a = Math.max(0, from);
  const b = Math.min(levels.length, to);
  if (b <= a) return -120;
  let sum = 0;
  for (let i = a; i < b; i++) sum += 10 ** (levels[i] / 10);
  return 10 * Math.log10(sum / (b - a));
}

/**
 * Where a transition should land in a track and where it should leave it,
 * from 100 ms loudness frames.
 *
 * - `in` skips silence and any quiet intro or early break: it is the first
 *   point from which the next four seconds stay near the track's typical
 *   level, so a crossfade never rises into a near-silent passage.
 * - `out` is where the tail starts to fade, plus half a second, so the
 *   crossfade is over before the outgoing track has thinned out.
 *
 * Levels are relative to the track's own median, so a quiet piano piece and a
 * loud house track are judged alike. First plays always start at 0; the cues
 * apply only to transitions.
 */
export function analyseCues(channels: readonly Float32Array[], sampleRate: number, window: TrimWindow): Cues {
  const length = Math.max(0, window.end - window.start);
  const fallback = { in: 0, out: length };
  if (channels.length === 0 || length < 1) return fallback;
  const first = Math.floor(window.start * sampleRate);
  const last = Math.min(channels[0].length, Math.floor(window.end * sampleRate));
  const frame = Math.max(1, Math.round(FRAME * sampleRate));
  const levels: number[] = [];
  // Every second sample is plenty for a level estimate.
  for (let at = first; at + frame <= last; at += frame) {
    let sum = 0;
    let n = 0;
    for (const ch of channels) {
      for (let i = at; i < at + frame; i += 2) {
        sum += ch[i] * ch[i];
        n++;
      }
    }
    levels.push(10 * Math.log10(sum / Math.max(1, n) + 1e-12));
  }
  const sounding = levels.filter((db) => db > -70).sort((a, b) => a - b);
  if (sounding.length === 0) return fallback;
  const median = sounding[sounding.length >> 1];

  // In: the first frame whose next four seconds hold up (400 ms averages).
  const short = levels.map((_, i) => meanDb(levels, i, i + 4));
  let cueIn = -1;
  for (let i = 0; i * FRAME <= MAX_IN && i + IN_SPAN <= levels.length; i++) {
    // The frame itself must sound, so the cue lands on the music, not just before it.
    let ok = levels[i] >= median - 20;
    for (let j = i; j < i + IN_SPAN && ok; j++) ok = short[j] >= median - IN_BELOW;
    if (ok) {
      cueIn = i * FRAME;
      break;
    }
  }
  if (cueIn < 0) cueIn = Math.min(MAX_IN, Math.max(0, levels.findIndex((db) => db >= median - 20)) * FRAME);

  // Out: the last frame whose preceding second is still near the typical level.
  let lastLoud = -1;
  for (let i = levels.length - 1; i >= 0; i--) {
    if (meanDb(levels, i - 9, i + 1) >= median - OUT_BELOW) {
      lastLoud = i;
      break;
    }
  }
  const cueOut = Math.max(length - MAX_TAIL_CUT, Math.min(length, (lastLoud + 1) * FRAME + TAIL_ALLOWANCE));
  // Too little music between the cues to be worth trusting: play the whole window.
  if (cueOut - cueIn < Math.min(10, length / 2)) return fallback;
  return { in: cueIn, out: cueOut };
}

// ------------------------------------------------------------------ fades

/** A gain change on the audio clock: `from` before `t0`, `to` after `t1`, an equal-power curve between. */
export interface Envelope {
  t0: number;
  t1: number;
  from: number;
  to: number;
}

export const steady = (value: number, at = 0): Envelope => ({ t0: at, t1: at, from: value, to: value });

/**
 * The gain an envelope gives at time `t`.
 *
 * Rising uses sin, falling uses 1 − cos over the same span, so a fade-in and a
 * fade-out of the same window keep `in² + out²` at 1: no dip in the middle.
 */
export function envelopeAt(env: Envelope, t: number): number {
  if (env.t1 <= env.t0) return t < env.t0 ? env.from : env.to;
  if (t <= env.t0) return env.from;
  if (t >= env.t1) return env.to;
  const p = (t - env.t0) / (env.t1 - env.t0);
  const shape = env.to >= env.from ? Math.sin((p * Math.PI) / 2) : 1 - Math.cos((p * Math.PI) / 2);
  return env.from + (env.to - env.from) * shape;
}

/** Samples an envelope from `from` to its end, for `AudioParam.setValueCurveAtTime`. */
export function fadeCurve(env: Envelope, from: number, pointsPerSecond = 120): Float32Array {
  const start = Math.max(from, env.t0);
  const span = Math.max(0, env.t1 - start);
  const n = Math.max(2, Math.min(2048, Math.ceil(span * pointsPerSecond) + 1));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = envelopeAt(env, start + (span * i) / (n - 1));
  return out;
}

export interface FadePlan {
  /** Audio-clock seconds when the incoming starts and the outgoing begins to fall. */
  start: number;
  /** When the outgoing reaches silence and the incoming full level. */
  end: number;
}

/** Shortest fade a late transition is squeezed into. */
const MIN_FADE = 0.3;

/**
 * When a transition runs.
 *
 * `outAt` is when the outgoing track reaches its out cue, `endAt` when its
 * audio runs out. Normally the fade ends on the cue. If that moment is too
 * close (a seek near the end, a stalled timer), the fade starts as soon as
 * possible and is shortened, never pushed past the end of the audio.
 */
export function planCrossfade(now: number, outAt: number, endAt: number, fade: number, minLead = 0.05): FadePlan {
  let end = Math.min(outAt, endAt);
  let start = end - fade;
  const earliest = now + minLead;
  if (start < earliest) {
    start = earliest;
    end = Math.min(endAt, Math.max(end, start + MIN_FADE));
    if (end < start) end = start;
  }
  return { start, end };
}

export interface LoopPass {
  /** Audio-clock time this pass starts. */
  start: number;
  /** Track position at `start`. */
  offset: number;
  /** The crossfade into the next pass. */
  fade: FadePlan;
}

/**
 * The schedule of a single track looping into itself: each pass starts at the
 * `in` cue as the previous one fades out over its `out` cue.
 */
export function loopSchedule(cues: Cues, length: number, fade: number, start: number, offset: number, passes: number): LoopPass[] {
  const out: LoopPass[] = [];
  let t = start;
  let at = offset;
  for (let i = 0; i < passes; i++) {
    const outAt = t + (cues.out - at);
    const endAt = t + (length - at);
    const plan = planCrossfade(t, outAt, endAt, fade, 0);
    out.push({ start: t, offset: at, fade: plan });
    t = plan.start;
    at = cues.in;
  }
  return out;
}

/** Seconds to wait before retrying a failed download: 1, 2, 4, 8, then every 15. */
export const retryDelay = (attempt: number): number => Math.min(15, 2 ** Math.max(0, attempt));

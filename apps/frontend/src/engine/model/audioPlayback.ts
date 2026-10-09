/**
 * The arithmetic behind a voice-note player.
 *
 * Pure, and separate from the player component, because every one of these is
 * an off-by-one waiting to happen at a boundary nobody clicks by hand: the
 * first pixel of the waveform, the last, a clip whose duration was never
 * recorded, a keyboard seek past the end.
 */

/**
 * `m:ss`. Anything not a real, positive number reads as `0:00` rather than
 * `NaN:aN` — which is what an audio element reports before its metadata
 * arrives, and what an uploaded clip with no stored duration reports forever.
 */
export function formatClock(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00';
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = (total % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

/**
 * How long the clip really is, in milliseconds.
 *
 * The stored `durationMs` is written by the recorder — but **uploaded** audio
 * is created with `durationMs: 0` and nothing ever fills it in, so those clips
 * showed `0:00 / 0:00` while plainly playing, and their progress bar could
 * never move because every position divided by zero. The element knows the
 * truth once it has metadata; prefer it, and fall back to the stored value
 * while it is still loading.
 */
export function resolveDurationMs(storedMs: number, elementSeconds: number | undefined): number {
  if (Number.isFinite(elementSeconds) && (elementSeconds as number) > 0) {
    return (elementSeconds as number) * 1000;
  }
  return Number.isFinite(storedMs) && storedMs > 0 ? storedMs : 0;
}

/** Clamp to the unit interval; `NaN` becomes 0. */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Where along the clip a pointer at `clientX` is, as a fraction.
 *
 * Clamped, because a drag that started on the waveform continues to deliver
 * coordinates far outside it — releasing to the left of the bar should mean
 * "the start", not a negative time the element silently rejects.
 */
export function fractionFromPointer(clientX: number, left: number, width: number): number {
  if (!(width > 0)) return 0;
  return clamp01((clientX - left) / width);
}

/**
 * The time a keyboard seek should land on, or `null` for keys we do not own.
 *
 * Arrows step five seconds, Home and End go to the ends — matching the native
 * `<audio>` element people already know, and making the scrubber usable
 * without a pointer at all. It was a row of `<div>`s before, reachable by
 * nobody.
 */
export function keyboardSeek(
  key: string,
  currentSeconds: number,
  durationSeconds: number,
  step = 5
): number | null {
  if (!(durationSeconds > 0)) return null;
  const clamp = (t: number) => Math.min(durationSeconds, Math.max(0, t));
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      return clamp(currentSeconds + step);
    case 'ArrowLeft':
    case 'ArrowDown':
      return clamp(currentSeconds - step);
    case 'Home':
      return 0;
    case 'End':
      // A hair short of the end: seeking exactly to `duration` fires `ended`
      // on some browsers and immediately resets, so "End" would look like
      // "start over".
      return Math.max(0, durationSeconds - 0.01);
    default:
      return null;
  }
}

/**
 * Normalise recorded peaks for display.
 *
 * A quiet recording is all small numbers, and drawn literally it is a flat
 * line that looks like a broken clip. Scaling to the loudest peak makes every
 * note legible while keeping its own shape. A clip with no peaks at all —
 * every upload, since nothing analyses those — gets a neutral bar rather than
 * nothing.
 */
/**
 * How many bars actually fit inside a player of this width.
 *
 * The recorder stores **50** peaks and creates a **240px** node. Rendered one
 * bar per peak at a 2px floor with 2px gaps, that needs 198px of waveform —
 * inside a card that has about 134px to give once the play button, the speed
 * control and the padding have taken theirs. Flex cannot shrink below a
 * minimum width, so the waveform simply ran out of the card. Every real
 * recording, every time.
 *
 * Deriving the count from the width instead means the waveform is always a
 * shape that fits, at any size the node is resized to.
 */
export function barCountFor(playerWidth: number): number {
  /** Play button, speed control, padding and gaps. */
  const CHROME = 116;
  /** Bar plus its gap. */
  const PER_BAR = 3.5;
  const available = playerWidth - CHROME;
  if (!(available > 0)) return MIN_BARS;
  return Math.max(MIN_BARS, Math.min(MAX_BARS, Math.floor(available / PER_BAR)));
}

const MIN_BARS = 10;
const MAX_BARS = 48;

/**
 * Resample peaks to exactly `count` bars, keeping the loudest of each bucket.
 *
 * The peak, not the average: averaging flattens a recording into a smooth
 * mound and loses the transients that make a waveform recognisable as speech.
 * This is what every audio editor does when it zooms out.
 */
export function resampleWaveform(peaks: number[], count: number): number[] {
  if (count <= 0) return [];
  if (peaks.length === 0) return [];
  if (peaks.length <= count) return peaks;

  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const start = Math.floor((i * peaks.length) / count);
    const end = Math.max(start + 1, Math.floor(((i + 1) * peaks.length) / count));
    let loudest = 0;
    for (let j = start; j < end && j < peaks.length; j++) {
      if (peaks[j] > loudest) loudest = peaks[j];
    }
    out.push(loudest);
  }
  return out;
}

export function normalizeWaveform(peaks: number[], bars = 40): number[] {
  const usable = peaks.filter((p) => Number.isFinite(p) && p >= 0);
  if (usable.length === 0) return new Array(bars).fill(0.35);

  const loudest = Math.max(...usable);
  if (!(loudest > 0)) return new Array(usable.length).fill(0.12);
  return usable.map((p) => clamp01(p / loudest));
}

const HONORIFICS = new Set(['dr.', 'dr', 'mr.', 'mr', 'mrs.', 'mrs', 'ms.', 'ms', 'prof.', 'prof', 'rev.', 'rev']);

/**
 * Extracts a concise, friendly first name or short name for voice note badges.
 *
 * For example:
 * - "Emmanuel Richard" -> "Emmanuel"
 * - "Dr. Jane Smith" -> "Dr. Jane"
 * - "Sarah Connor" -> "Sarah"
 * - "user.name@example.com" -> "user.name"
 * - "" / undefined -> "Anonymous"
 */
export function formatAuthorShortName(fullName: string | undefined): string {
  if (!fullName || !fullName.trim()) return 'Anonymous';
  const trimmed = fullName.trim();
  // If it's an email, take the user portion before '@'
  if (trimmed.includes('@')) {
    const user = trimmed.split('@')[0];
    if (user) return user;
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0];
  if (HONORIFICS.has(parts[0].toLowerCase()) && parts.length > 1) {
    return `${parts[0]} ${parts[1]}`;
  }
  return parts[0];
}

/** Minimum width for an audio card on the canvas. */
export const MIN_AUDIO_WIDTH = 250;
/** Maximum default width for an audio card when created dynamically. */
export const MAX_DEFAULT_AUDIO_WIDTH = 340;

/**
 * Calculates the optimal width for a voice note player based on author name length
 * and clip duration, so that the name, waveform, and controls display with balanced proportions.
 */
export function calculateOptimalAudioWidth(name: string | undefined, durationMs?: number): number {
  const shortName = formatAuthorShortName(name);
  // ~8px per character for semibold 12px sans text + 13px for indicator dot & gap
  const nameWidth = Math.max(32, shortName.length * 8 + 13);
  // Timestamp width: ~68px for m:ss, ~80px for mm:ss
  const timeWidth = durationMs && durationMs >= 600000 ? 80 : 68;
  const headerNeededWidth = nameWidth + 12 + timeWidth;

  // Fixed controls: padding(20) + play(34) + gap(8) + save(24) + gap(6) + speed(28) = 120px
  const fixedChromeWidth = 120;
  // Minimum comfortable width for the waveform scrubber
  const minWaveformWidth = 110;

  const targetBodyWidth = Math.max(minWaveformWidth, headerNeededWidth);
  const totalCalculated = fixedChromeWidth + targetBodyWidth;

  return Math.max(MIN_AUDIO_WIDTH, Math.min(MAX_DEFAULT_AUDIO_WIDTH, Math.round(totalCalculated)));
}


/** Seconds a pointer fraction lands on, clamped to the clip. Never NaN. */
export function seekSeconds(fraction: number, durationSeconds: number): number {
  if (!(durationSeconds > 0) || !Number.isFinite(fraction)) return 0;
  return clamp01(fraction) * durationSeconds;
}

/** The slice of an audio element the playback slot needs. */
export interface Pausable {
  pause(): void;
}

let activePlayer: Pausable | null = null;

/**
 * Take the board's single playback slot, silencing whoever held it.
 * Two voice notes never talk over each other.
 */
export function claimPlayback(player: Pausable): void {
  if (activePlayer && activePlayer !== player) activePlayer.pause();
  activePlayer = player;
}

/** Give the slot up (paused, ended, unmounted). A no-op for a non-holder. */
export function releasePlayback(player: Pausable): void {
  if (activePlayer === player) activePlayer = null;
}

export function currentPlayer(): Pausable | null {
  return activePlayer;
}

/**
 * The clock a voice note shows: its length while it rests, the position once
 * it has been started or scrubbed. One figure rather than "0:12 / 0:43", so
 * the waveform keeps the width; the full pair is the scrubber's value text.
 */
export function playbackReadout(currentSeconds: number, durationMs: number, engaged: boolean): string {
  return engaged ? formatClock(currentSeconds * 1000) : formatClock(durationMs);
}

/** Why an `<audio>` element gave up, in the terms the player acts on. */
export type AudioLoadFailure = 'network' | 'unsupported' | 'decode';

/**
 * `MediaError.code` → what to offer. A network failure is worth trying again
 * (a sleeping server, a dropped connection); a format this browser cannot
 * decode is not, and the honest answer is the file itself.
 */
export function classifyMediaError(code: number | null | undefined): AudioLoadFailure {
  if (code === 3) return 'decode';
  if (code === 4) return 'unsupported';
  return 'network';
}

/**
 * Whether a rejected `play()` means the recording is broken.
 *
 * It mostly does not. `AbortError` is a pause or a new source arriving before
 * playback began, which is a second click on a note still buffering from a
 * slow server; `NotAllowedError` is the browser's autoplay policy. Treating
 * either as a failure stuck "Couldn't load this recording" on notes that were
 * perfectly playable.
 */
export function isFatalPlayRejection(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name !== 'AbortError' && name !== 'NotAllowedError';
}

/**
 * Which address the `<audio>` element should hold right now.
 *
 * When an upload lands, the node's src moves from the local blob to the stored
 * URL. Switching the element mid-playback cuts the listener off and restarts
 * the load, so a note that is playing from its blob keeps that blob until it
 * stops; the stored URL takes over at the next rest.
 */
export function nextElementSrc(current: string, incoming: string, playing: boolean): string {
  if (current === incoming) return current;
  if (playing && current.startsWith('blob:') && incoming) return current;
  return incoming;
}

/** Card density from the node's size: `lg` once it has been made tall enough to earn it. */
export function audioCardSize(width: number, height: number): 'sm' | 'md' | 'lg' {
  if (height >= 84 && width >= 300) return 'lg';
  if (width < 236) return 'sm';
  return 'md';
}

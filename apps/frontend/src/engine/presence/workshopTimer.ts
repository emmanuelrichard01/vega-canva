/**
 * The workshop timer: one countdown for the whole board.
 *
 * It is stored in the document (so a reload or a late joiner sees it) as an
 * end timestamp, never as ticks. Nobody writes while it runs; every client
 * subtracts its own clock from the same `endsAt`, so the displays agree to
 * within a frame without any traffic.
 *
 * Clocks disagree, though, so each state also carries `at`, the writer's clock
 * when it was written. A client that receives a change live compares that with
 * its own clock to get an offset, and judges `endsAt` on the writer's timeline.
 * A client that loads the state cold has no offset and trusts its own clock.
 */

export type TimerStatus = 'idle' | 'running' | 'paused';

export interface TimerState {
  status: TimerStatus;
  /** Writer-clock instant the countdown reaches zero. Meaningful while running. */
  endsAt: number;
  /** Time left while paused. */
  remainingMs: number;
  /** Writer clock when this state was written. */
  at: number;
}

export const TIMER_KEY = 'workshop.timer';
export const MINUTE_MS = 60_000;
/** Longest the timer will run: a day is a typo, not a workshop. */
export const MAX_TIMER_MS = 6 * 60 * MINUTE_MS;
/** A live offset larger than this is a stale message, not clock skew. */
const MAX_OFFSET_MS = 10 * MINUTE_MS;

const clampMs = (ms: number) => Math.max(0, Math.min(MAX_TIMER_MS, Math.round(ms)));

export const idleTimer = (now: number): TimerState => ({ status: 'idle', endsAt: 0, remainingMs: 0, at: now });

export function startTimer(durationMs: number, now: number): TimerState {
  const ms = clampMs(durationMs);
  return ms === 0 ? idleTimer(now) : { status: 'running', endsAt: now + ms, remainingMs: ms, at: now };
}

/**
 * Time left, on the writer's timeline. `offset` is `localNow - writerNow` as
 * measured when the state arrived live; zero when unknown.
 */
export function remainingMs(state: TimerState, now: number, offset = 0): number {
  if (state.status === 'running') return Math.max(0, state.endsAt - (now - offset));
  if (state.status === 'paused') return state.remainingMs;
  return 0;
}

export function pauseTimer(state: TimerState, now: number, offset = 0): TimerState {
  if (state.status !== 'running') return state;
  return { status: 'paused', endsAt: 0, remainingMs: remainingMs(state, now, offset), at: now };
}

export function resumeTimer(state: TimerState, now: number): TimerState {
  if (state.status !== 'paused' || state.remainingMs <= 0) return state;
  return { status: 'running', endsAt: now + state.remainingMs, remainingMs: state.remainingMs, at: now };
}

/** Add (or take away) time, running or paused. On an idle timer it starts one. */
export function addTime(state: TimerState, deltaMs: number, now: number, offset = 0): TimerState {
  if (state.status === 'idle') return startTimer(deltaMs, now);
  const left = clampMs(remainingMs(state, now, offset) + deltaMs);
  if (left === 0) return idleTimer(now);
  return state.status === 'running'
    ? { status: 'running', endsAt: now + left, remainingMs: left, at: now }
    : { status: 'paused', endsAt: 0, remainingMs: left, at: now };
}

export function readTimer(raw: unknown): TimerState | null {
  if (typeof raw !== 'string') return null;
  try {
    const v = JSON.parse(raw) as Partial<TimerState>;
    if (v.status !== 'idle' && v.status !== 'running' && v.status !== 'paused') return null;
    if (![v.endsAt, v.remainingMs, v.at].every((n) => Number.isFinite(n))) return null;
    return { status: v.status, endsAt: v.endsAt as number, remainingMs: v.remainingMs as number, at: v.at as number };
  } catch {
    return null;
  }
}

export const writeTimer = (state: TimerState): string => JSON.stringify(state);

/** The offset to use for a state that has just arrived, or 0 if it looks stale. */
export function liveOffset(state: TimerState, now: number): number {
  const offset = now - state.at;
  return Math.abs(offset) > MAX_OFFSET_MS ? 0 : offset;
}

/** "4:07", "12:00", "1:02:03". Rounds up so the last second shows 0:01, not 0:00. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

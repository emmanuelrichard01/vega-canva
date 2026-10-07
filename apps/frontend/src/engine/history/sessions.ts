import type { Moment } from './sessionTimeline';

/**
 * Working sessions: runs of moments with no pause longer than the gap.
 *
 * The unit a person remembers ("this morning, when Ana and I reworked the
 * flow"), and the unit the timeline is drawn, labelled and stepped in.
 * Matches the server's `SESSION_GAP_MS`, so a session in the log and the
 * autosave retention later folds it into describe the same span.
 */
export const SESSION_GAP_MS = 20 * 60 * 1000;

export interface SessionAuthor {
  id: string;
  name: string;
  color: string;
}

export interface ReplaySession {
  /** Index into the moments array of the first and last moment. */
  first: number;
  last: number;
  startAt: number;
  endAt: number;
  authors: SessionAuthor[];
  /** Raw transactions folded into the session's moments. */
  updateCount: number;
}

export function groupSessions(moments: readonly Moment[], gapMs = SESSION_GAP_MS): ReplaySession[] {
  const sessions: ReplaySession[] = [];
  let current: ReplaySession | null = null;
  let seen = new Set<string>();
  moments.forEach((moment, i) => {
    if (!current || moment.firstAt - current.endAt > gapMs) {
      current = { first: i, last: i, startAt: moment.firstAt, endAt: moment.at, authors: [], updateCount: 0 };
      seen = new Set();
      sessions.push(current);
    }
    current.last = i;
    current.endAt = Math.max(current.endAt, moment.at);
    current.updateCount += moment.updateCount;
    const key = moment.authorId ?? `name:${moment.authorName}`;
    if (!seen.has(key)) {
      seen.add(key);
      current.authors.push({ id: key, name: moment.authorName, color: moment.authorColor });
    }
  });
  return sessions;
}

/** The session holding moment `index`, by binary search. -1 when none. */
export function sessionOf(sessions: readonly ReplaySession[], index: number): number {
  let lo = 0;
  let hi = sessions.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = sessions[mid];
    if (index < s.first) hi = mid - 1;
    else if (index > s.last) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/**
 * Where Shift+arrow lands: the end of the previous session, or the end of the
 * next. From partway through a session, back goes to that session's start
 * first, as a video player's previous-chapter does.
 */
export function stepSession(
  sessions: readonly ReplaySession[],
  index: number,
  direction: -1 | 1
): number {
  if (sessions.length === 0) return index;
  const at = sessionOf(sessions, index);
  if (at === -1) return index;
  if (direction === 1) {
    const s = sessions[at];
    if (index < s.last) return s.last;
    return at + 1 < sessions.length ? sessions[at + 1].last : index;
  }
  const s = sessions[at];
  if (index > s.first) return s.first;
  return at > 0 ? sessions[at - 1].last : index;
}

const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** "Today", "Yesterday", "Mon, Oct 5", or with the year when it differs. */
export function dayLabel(at: number, now = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return new Date(at).toLocaleDateString([], {
    weekday: days < 7 ? 'short' : undefined,
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  });
}

export const clockLabel = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** "10:42–11:30", or one time when the span fits in a minute. */
export function clockRange(startAt: number, endAt: number): string {
  const from = clockLabel(startAt);
  const to = clockLabel(endAt);
  return from === to ? from : `${from}–${to}`;
}

/** "Today, 10:42–11:30", or one time when the session fits in a minute. */
export function sessionLabel(startAt: number, endAt: number, now = Date.now()): string {
  const day = dayLabel(startAt, now);
  const from = clockLabel(startAt);
  const to = clockLabel(endAt);
  if (from === to) return `${day}, ${from}`;
  if (startOfDay(startAt) !== startOfDay(endAt)) return `${day}, ${from} – ${dayLabel(endAt, now)}, ${to}`;
  return `${day}, ${from}–${to}`;
}

/** "Ana", "Ana and Ben", "Ana, Ben and 2 others". */
export function namesLabel(authors: readonly { name: string }[]): string {
  const names = authors.map((a) => a.name);
  if (names.length === 0) return 'No one';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  const rest = names.length - 2;
  return `${names[0]}, ${names[1]} and ${rest} other${rest === 1 ? '' : 's'}`;
}

/** Moments that touched `id`, as indices into `moments`. */
export function momentsTouching(moments: readonly Moment[], id: string): number[] {
  const out: number[] = [];
  moments.forEach((m, i) => {
    if (m.ids.includes(id)) out.push(i);
  });
  return out;
}

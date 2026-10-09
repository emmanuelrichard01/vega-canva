/**
 * Emotes: a quick feeling, thrown at a spot on the board.
 *
 * Hold the key, a wheel opens at the pointer, move toward a slice, release.
 * The emote goes out through awareness like a ping (a world point and a stamp)
 * and plays for `EMOTE_MS` on every screen, then is gone.
 */

import type { Point } from './collaborators';

export const EMOTE_MS = 2200;
export const EMOTE_COOLDOWN_MS = 250;
/** Inside this radius (px) releasing cancels. */
export const WHEEL_DEAD_ZONE = 26;

export interface Emote {
  id: string;
  glyph: string;
  label: string;
}

/** Clockwise from the top. */
export const EMOTES: readonly Emote[] = [
  { id: 'thumbs-up', glyph: '👍', label: 'Thumbs up' },
  { id: 'heart', glyph: '❤️', label: 'Love' },
  { id: 'laugh', glyph: '😂', label: 'Laugh' },
  { id: 'party', glyph: '🎉', label: 'Celebrate' },
  { id: 'clap', glyph: '👏', label: 'Applause' },
  { id: 'think', glyph: '🤔', label: 'Thinking' },
  { id: 'eyes', glyph: '👀', label: 'Looking' },
  { id: 'question', glyph: '❓', label: 'Question' },
];

export const emoteById = (id: unknown): Emote | undefined => EMOTES.find((e) => e.id === id);

/** The slice a pointer offset from the wheel centre points at, or -1 inside the dead zone. */
export function emoteIndexAt(dx: number, dy: number, count = EMOTES.length): number {
  if (Math.hypot(dx, dy) < WHEEL_DEAD_ZONE) return -1;
  const full = Math.PI * 2;
  const turn = (Math.atan2(dx, -dy) + full) % full; // 0 at the top, clockwise
  const slice = full / count;
  return Math.floor(((turn + slice / 2) % full) / slice);
}

export interface EmoteState {
  id: string;
  x: number;
  y: number;
  at: number;
}

export function readEmote(raw: unknown): EmoteState | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as { id?: unknown; x?: unknown; y?: unknown; at?: unknown };
  if (!emoteById(v.id) || !Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.at)) return null;
  return { id: v.id as string, x: v.x as number, y: v.y as number, at: v.at as number };
}

export interface LiveEmote {
  from: number;
  at: number;
  id: string;
  point: Point;
  startedAt: number;
}

/** Same contract as `stepPings`: start unseen ones, keep the playing, drop the rest. */
export function stepEmotes(
  playing: readonly LiveEmote[],
  seen: Map<number, number>,
  people: ReadonlyArray<{ clientId: number; emote?: EmoteState | null }>,
  now: number
): LiveEmote[] {
  const next = playing.filter((e) => now - e.startedAt < EMOTE_MS);
  const present = new Set<number>();
  for (const person of people) {
    present.add(person.clientId);
    const e = person.emote;
    if (!e || seen.get(person.clientId) === e.at) continue;
    seen.set(person.clientId, e.at);
    next.push({ from: person.clientId, at: e.at, id: e.id, point: { x: e.x, y: e.y }, startedAt: now });
  }
  for (const id of seen.keys()) if (!present.has(id)) seen.delete(id);
  return next;
}

type Listener = (id: string, point: Point) => void;
const listeners = new Set<Listener>();
export const onLocalEmote = (fn: Listener) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export const announceLocalEmote = (id: string, point: Point) => listeners.forEach((fn) => fn(id, point));

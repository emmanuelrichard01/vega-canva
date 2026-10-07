/**
 * "Look here": a short pulse at one place on the board.
 *
 * A ping answers "which one?" without a sentence. It carries a world point and
 * nothing else, goes out through awareness like every other ephemeral field,
 * and is gone after `PING_MS` on both ends.
 *
 * Receivers never compare the sender's timestamp with their own clock. Two
 * laptops disagree about the time by seconds as a matter of course, and a ping
 * judged "too old" on arrival would never be seen. The timestamp is only an
 * identity: a ping is new when its `at` differs from the one last seen from
 * that person, and it then plays for `PING_MS` on the receiver's own clock.
 */

import type { Point } from './collaborators';

/** How long a ping plays, and how long the sender keeps it in awareness. */
export const PING_MS = 2400;

/** The nearest a ping can follow another from the same person, so a held key is not a flood. */
export const PING_COOLDOWN_MS = 350;

export interface PingState {
  x: number;
  y: number;
  at: number;
}

/** A peer's ping, or `null`. Awareness is whatever another client chose to send. */
export function readPing(raw: unknown): PingState | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as { x?: unknown; y?: unknown; at?: unknown };
  if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.at)) return null;
  return { x: v.x as number, y: v.y as number, at: v.at as number };
}

/** A ping being played on this screen. */
export interface LivePing {
  /** Who sent it, by `clientId`. */
  from: number;
  /** The sender's stamp, which identifies this ping and no other. */
  at: number;
  point: Point;
  /** When this screen started playing it, on this screen's clock. */
  startedAt: number;
}

/**
 * The pings to play now, given what has been playing.
 *
 * Starts the ones not seen before, keeps the ones still within `PING_MS`, and
 * drops the rest. `seen` is the last stamp per sender, so a ping that is still
 * in awareness after its animation has ended is not started a second time.
 */
export function stepPings(
  playing: readonly LivePing[],
  seen: Map<number, number>,
  people: ReadonlyArray<{ clientId: number; ping?: PingState | null }>,
  now: number
): LivePing[] {
  const next = playing.filter((p) => now - p.startedAt < PING_MS);
  const present = new Set<number>();
  for (const person of people) {
    present.add(person.clientId);
    const ping = person.ping;
    if (!ping) continue;
    if (seen.get(person.clientId) === ping.at) continue;
    seen.set(person.clientId, ping.at);
    next.push({ from: person.clientId, at: ping.at, point: { x: ping.x, y: ping.y }, startedAt: now });
  }
  for (const id of seen.keys()) if (!present.has(id)) seen.delete(id);
  return next;
}

/**
 * Where to draw a ping, and whether it is on screen.
 *
 * Off screen, the ping is pinned to the nearest edge so that "look here" still
 * says which way to look; `inside` tells the caller to draw an arrow rather
 * than the ring.
 */
export function placePing(
  screen: Point,
  width: number,
  height: number,
  inset = 28
): { x: number; y: number; inside: boolean; angle: number } {
  const inside = screen.x >= 0 && screen.x <= width && screen.y >= 0 && screen.y <= height;
  const x = Math.min(width - inset, Math.max(inset, screen.x));
  const y = Math.min(height - inset, Math.max(inset, screen.y));
  const angle = (Math.atan2(screen.y - height / 2, screen.x - width / 2) * 180) / Math.PI;
  return { x, y, inside, angle };
}

/** The most a click may travel and still be a click rather than the start of a drag. */
export const PING_CLICK_SLOP_PX = 4;

/** Whether a press and release together are a "look here" gesture: Shift and Alt held, and no drag. */
export function isPingGesture(
  down: { x: number; y: number; shift: boolean; alt: boolean },
  up: { x: number; y: number; shift: boolean; alt: boolean }
): boolean {
  if (!down.shift || !down.alt || !up.shift || !up.alt) return false;
  return Math.hypot(up.x - down.x, up.y - down.y) <= PING_CLICK_SLOP_PX;
}

type LocalPingListener = (point: Point) => void;
const localListeners = new Set<LocalPingListener>();

/** Hear about pings this tab sends, so the sender sees what everyone else sees. */
export function onLocalPing(listener: LocalPingListener): () => void {
  localListeners.add(listener);
  return () => localListeners.delete(listener);
}

export function announceLocalPing(point: Point): void {
  localListeners.forEach((fn) => fn(point));
}

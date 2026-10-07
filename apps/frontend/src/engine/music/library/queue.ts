/**
 * Play order for library tracks: shuffle and repeat, per category. Pure.
 */

export type RepeatMode = 'off' | 'all' | 'one';

export interface Queue {
  /** Track ids in play order. */
  order: string[];
  /** Index of the current track in `order`. */
  index: number;
  shuffle: boolean;
  repeat: RepeatMode;
}

/** mulberry32: a small seeded generator, so a shuffle can be replayed in tests. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates with a seeded generator. */
export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  const next = seeded(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * A queue over `ids`, starting at `startId` (or the first track).
 * Shuffled queues put the starting track first, so it plays now and the rest follow at random.
 */
export function createQueue(
  ids: readonly string[],
  opts: { shuffle?: boolean; repeat?: RepeatMode; seed?: number; startId?: string | null } = {}
): Queue {
  const shuffle = opts.shuffle ?? false;
  const repeat = opts.repeat ?? 'all';
  const start = opts.startId && ids.includes(opts.startId) ? opts.startId : null;
  if (!shuffle) {
    return { order: [...ids], index: start ? ids.indexOf(start) : 0, shuffle, repeat };
  }
  const rest = shuffled(
    ids.filter((id) => id !== start),
    opts.seed ?? 1
  );
  return { order: start ? [start, ...rest] : rest, index: 0, shuffle, repeat };
}

export const currentId = (q: Queue): string | null => q.order[q.index] ?? null;

/**
 * The track after this one.
 *
 * `auto` is a track ending on its own: repeat-one replays it. A person
 * pressing Next always moves on, which is what every music player does.
 * Returns null at the end of a queue that does not repeat.
 */
export function nextIndex(q: Queue, auto: boolean): number | null {
  if (q.order.length === 0) return null;
  if (auto && q.repeat === 'one') return q.index;
  const n = q.index + 1;
  if (n < q.order.length) return n;
  return q.repeat === 'off' && auto ? null : 0;
}

export function advance(q: Queue, auto: boolean): Queue | null {
  const i = nextIndex(q, auto);
  return i === null ? null : { ...q, index: i };
}

/** What will play next on its own, for preloading. */
export function peekNext(q: Queue): string | null {
  const i = nextIndex(q, true);
  return i === null ? null : q.order[i];
}

/** Previous: restart the current track if it has played a few seconds, otherwise step back. */
export const RESTART_THRESHOLD = 3;
export function previous(q: Queue, elapsed: number): { queue: Queue; restart: boolean } {
  if (elapsed > RESTART_THRESHOLD || q.order.length <= 1) return { queue: q, restart: true };
  const i = q.index > 0 ? q.index - 1 : q.repeat === 'off' ? 0 : q.order.length - 1;
  return { queue: { ...q, index: i }, restart: i === q.index };
}

/** Turns shuffle on or off without interrupting the current track. */
export function setShuffle(q: Queue, on: boolean, ids: readonly string[], seed: number): Queue {
  return createQueue(ids, { shuffle: on, repeat: q.repeat, seed, startId: currentId(q) });
}

export function cycleRepeat(mode: RepeatMode): RepeatMode {
  return mode === 'all' ? 'one' : mode === 'one' ? 'off' : 'all';
}

/** Jumps to a specific track; an id not in the queue leaves it unchanged. */
export function jumpTo(q: Queue, id: string): Queue {
  const i = q.order.indexOf(id);
  return i < 0 ? q : { ...q, index: i };
}

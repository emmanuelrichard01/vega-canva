/**
 * The one clock TODAY and NOW are kept current by.
 *
 * A formula's value is memoised until its table's text changes, and a memo
 * holding TODAY or NOW goes stale when the minute turns (`memoFor` checks).
 * Stale is not redrawn, though: nothing re-lays-out a table nobody touched.
 * So every table that uses them subscribes here, and one timer — aligned to
 * the minute, running only while at least one such table is mounted — ticks
 * them all at once. A board of forty tables with TODAY in them is one timer,
 * not forty, and a board with none has no timer at all.
 */

let epoch = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

/** Changes once a minute while anything is subscribed. */
export const volatileEpoch = () => epoch;

function schedule(): void {
  // To the next whole minute, plus a beat so the clock has visibly turned.
  const wait = 60_000 - (Date.now() % 60_000) + 50;
  timer = setTimeout(() => {
    epoch++;
    listeners.forEach((fn) => fn());
    if (listeners.size) schedule();
    else timer = null;
  }, wait);
}

export function subscribeVolatile(fn: () => void): () => void {
  listeners.add(fn);
  if (!timer) schedule();
  return () => {
    listeners.delete(fn);
    if (!listeners.size && timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

/** For tables without TODAY or NOW: nothing to subscribe to. */
export const subscribeNothing = () => () => undefined;

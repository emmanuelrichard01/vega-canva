import { useEffect, useState } from 'react';

/**
 * True once `active` has been continuously true for `delay` milliseconds.
 *
 * ## Why every loading state in the app goes through this
 *
 * A loader that appears for eighty milliseconds and vanishes does not tell
 * anybody anything. It reads as a flicker, and a flicker reads as jank -- so
 * the spinner meant to reassure somebody that the app is working is the thing
 * that makes it feel broken. On a warm connection almost every wait in this
 * app is under a tenth of a second, and the correct amount of loading UI for
 * those is none at all.
 *
 * The thresholds callers pass are not arbitrary. Under about 100ms a wait is
 * not perceived as a wait, and interrupting it with a mark is strictly worse
 * than leaving the previous frame up. Past about a third of a second the
 * silence starts to read as a dead click, and something has to say the app
 * heard you.
 *
 * Going inactive resets the timer, so a fast round trip never flips this on,
 * and a slow one that follows it still gets its full threshold rather than
 * inheriting a spent one.
 */
export function useDelayed(active: boolean, delay = 320): boolean {
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    if (!active) {
      setElapsed(false);
      return;
    }
    const t = window.setTimeout(() => setElapsed(true), delay);
    return () => window.clearTimeout(t);
  }, [active, delay]);

  return active && elapsed;
}

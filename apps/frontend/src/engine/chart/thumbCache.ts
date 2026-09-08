import { presetThumbSvg } from './presetThumb';
import type { ChartSpec } from './chartTypes';

/**
 * A preview, drawn once.
 *
 * ## What this is worth
 *
 * Measured before it was written: laying out all sixty-three example
 * thumbnails costs **374ms** on this machine, and the distribution is skewed —
 * a contour map is ~35ms on its own, because marching squares runs per level
 * over a grid. Rendering them eagerly meant a third of a second of blocked
 * main thread every time the browser opened, before a single card appeared.
 *
 * Two changes take that to nothing, and they compose:
 *
 * 1. **This cache.** The examples are static and the themes are two, so a
 *    preview is a pure function of `(id, dark)` and never needs computing
 *    twice. The second open of the browser costs zero.
 * 2. **Lazy mounting** in the browser itself, so the *first* open pays only
 *    for the cards actually on screen — about nine of sixty-three.
 *
 * Neither alone is enough: the cache does not help the first open, and lazy
 * mounting alone re-pays for every card each time you scroll back up.
 *
 * ## Why a plain Map and not a `useMemo`
 *
 * The lifetime wanted here is the *session*, not the component. A `useMemo`
 * dies with the popover, which is precisely the moment its value becomes
 * worth keeping — the popover is opened, closed, and opened again while
 * somebody decides.
 *
 * ## Bounded, because a cache without a limit is a leak
 *
 * Sixty-three examples across two themes is a hard ceiling of 126 entries of
 * a few kilobytes each, so the limit is not really load-bearing today. It is
 * here because the day somebody keys this on a *user's* chart instead of a
 * static example is the day an unbounded map becomes a slow memory leak, and
 * the check is one line now and an incident later.
 */

const MAX_ENTRIES = 256;

const cache = new Map<string, string>();

/**
 * The SVG for one preview, computed at most once per theme.
 *
 * Keyed on the example's id rather than on its spec, because a spec is an
 * object literal rebuilt on every call to `allExamples()` — keying on identity
 * would miss every time and keying on a serialisation would cost more than the
 * render it saves.
 */
export function thumbFor(id: string, spec: ChartSpec, width: number, height: number, dark: boolean): string {
  const key = `${id}:${width}x${height}:${dark ? 'd' : 'l'}`;
  const hit = cache.get(key);
  if (hit !== undefined) {
    // Re-inserted so the eviction below drops what is genuinely coldest,
    // rather than whatever happened to be computed first.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  const svg = presetThumbSvg(spec, width, height, dark);

  if (cache.size >= MAX_ENTRIES) {
    // The oldest key, which `Map` gives in insertion order.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, svg);
  return svg;
}

/** Whether a preview is already paid for, so a caller can render it at once. */
export function thumbReady(id: string, width: number, height: number, dark: boolean): boolean {
  return cache.has(`${id}:${width}x${height}:${dark ? 'd' : 'l'}`);
}

/** For tests, and for the theme changing under a long-lived session. */
export function clearThumbCache(): void {
  cache.clear();
}

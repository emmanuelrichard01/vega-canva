/**
 * The rules for when a tooltip may appear, apart from how it is drawn.
 *
 * One tooltip exists at a time, so there is one manager. It answers a single
 * question, "may this anchor show a tip now, and after how long?", from three
 * facts: whether a tip is already up, how recently one went down, and whether
 * an overlay has asked for quiet.
 *
 * - **Delay.** From cold a tip waits `OPEN_DELAY` (400ms) so passing over a
 *   control says nothing.
 * - **Warm window.** While a tip is up, or within `WARM_WINDOW` (300ms) of one
 *   hiding, the next anchor shows at once, so scanning a toolbar reads as one
 *   gesture (the macOS and Figma behaviour).
 * - **Keyboard and long-press** are deliberate, so they never wait.
 * - **Suppression.** Opening a popover, menu or flyout hides every tip, and an
 *   anchor whose surface is open is never tipped. A caller suppresses one anchor
 *   by id or everything with `true`, and gets the release back; suppressions
 *   are counted, so two overlays open at once do not release each other.
 */

export const OPEN_DELAY = 400;
export const WARM_WINDOW = 300;

export type ShowVia = 'pointer' | 'focus' | 'longpress';

export type Decision = { action: 'show' } | { action: 'wait'; ms: number } | { action: 'blocked' };

export interface TooltipManager {
  decide(anchorId: string, via: ShowVia): Decision;
  /** A tip is now on screen for this anchor. */
  shown(anchorId: string): void;
  /** The tip came down (any reason); starts the warm window. */
  hidden(): void;
  /** Ask for quiet for one anchor, or for everything with `true`. Returns the release. */
  suppress(target: string | true): () => void;
  release(target: string | true): void;
  isSuppressed(anchorId?: string): boolean;
  /** Called whenever a suppression is added; a tip that is up should check it still may be. */
  onSuppress(fn: () => void): () => void;
  readonly open: boolean;
  /** Drop every suppression and the warm window. For tests and room changes. */
  reset(): void;
}

export function createTooltipManager(now: () => number = Date.now): TooltipManager {
  let open = false;
  let lastHidden = -Infinity;
  let all = 0;
  const per = new Map<string, number>();
  const listeners = new Set<() => void>();

  const bump = (map: Map<string, number>, key: string, by: number) => {
    const next = (map.get(key) ?? 0) + by;
    if (next <= 0) map.delete(key);
    else map.set(key, next);
  };

  const manager: TooltipManager = {
    decide(anchorId, via) {
      if (manager.isSuppressed(anchorId)) return { action: 'blocked' };
      if (via !== 'pointer') return { action: 'show' };
      const warm = open || now() - lastHidden < WARM_WINDOW;
      return warm ? { action: 'show' } : { action: 'wait', ms: OPEN_DELAY };
    },
    shown() {
      open = true;
    },
    hidden() {
      if (open) lastHidden = now();
      open = false;
    },
    suppress(target) {
      if (target === true) all += 1;
      else bump(per, target, 1);
      listeners.forEach((fn) => fn());
      let done = false;
      return () => {
        if (done) return;
        done = true;
        manager.release(target);
      };
    },
    release(target) {
      if (target === true) all = Math.max(0, all - 1);
      else bump(per, target, -1);
    },
    isSuppressed(anchorId) {
      return all > 0 || (anchorId !== undefined && per.has(anchorId));
    },
    onSuppress(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get open() {
      return open;
    },
    reset() {
      open = false;
      lastHidden = -Infinity;
      all = 0;
      per.clear();
    },
  };
  return manager;
}

/** The app's manager. */
export const tooltips = createTooltipManager();

/** Silence one anchor's tooltip, or all of them, until the returned function is called. */
export const suppressTooltips = (target: string | true): (() => void) => tooltips.suppress(target);
export const releaseTooltips = (target: string | true): void => tooltips.release(target);

import { useEffect, useRef, type RefObject } from 'react';
import { PORTAL_SURFACE_ATTR } from './portalSurface';

/**
 * "Close when the user presses somewhere else" — once, for every floating
 * surface in the app.
 *
 * ## The bug this exists to end
 *
 * Every hand-rolled dismisser listened for a press outside its panel and
 * closed. The trigger button is outside the panel, so pressing it closed the
 * panel on `pointerdown` — and then the trigger's own `onClick`, which toggles,
 * found the panel closed and opened it again. A second click on a ⋯ never
 * closed anything; the menu blinked and came back.
 *
 * The rules, here and nowhere else:
 *
 * - A press inside one of the `surfaces` is not outside.
 * - A press inside a floating child is not outside: anything marked
 *   `[data-floating-child]` or `[data-portal-surface]` that appeared *after*
 *   this surface opened (a colour picker opened from a rail popover, a Select's
 *   menu inside a panel popover). One that was already on screen is a parent or
 *   a sibling, and pressing it does close this one.
 * - A press on a trigger *element* is left to the trigger by default
 *   (`trigger: 'toggle'`): its click closes what it opened. A trigger that only
 *   opens (`trigger: 'close'`), or one known only by its rect (a `DOMRect`, as a
 *   `Menu` anchored to a button knows it), closes here instead, and the click
 *   that completes the same gesture is swallowed so the trigger cannot reopen it.
 *
 * It never asks `document.activeElement`: Safari does not focus a button on
 * click, so "was the trigger focused" is not an answer there.
 */

export const FLOATING_CHILD_ATTR = 'data-floating-child';
const FLOATING_SELECTOR = `[${FLOATING_CHILD_ATTR}], [${PORTAL_SURFACE_ATTR}]`;

/** How long a swallowed click may take to arrive after its `pointerdown`. */
export const SWALLOW_MS = 600;

type Maybe<T> = T | null | undefined;
export type SurfaceRef = Maybe<RefObject<Element | null>> | Maybe<Element>;
export type TriggerRef = SurfaceRef | DOMRect;

export interface OutsidePressOptions {
  /** The surface(s) this dismisser owns. */
  surfaces: SurfaceRef[] | (() => Maybe<Element>[]);
  /** What opened it: elements, refs, or the trigger's rect. */
  triggers?: TriggerRef | TriggerRef[] | (() => TriggerRef | TriggerRef[]);
  /**
   * What a primary press on a trigger element does. `'toggle'` (default): nothing
   * here, the trigger's click closes it. `'close'`: close now, swallow the click.
   * A `DOMRect` trigger always behaves as `'close'`.
   */
  trigger?: 'toggle' | 'close';
  /** Extra "this is still mine" test, for surfaces that are not elements. */
  ignore?: (target: Element, e: PointerEvent) => boolean;
  onOutside: (e: PointerEvent) => void;
}

const isRect = (t: unknown): t is DOMRect =>
  !!t && typeof t === 'object' && !(t instanceof Node) && !('current' in (t as object)) && 'left' in (t as object) && 'width' in (t as object);

const toElement = (s: SurfaceRef): Element | null => {
  if (!s) return null;
  if (typeof Node !== 'undefined' && s instanceof Node) return s as Element;
  return (s as RefObject<Element | null>).current ?? null;
};

const list = <T,>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

const inRect = (r: DOMRect, x: number, y: number) =>
  r.width + r.height > 0 && x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height;

/** The outermost floating surface around `el`, if any. */
function floatingRoot(el: Element): Element | null {
  let found: Element | null = null;
  let at: Element | null = el.closest(FLOATING_SELECTOR);
  while (at) {
    found = at;
    at = at.parentElement?.closest(FLOATING_SELECTOR) ?? null;
  }
  return found;
}

let disarmSwallow: (() => void) | null = null;

/**
 * Eat the next `click` on the window, once — the one that completes a press
 * already handled on `pointerdown`. Gone after that click or `ms`, whichever
 * comes first. It outlives the surface that armed it: closing unmounts that.
 */
export function swallowNextClick(ms = SWALLOW_MS): void {
  if (typeof window === 'undefined') return;
  disarmSwallow?.();
  const onClick = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    done();
  };
  const timer = window.setTimeout(() => done(), ms);
  function done() {
    window.removeEventListener('click', onClick, true);
    window.clearTimeout(timer);
    if (disarmSwallow === done) disarmSwallow = null;
  }
  window.addEventListener('click', onClick, true);
  disarmSwallow = done;
}

/**
 * Listen for presses outside, in the capture phase, from now until the
 * returned function is called. `options` may be a getter, read on each press.
 */
export function listenOutsidePress(options: OutsidePressOptions | (() => OutsidePressOptions)): () => void {
  const read = typeof options === 'function' ? options : () => options;
  // What was already floating when this opened: parents and siblings, not children.
  const before = new Set<Element>(Array.from(document.querySelectorAll(FLOATING_SELECTOR)));

  const onDown = (e: PointerEvent) => {
    const o = read();
    const target = e.target instanceof Element ? e.target : (e.target as Node | null)?.parentElement ?? null;

    const surfaces = typeof o.surfaces === 'function' ? o.surfaces() : o.surfaces.map(toElement);
    if (target) {
      if (surfaces.some((s) => s?.contains(target))) return;
      const root = floatingRoot(target);
      if (root && !before.has(root)) return;
      if (o.ignore?.(target, e)) return;
    }

    const triggers = list(typeof o.triggers === 'function' ? o.triggers() : o.triggers);
    const primary = e.button === 0;
    for (const t of triggers) {
      if (!t) continue;
      if (isRect(t)) {
        if (inRect(t, e.clientX, e.clientY)) {
          if (primary) swallowNextClick();
          o.onOutside(e);
          return;
        }
        continue;
      }
      const el = toElement(t);
      if (el && target && el.contains(target)) {
        if (primary && (o.trigger ?? 'toggle') === 'toggle') return;
        if (primary) swallowNextClick();
        o.onOutside(e);
        return;
      }
    }
    o.onOutside(e);
  };

  window.addEventListener('pointerdown', onDown, true);
  return () => window.removeEventListener('pointerdown', onDown, true);
}

/**
 * `listenOutsidePress` for as long as `open` is true. The options are read
 * fresh on every press, so inline callbacks and refs are fine; only `open`
 * re-arms it (and re-reads what was already floating).
 */
export function useOutsidePress(options: OutsidePressOptions & { open: boolean }): void {
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    if (!options.open) return;
    return listenOutsidePress(() => latest.current);
  }, [options.open]);
}

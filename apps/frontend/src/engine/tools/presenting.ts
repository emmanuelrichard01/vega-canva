/**
 * Whether the board is being presented.
 *
 * Presenting is read-only: the board behind the slide must not react to the
 * keyboard, the wheel or the pointer. Board key handlers are registered in
 * many places and several listen in the capture phase before the presenter
 * mounts, so the guarantee comes from here instead of from listener order.
 * This module registers one capture listener on `window` when it is first
 * imported, which is before any component effect can add its own, and that
 * listener swallows every key, wheel and pointer event aimed at the board
 * while a presentation runs. The presenter's own keys go through the one
 * handler it registers with `setPresenterKeys`.
 *
 * Handlers that want an explicit early return read `isPresenting()`.
 */

import { cursorOverride } from '../cursor/cursorOverride';

let presenting = false;
let presenterKeys: ((e: KeyboardEvent) => void) | null = null;
const listeners = new Set<() => void>();

export const isPresenting = (): boolean => presenting;

export function subscribePresenting(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setPresenting(on: boolean): void {
  if (presenting === on) return;
  presenting = on;
  if (typeof document !== 'undefined') {
    // The one switch the board's chrome answers to: `framePresenter.css`
    // hides everything but the slide and the show under this attribute, and
    // `usePresenting` unmounts the panels and the dock from the same state.
    if (on) document.documentElement.dataset.presenting = 'true';
    else delete document.documentElement.dataset.presenting;
  }
  if (on) {
    // Whatever was mid-gesture lets go: a resize cursor or a text caret
    // claimed before the show would otherwise outlive it.
    cursorOverride.releaseAll();
    const focused = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    if (focused && focused !== document.body) focused.blur?.();
  }
  if (!on) presenterKeys = null;
  listeners.forEach((fn) => fn());
}

/** The presenter's key handler. The gate hands it every key, then claims it. */
export function setPresenterKeys(handler: ((e: KeyboardEvent) => void) | null): void {
  presenterKeys = handler;
}

function gateKey(e: KeyboardEvent): void {
  if (!presenting) return;
  if (e.type === 'keydown') presenterKeys?.(e);
  e.stopImmediatePropagation();
}

/**
 * The presenter's own surfaces: the show's controls and an on-screen
 * presenter view. Anything inside one of these takes its own clicks.
 */
export const PRESENTER_UI = '.fp-root, [data-presenter-ui]';

function gateInput(e: Event): void {
  if (!presenting) return;
  const target = e.target as Element | null;
  const onPresenter = !!target?.closest?.(PRESENTER_UI);
  // The presenter's own controls take clicks. The wheel would still reach the
  // board's camera listeners from there, so it is claimed either way.
  if (onPresenter && e.type !== 'wheel') return;
  if (e.type === 'wheel') e.preventDefault();
  e.stopImmediatePropagation();
}

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', gateKey, true);
  window.addEventListener('keyup', gateKey, true);
  window.addEventListener('wheel', gateInput, { capture: true, passive: false });
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'dblclick', 'contextmenu', 'touchstart']) {
    window.addEventListener(type, gateInput, true);
  }
}

export type PresenterKeyAction = 'stop' | 'next' | 'previous' | 'first' | 'last';

const NEXT_KEYS = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'];
const PREVIOUS_KEYS = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'];

/**
 * What a key does to the show, or null when it is not the presenter's.
 *
 * `focusOwnsKey` is true when something with focus outside the presenter takes
 * this key (a text field, a select), so Space or Enter typed there does not
 * advance. `onControl` is true when a presenter button has focus: Enter and
 * Space then belong to that button. Escape always ends the show.
 */
export function presenterKeyAction(
  key: string,
  { focusOwnsKey, onControl }: { focusOwnsKey: boolean; onControl: boolean }
): PresenterKeyAction | null {
  if (key === 'Escape') return 'stop';
  if (focusOwnsKey) return null;
  if (onControl && (key === 'Enter' || key === ' ')) return null;
  if (NEXT_KEYS.includes(key)) return 'next';
  if (PREVIOUS_KEYS.includes(key)) return 'previous';
  if (key === 'Home') return 'first';
  if (key === 'End') return 'last';
  return null;
}

/**
 * Everything a key can do to a show, beyond moving through it.
 *
 * - `goto`: a slide number typed and confirmed with Enter, as in Keynote and
 *   PowerPoint. The digits show while they are being typed.
 * - `blank`: B (or full stop) blacks the screen, W whites it; the same key
 *   again, or any move, brings the slide back.
 * - `laser`: L turns the laser pointer on and off.
 * - `typing`: a digit was added to (or Backspace removed one from) the number
 *   being typed. Nothing moves yet.
 */
export type PresenterCommand =
  | { type: PresenterKeyAction }
  | { type: 'goto'; number: number }
  | { type: 'blank'; blank: 'black' | 'white' }
  | { type: 'laser' }
  | { type: 'typing'; digits: string };

/** A typed number is forgotten after this long without another digit. */
export const DIGIT_TIMEOUT_MS = 1600;

/**
 * A presenter's keyboard, with the memory a typed slide number needs.
 *
 * Pure apart from the clock it is handed, so the digit buffer, its timeout
 * and the precedence over the plain keys are all tested without a DOM.
 */
export function createPresenterKeys() {
  let digits = '';
  let lastDigitAt = 0;

  return {
    digits: () => digits,
    reset() {
      digits = '';
    },
    /** What `key` does at time `now`, or null when it is not the presenter's. */
    interpret(
      key: string,
      ctx: { focusOwnsKey: boolean; onControl: boolean; mod?: boolean },
      now: number
    ): PresenterCommand | null {
      if (digits && now - lastDigitAt > DIGIT_TIMEOUT_MS) digits = '';
      if (key === 'Escape') {
        // Escape first abandons a half-typed number, then ends the show.
        if (digits) {
          digits = '';
          return { type: 'typing', digits };
        }
        return { type: 'stop' };
      }
      if (ctx.focusOwnsKey || ctx.mod) return null;
      if (/^[0-9]$/.test(key) && !ctx.onControl) {
        if (digits.length < 4) digits += key;
        lastDigitAt = now;
        return { type: 'typing', digits };
      }
      if (digits && key === 'Backspace') {
        digits = digits.slice(0, -1);
        lastDigitAt = now;
        return { type: 'typing', digits };
      }
      if (digits && key === 'Enter') {
        const number = Number(digits);
        digits = '';
        return number >= 1 ? { type: 'goto', number } : { type: 'typing', digits };
      }
      digits = '';
      const lower = key.length === 1 ? key.toLowerCase() : key;
      if (lower === 'b' || key === '.') return { type: 'blank', blank: 'black' };
      if (lower === 'w' || key === ',') return { type: 'blank', blank: 'white' };
      if (lower === 'l') return { type: 'laser' };
      const action = presenterKeyAction(key, ctx);
      return action ? { type: action } : null;
    },
  };
}

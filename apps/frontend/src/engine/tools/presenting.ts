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
    if (on) document.documentElement.dataset.presenting = 'true';
    else delete document.documentElement.dataset.presenting;
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

function gateInput(e: Event): void {
  if (!presenting) return;
  const target = e.target as Element | null;
  const onPresenter = !!target?.closest?.('.fp-root');
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

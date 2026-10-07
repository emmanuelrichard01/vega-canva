import { isPresenting, subscribePresenting } from '../tools/presenting';

/** How long a presenter's pointer may rest before it is hidden. */
export const PRESENTING_IDLE_MS = 2200;

/**
 * Hides the pointer while a presentation runs and the hand is at rest.
 *
 * A slide is read, not operated: a resting arrow sits on the content. It is
 * hidden by an attribute on the root (`data-cursor-idle`, which
 * `cursor.css` turns into `cursor: none` over the presenter only) once the
 * pointer has been still for `idleMs`, and shown again by any movement or
 * press, so the controls are never unreachable. Outside a presentation the
 * attribute is never set, which is why this cannot strand the board without a
 * pointer. Returns the cleanup.
 */
export function watchPresentingCursor(idleMs: number = PRESENTING_IDLE_MS): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return () => {};
  const root = document.documentElement;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stop = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const show = () => {
    delete root.dataset.cursorIdle;
  };
  const arm = () => {
    stop();
    show();
    if (!isPresenting()) return;
    timer = setTimeout(() => {
      timer = null;
      if (isPresenting()) root.dataset.cursorIdle = 'true';
    }, idleMs);
  };

  // Outside a presentation a pointer move costs one boolean read: nothing is
  // written to the document at interaction rate.
  const activity = () => {
    if (isPresenting()) arm();
  };
  const events = ['pointermove', 'pointerdown', 'wheel'] as const;
  events.forEach((name) => window.addEventListener(name, activity, { capture: true, passive: true }));
  const unsubscribe = subscribePresenting(arm);
  arm();

  return () => {
    events.forEach((name) => window.removeEventListener(name, activity, { capture: true }));
    unsubscribe();
    stop();
    show();
  };
}

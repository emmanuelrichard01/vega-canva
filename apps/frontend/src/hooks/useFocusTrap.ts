import { useEffect, useRef } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Trap focus inside a dialog while it is open, and restore it on close.
 *
 * Without this, tabbing inside any of the app's modals walks straight out into
 * the canvas and toolbar behind them — the dialog stays visually on top while
 * keyboard focus is somewhere underneath it, which for a keyboard or screen
 * reader user makes the modal impossible to operate and impossible to leave.
 *
 * Also handles Escape, so every dismissible surface behaves the same way.
 */
export function useFocusTrap(
  active: boolean,
  onEscape?: () => void
): React.RefObject<HTMLDivElement | null> {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;

    const container = containerRef.current;
    // Remember where focus came from so it can be handed back — otherwise
    // closing a dialog drops focus onto <body> and the user loses their place.
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = () =>
      Array.from(container?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );

    // Move focus in on open: the first control, or the dialog itself.
    const initial = focusable()[0] ?? container;
    initial?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onEscape) {
        e.preventDefault();
        e.stopPropagation();
        onEscape();
        return;
      }

      if (e.key !== 'Tab' || !container) return;

      const items = focusable();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement;

      // Wrap around at both ends rather than escaping the dialog.
      if (e.shiftKey && (activeEl === first || !container.contains(activeEl))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previouslyFocused?.focus?.();
    };
  }, [active, onEscape]);

  return containerRef;
}

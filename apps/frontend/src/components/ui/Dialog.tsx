import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { tooltipProps } from './Tooltip';
import './dialog.css';

/**
 * The one dialog shell: Help, Share, Export and anything after them.
 *
 * What it guarantees, so no dialog has to remember:
 * - focus moves in on open (to `[data-autofocus]`, else the first control that
 *   is not the close button), stays in while Tab wraps, and goes back to where
 *   it came from on close;
 * - Escape and a press on the scrim close it, and only the topmost dialog
 *   answers, so a confirmation stacked over a dialog closes alone;
 * - one elevation (the overlay shadow, no border);
 * - an entrance and an exit. The exit plays before `onClose` runs, so callers
 *   can keep unmounting on close. Under reduced motion both are a short fade
 *   with no movement.
 *
 * Increased contrast comes from the tokens: `--shadow-overlay` becomes a solid
 * 3:1 edge there, and the text roles strengthen. Nothing here names the mode.
 */

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl';

interface DialogContextValue {
  /** Play the exit, then call the dialog's `onClose`. */
  close: () => void;
  titleId: string;
  descriptionId: string;
}

const DialogContext = createContext<DialogContextValue | null>(null);

/** The open dialog's controls, for anything inside it that needs to close it. */
export function useDialog(): DialogContextValue {
  const value = useContext(DialogContext);
  if (!value) throw new Error('useDialog must be used inside a <Dialog>.');
  return value;
}

/** Open dialogs, oldest first. Only the last one answers keys. */
const stack: string[] = [];

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusables(root: HTMLElement): HTMLElement[] {
  // Without layout (a test DOM) nothing has a box, and every control counts.
  const laidOut = root.getClientRects().length > 0;
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) =>
      !el.closest('[hidden]') &&
      (!laidOut || el.offsetParent !== null || el === document.activeElement || el.getClientRects().length > 0)
  );
}

/** Longest the exit may take before `onClose` runs anyway (no `animationend`). */
const EXIT_FALLBACK_MS = 240;

export interface DialogProps {
  onClose: () => void;
  children: React.ReactNode;
  size?: DialogSize;
  /** `alertdialog` for a question that has to be answered before anything else. */
  role?: 'dialog' | 'alertdialog';
  /** Used when there is no `<DialogHeader>` to name the dialog. */
  ariaLabel?: string;
  className?: string;
  /** A press on the scrim closes the dialog. On by default. */
  dismissOnScrim?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
}

export const Dialog: React.FC<DialogProps> = ({
  onClose,
  children,
  size = 'md',
  role = 'dialog',
  ariaLabel,
  className,
  dismissOnScrim = true,
  onKeyDown,
}) => {
  const key = useId();
  const titleId = `${key}-title`;
  const descriptionId = `${key}-desc`;
  const panelRef = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const [labelled, setLabelled] = useState({ title: false, description: false });

  // Callers pass inline closures; a ref keeps the trap from being rebuilt on
  // every parent render, which would pull focus out of a field mid-word.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closedRef = useRef(false);

  const finish = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    onCloseRef.current();
  }, []);

  const close = useCallback(() => {
    if (closedRef.current) return;
    setClosing(true);
  }, []);

  // The exit: wait for the panel's animation, with a ceiling for browsers or
  // modes (forced colours, a hidden tab) where it never reports finishing.
  useEffect(() => {
    if (!closing) return;
    const panel = panelRef.current;
    const done = (e?: AnimationEvent) => {
      if (e && e.target !== panel) return;
      finish();
    };
    panel?.addEventListener('animationend', done);
    const t = window.setTimeout(() => finish(), EXIT_FALLBACK_MS);
    return () => {
      panel?.removeEventListener('animationend', done);
      window.clearTimeout(t);
    };
  }, [closing, finish]);

  // Which of the header's ids actually exist, so `aria-labelledby` never
  // points at nothing.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    setLabelled({
      title: Boolean(panel.querySelector(`[id="${titleId}"]`)),
      description: Boolean(panel.querySelector(`[id="${descriptionId}"]`)),
    });
  }, [titleId, descriptionId]);

  // Focus in, trap, Escape, and focus back out.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    stack.push(key);
    const cameFrom = document.activeElement as HTMLElement | null;

    const first =
      panel.querySelector<HTMLElement>('[data-autofocus]:not(:disabled)') ??
      focusables(panel).find((el) => !el.hasAttribute('data-dialog-close')) ??
      panel;
    first.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== key) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables(panel);
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const head = items[0];
      const tail = items[items.length - 1];
      const at = document.activeElement;
      if (e.shiftKey && (at === head || at === panel || !panel.contains(at))) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && (at === tail || !panel.contains(at))) {
        e.preventDefault();
        head.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);

    return () => {
      document.removeEventListener('keydown', onKey, true);
      const at = stack.lastIndexOf(key);
      if (at >= 0) stack.splice(at, 1);
      if (cameFrom && cameFrom.isConnected) cameFrom.focus({ preventScroll: true });
    };
  }, [key, close]);

  const value = React.useMemo(() => ({ close, titleId, descriptionId }), [close, titleId, descriptionId]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <DialogContext.Provider value={value}>
      <div
        className="dlg-scrim"
        data-state={closing ? 'closing' : 'open'}
        role="presentation"
        onPointerDown={(e) => {
          if (dismissOnScrim && e.target === e.currentTarget) close();
        }}
      >
        <div
          ref={panelRef}
          className={['dlg', `dlg--${size}`, className].filter(Boolean).join(' ')}
          data-state={closing ? 'closing' : 'open'}
          role={role}
          aria-modal="true"
          aria-labelledby={labelled.title ? titleId : undefined}
          aria-describedby={labelled.description ? descriptionId : undefined}
          aria-label={labelled.title ? undefined : ariaLabel}
          tabIndex={-1}
          onKeyDown={onKeyDown}
        >
          {children}
        </div>
      </div>
    </DialogContext.Provider>,
    document.body
  );
};

/** The dialog's title row: a heading, an optional line under it, and Close. */
export const DialogHeader: React.FC<{
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Controls that sit before the close button. */
  actions?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}> = ({ title, description, actions, className, children }) => {
  const { close, titleId, descriptionId } = useDialog();
  return (
    <header className={['dlg__head', className].filter(Boolean).join(' ')}>
      <div className="dlg__heading">
        <h2 id={titleId} className="dlg__title">
          {title}
        </h2>
        {description && (
          <div id={descriptionId} className="dlg__description">
            {description}
          </div>
        )}
        {children}
      </div>
      <div className="dlg__head-actions">
        {actions}
        <button
          type="button"
          className="dlg__close"
          onClick={close}
          aria-label="Close"
          data-dialog-close
          {...tooltipProps({ label: 'Close', shortcut: 'Esc', side: 'bottom' })}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
};

/** The scrolling middle. */
export const DialogBody: React.FC<{ className?: string; children: React.ReactNode }> = ({ className, children }) => (
  <div className={['dlg__body', className].filter(Boolean).join(' ')}>{children}</div>
);

/** The action row. Pinned to the bottom of the panel; the body scrolls above it. */
export const DialogFooter: React.FC<{ className?: string; children: React.ReactNode }> = ({ className, children }) => (
  <footer className={['dlg__foot', className].filter(Boolean).join(' ')}>{children}</footer>
);

import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { resolveRelease, SheetDrag, snapHeights, type SnapName } from './bottomSheetModel';
import './bottomSheet.css';

/**
 * A sheet that rises from the bottom edge, for the phone.
 *
 * - **Snap points.** `peek`, `half` and `full`, any subset. It opens at
 *   `initialSnap` and rests only on one of its snaps.
 * - **The handle drags it.** A drag on the handle or the title row moves the
 *   sheet with the finger; letting go settles it by velocity and distance
 *   (`resolveRelease`): a flick goes one step the way it was thrown, a slow
 *   release goes to the nearest snap, and pulled below half the lowest snap,
 *   or flicked down from it, it goes away.
 * - **The keyboard.** It is a modal dialog: focus moves in on open, Tab stays
 *   inside, Escape closes, and focus returns to what opened it. The handle is
 *   a button: Up and Down step through the snaps, Enter goes to the next one.
 * - **Reduced motion.** It moves between snaps without travelling.
 *
 * The parent owns `open`. A dismissal from inside (swipe, scrim, Escape,
 * Close) lowers the sheet, then calls `onClose`; the parent unmounting it is
 * immediate.
 */
export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  /** The dialog's accessible name, also shown as its title unless `hideTitle`. */
  label: string;
  hideTitle?: boolean;
  /** Only the handle: the content brings its own title and Close. Implies `hideTitle`. */
  headless?: boolean;
  snaps?: readonly SnapName[];
  initialSnap?: SnapName;
  /** Controls at the end of the title row, before Close. */
  actions?: React.ReactNode;
  className?: string;
  /** Called with the snap the sheet settles on. */
  onSnap?: (snap: SnapName) => void;
  children: React.ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** How long the sheet takes to settle, and to lower before `onClose`. */
export const SHEET_SETTLE_MS = 280;

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

/** The room above the bottom edge a full sheet may take: the visual viewport less a strip at the top. */
function readRoom(): number {
  if (typeof window === 'undefined') return 800;
  const h = window.visualViewport?.height ?? window.innerHeight;
  return Math.max(200, h - 12);
}

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('inert') && el.getAttribute('aria-hidden') !== 'true'
  );
}

export const BottomSheet: React.FC<BottomSheetProps> = ({
  open,
  onClose,
  label,
  hideTitle: hideTitleProp = false,
  headless = false,
  snaps = ['half', 'full'],
  initialSnap,
  actions,
  className,
  onSnap,
  children,
}) => {
  const titleId = useId();
  const hideTitle = hideTitleProp || headless;
  const sheetRef = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(readRoom);
  const heights = snapHeights(snaps, room);
  const startIndex = Math.max(
    0,
    heights.findIndex((h) => h.name === (initialSnap ?? heights[heights.length - 1]?.name))
  );
  const reduced = reducedMotion();

  const [snapIndex, setSnapIndex] = useState(startIndex);
  /** The height while a finger holds the sheet, else null and the snap decides. */
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  /** Rising from nothing on the first frame, or lowering on the way out. */
  const [phase, setPhase] = useState<'entering' | 'open' | 'closing'>(reduced ? 'open' : 'entering');
  const drag = useRef<{ d: SheetDrag; id: number; moved: boolean } | null>(null);
  /** The click that ends a drag on the handle is not a tap on it. */
  const swallowClick = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // The viewport changes under a phone all the time: rotation, the keyboard, the browser's bars.
  useEffect(() => {
    const update = () => setRoom(readRoom());
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, []);

  // One frame at zero height, then up to the first snap, so it rises.
  useLayoutEffect(() => {
    if (phase !== 'entering') return;
    const raf = requestAnimationFrame(() => setPhase('open'));
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  const closeTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  const dismiss = useCallback(() => {
    if (reducedMotion()) {
      onCloseRef.current();
      return;
    }
    setDragHeight(null);
    setPhase('closing');
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => onCloseRef.current(), SHEET_SETTLE_MS);
  }, []);

  const settleOn = useCallback(
    (index: number) => {
      setSnapIndex(index);
      setDragHeight(null);
      const name = heights[index]?.name;
      if (name) onSnap?.(name);
    },
    [heights, onSnap]
  );

  // Focus in on open, Tab kept inside, Escape out, focus back on close.
  useEffect(() => {
    if (!open) return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    const cameFrom = document.activeElement as HTMLElement | null;
    const first = sheet.querySelector<HTMLElement>('[data-autofocus]') ?? sheet;
    first.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        dismiss();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables(sheet);
      if (items.length === 0) {
        e.preventDefault();
        sheet.focus({ preventScroll: true });
        return;
      }
      const head = items[0];
      const tail = items[items.length - 1];
      const at = document.activeElement;
      if (e.shiftKey && (at === head || at === sheet || !sheet.contains(at))) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && (at === tail || !sheet.contains(at))) {
        e.preventDefault();
        head.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (cameFrom && cameFrom.isConnected) cameFrom.focus({ preventScroll: true });
    };
  }, [open, dismiss]);

  if (!open || typeof document === 'undefined') return null;

  const restHeight = heights[snapIndex]?.height ?? room;
  const height = phase === 'open' ? (dragHeight ?? restHeight) : 0;
  const full = heights[heights.length - 1]?.height ?? room;

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    // A press on a control in the title row is that control's, not a drag.
    if ((e.target as HTMLElement).closest('button:not(.bsheet__handle), a, input')) return;
    drag.current = { d: new SheetDrag(e.clientY, restHeight, full, e.timeStamp), id: e.pointerId, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const g = drag.current;
    if (!g || g.id !== e.pointerId) return;
    if (!g.moved && !g.d.moved(e.clientY)) return;
    g.moved = true;
    setDragHeight(g.d.move(e.clientY, e.timeStamp));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    const g = drag.current;
    if (!g || g.id !== e.pointerId) return;
    drag.current = null;
    swallowClick.current = g.moved;
    if (!g.moved) return;
    const at = g.d.heightAt(e.clientY);
    const result = resolveRelease(at, g.d.velocity(e.timeStamp), heights.map((h) => h.height));
    if (result === 'dismiss') dismiss();
    else settleOn(result);
  };
  const onPointerCancel = () => {
    drag.current = null;
    setDragHeight(null);
  };

  const onHandleKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      settleOn(Math.min(heights.length - 1, snapIndex + 1));
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (snapIndex === 0) dismiss();
      else settleOn(snapIndex - 1);
    }
  };

  return createPortal(
    <div className="bsheet-root" data-reduced={reduced || undefined}>
      <div
        className="bsheet-scrim"
        data-state={phase}
        role="presentation"
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) dismiss();
        }}
      />
      <div
        ref={sheetRef}
        className={['bsheet', className].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={hideTitle ? undefined : titleId}
        aria-label={hideTitle ? label : undefined}
        tabIndex={-1}
        data-snap={heights[snapIndex]?.name}
        data-state={phase}
        data-dragging={dragHeight !== null || undefined}
        style={{ height }}
      >
        <div
          className="bsheet__grip"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        >
          <button
            type="button"
            className="bsheet__handle"
            aria-label={`Resize ${label}`}
            onClick={() => {
              if (swallowClick.current) {
                swallowClick.current = false;
                return;
              }
              settleOn((snapIndex + 1) % heights.length);
            }}
            onKeyDown={onHandleKey}
          >
            <span aria-hidden="true" />
          </button>
          {!headless && (
          <div className="bsheet__head" data-hidden={hideTitle || undefined}>
            {!hideTitle && (
              <h2 id={titleId} className="bsheet__title">
                {label}
              </h2>
            )}
            <span className="bsheet__actions">
              {actions}
              <button type="button" className="bsheet__close" onClick={dismiss} aria-label={`Close ${label}`}>
                <X size={18} aria-hidden="true" />
              </button>
            </span>
          </div>
          )}
        </div>
        <div className="bsheet__body">{children}</div>
      </div>
    </div>,
    document.body
  );
};

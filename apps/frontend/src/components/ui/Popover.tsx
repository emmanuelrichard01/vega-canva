import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { placeAtRect, type Placement } from '../menu/menuModel';
import { PORTAL_SURFACE_ATTR } from './portalSurface';
import { useOutsidePress } from './outsidePress';
import { useSuppressTooltips } from './Tooltip';
import './popover.css';

/**
 * The one popover: a surface hung off a trigger.
 *
 * It owns the four things every hand-rolled panel got slightly wrong: it flips
 * above the trigger and shifts inside the window instead of leaving the screen,
 * it closes on Escape and on a press outside, it returns focus to the trigger,
 * and it is marked as a portal surface so a parent's outside-click handler does
 * not take it down mid-gesture. Enter is 150ms (opacity and a 4px rise), exit
 * 100ms, neither under reduced motion; elevation is declared once.
 */

const MARGIN = 8;
const EXIT_MS = 100;

export interface PopoverProps {
  /** The element the popover hangs from. */
  anchor: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  /** Accessible name for the surface. */
  label: string;
  prefer?: 'below' | 'above';
  align?: 'start' | 'end';
  /** `dialog` for panels with controls, `presentation` for plain readouts. */
  role?: 'dialog' | 'presentation';
  className?: string;
  children: React.ReactNode;
}

export const Popover: React.FC<PopoverProps> = ({
  anchor,
  open,
  onClose,
  label,
  prefer = 'below',
  align = 'start',
  role = 'dialog',
  className,
  children,
}) => {
  const surface = useRef<HTMLDivElement>(null);
  // An open popover owns the screen; no tip competes with it.
  useSuppressTooltips(open);
  const id = useId();
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const [placed, setPlaced] = useState<Placement | null>(null);

  // Stay mounted through the exit.
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    setShown(false);
    const t = window.setTimeout(() => setMounted(false), EXIT_MS);
    return () => window.clearTimeout(t);
  }, [open]);

  const place = useCallback(() => {
    const trigger = anchor.current;
    const node = surface.current;
    if (!trigger || !node) return;
    const size = { width: node.offsetWidth, height: node.scrollHeight };
    setPlaced(
      placeAtRect(trigger.getBoundingClientRect(), size, { width: window.innerWidth, height: window.innerHeight, margin: MARGIN }, prefer, align)
    );
  }, [anchor, prefer, align]);

  useLayoutEffect(() => {
    if (!mounted) return;
    place();
    if (open) setShown(true);
  }, [mounted, open, place]);

  useEffect(() => {
    if (!open) return;
    const reflow = () => place();
    window.addEventListener('resize', reflow);
    window.addEventListener('scroll', reflow, true);
    return () => {
      window.removeEventListener('resize', reflow);
      window.removeEventListener('scroll', reflow, true);
    };
  }, [open, place]);

  // The anchor is the trigger and toggles, so a press on it is left to its click.
  useOutsidePress({ open, surfaces: [surface], triggers: anchor, onOutside: () => onClose() });

  useEffect(() => {
    if (!open) return;
    const trigger = anchor.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
      trigger?.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, anchor, onClose]);

  if (!mounted || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={surface}
      id={id}
      role={role === 'dialog' ? 'dialog' : undefined}
      aria-label={label}
      {...{ [PORTAL_SURFACE_ATTR]: '' }}
      className={`popover${shown ? ' is-open' : ''}${className ? ` ${className}` : ''}`}
      data-side={placed?.origin.startsWith('bottom') ? 'above' : 'below'}
      style={{
        left: placed?.x ?? 0,
        top: placed?.y ?? 0,
        maxHeight: placed?.maxHeight,
        visibility: placed ? undefined : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body
  );
};

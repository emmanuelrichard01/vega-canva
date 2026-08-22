import React, { useState, useRef, useLayoutEffect, useEffect } from 'react';
import { isInsidePortalSurface } from '../ui/portalSurface';

export interface RailPopoverProps {
  label: string;
  trigger: React.ReactNode;
  children: React.ReactNode;
  placement?: 'top' | 'bottom';
  align?: 'start' | 'center' | 'end';
}

/**
 * Floating popover for the Object Context Toolbar.
 * Adapts vertically based on available viewport space.
 */
export const RailPopover: React.FC<RailPopoverProps> = ({
  label,
  trigger,
  children,
  placement = 'bottom',
  align = 'center',
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const [side, setSide] = useState<'top' | 'bottom'>(placement);

  useLayoutEffect(() => {
    if (!open) return;
    const triggerEl = ref.current;
    const panel = panelRef.current;
    if (!triggerEl || !panel) return;

    const rect = triggerEl.getBoundingClientRect();
    const needed = panel.offsetHeight + 8;
    const below = window.innerHeight - rect.bottom;
    const above = rect.top;

    if (placement === 'bottom' && below < needed && above > below) setSide('top');
    else if (placement === 'top' && above < needed && below > above) setSide('bottom');
    else setSide(placement);
  }, [open, placement]);

  useEffect(() => {
    if (!open) setSide(placement);
  }, [open, placement]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (isInsidePortalSurface(e.target)) return;
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div style={{ position: 'relative', display: 'flex' }} ref={ref}>
      <button
        type="button"
        className="ctx-btn"
        data-tooltip={label}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {trigger}
      </button>
      {open && (
        <div
          ref={panelRef}
          className="ctx-popover"
          role="dialog"
          aria-label={label}
          data-side={side}
          style={{
            [side === 'bottom' ? 'top' : 'bottom']: 'calc(100% + 8px)',
            ...(align === 'center'
              ? { left: '50%', translate: '-50% 0' }
              : align === 'end'
                ? { right: 0 }
                : { left: 0 }),
          } as React.CSSProperties}
        >
          {children}
        </div>
      )}
    </div>
  );
};

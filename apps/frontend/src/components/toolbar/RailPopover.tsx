import React, { useState, useRef, useLayoutEffect, useEffect, useContext } from 'react';
import { createPortal } from 'react-dom';
import { isInsidePortalSurface } from '../ui/portalSurface';
import { RailSideContext } from './railSide';
import { railSubject } from './railSubject';
import { placeRail, type RailSide } from '../../engine/interaction/railPlacement';

export interface RailPopoverProps {
  label: string;
  trigger: React.ReactNode;
  /**
   * The panel's contents, or a function given a `close` for a control that
   * finishes the interaction — picking a reaction, choosing a preset.
   */
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
  /** Overrides the side the rail is on. Rarely wanted. */
  placement?: 'top' | 'bottom';
  align?: 'start' | 'center' | 'end';
  /**
   * Place this panel against the *artwork* rather than against its own button.
   *
   * For the small popovers — a colour, a weight, a handful of tiles — hanging
   * off the trigger is right: they are shorter than the gap the rail already
   * found, so they land in it, and staying glued to the button keeps the
   * relationship obvious.
   *
   * A tall panel cannot do that. The shape picker is around 400px, the gap
   * above a selection is routinely 130, and a rule that flips to "whichever
   * side has more room" then puts it **on the object** — which is the one
   * outcome the arrangement exists to avoid, arrived at by trying to avoid it.
   * Neither side fitting is not a tie to be broken; it means the panel does not
   * belong on either side of the button.
   *
   * So it is placed like the rail itself: against the selection, on any of four
   * sides, inside the same free strip, by the same function. That is reuse and
   * not a parallel implementation — `placeRail` already knows about hysteresis,
   * about measuring to the shadow rather than to the box, and about saying so
   * when nothing fits.
   */
  float?: boolean;
}

/**
 * Floating popover for the Object Context Toolbar.
 *
 * Two placements, and which one a panel gets is a property of its size.
 * Anchored to the trigger by default, opening away from the artwork — see
 * `RailSideContext` — and flipping if the viewport edge would cut it off.
 * `float` places it against the selection instead; see the prop.
 */
export const RailPopover: React.FC<RailPopoverProps> = ({
  label,
  trigger,
  children,
  placement: placementProp,
  align = 'center',
  float = false,
}) => {
  const railSide = useContext(RailSideContext);
  const placement = placementProp ?? railSide;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const [side, setSide] = useState<'top' | 'bottom'>(placement);
  /**
   * How far an anchored panel has been slid along the rail to stay on screen.
   *
   * Applied on top of whatever `align` asked for, so alignment stays the intent
   * and this is only the correction. Nothing here had ever visibly overflowed,
   * because every popover on this rail was around 180px wide — which is not
   * evidence that it could not, only that nothing had been wide enough yet.
   */
  const [shift, setShift] = useState(0);
  /** Where a floating panel has been placed, in viewport pixels. */
  const [spot, setSpot] = useState<{ x: number; y: number; side: RailSide } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const triggerEl = ref.current;
    const panel = panelRef.current;
    if (!triggerEl || !panel) return;
    const rect = triggerEl.getBoundingClientRect();

    if (float) {
      /**
       * Measured after a paint, because the panel's height is not knowable
       * before it has one — which is also why an unplaced panel is hidden
       * rather than drawn at the origin. A panel that appears in the top-left
       * corner for one frame and then jumps is worse than one that appears
       * once, slightly later.
       */
      const measure = () => {
        const from = railSubject();
        const box = panel.getBoundingClientRect();
        const fallback = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
        const bounds = from?.bounds ?? {
          top: 12,
          bottom: window.innerHeight - 12,
          left: 12,
          right: window.innerWidth - 12,
        };
        setSpot(
          placeRail(from?.subject ?? fallback, { width: box.width, height: box.height }, bounds, 12)
        );
      };
      measure();
      const id = requestAnimationFrame(measure);
      return () => cancelAnimationFrame(id);
    }

    const needed = panel.offsetHeight + 8;
    // The artwork, if the rail published it. Falling back to the trigger keeps
    // every other popover behaving exactly as it did.
    const s = railSubject()?.subject;
    const subject = s
      ? { top: s.y, bottom: s.y + s.height }
      : { top: rect.top, bottom: rect.bottom };
    const below = window.innerHeight - Math.max(rect.bottom, subject.bottom);
    const above = Math.min(rect.top, subject.top);

    if (placement === 'bottom' && below < needed && above > below) setSide('top');
    else if (placement === 'top' && above < needed && below > above) setSide('bottom');
    else setSide(placement);

    // Horizontal: measure where the panel landed and slide it back inside.
    // Measured rather than computed, because `align` and the translate that
    // implements it are CSS, and re-deriving them here would be a second copy
    // of the rule that positions the thing.
    setShift(0);
    const id = requestAnimationFrame(() => {
      const box = panel.getBoundingClientRect();
      const margin = 8;
      const over = box.right - (window.innerWidth - margin);
      const under = margin - box.left;
      if (over > 0) setShift(-over);
      else if (under > 0) setShift(under);
    });
    return () => cancelAnimationFrame(id);
  }, [open, placement, float]);

  useEffect(() => {
    if (!open) {
      setSide(placement);
      setShift(0);
      setSpot(null);
    }
  }, [open, placement]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (isInsidePortalSurface(e.target)) return;
      // A floating panel is not inside the trigger's subtree, so "outside the
      // trigger" is no longer the same question as "outside the popover".
      if (panelRef.current?.contains(e.target as Node)) return;
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

  /**
   * The translate each side implies, from `placeRail`'s own table.
   *
   * The anchor is an edge-centre rather than a corner, so the panel's own size
   * is applied in CSS — which is what lets the first frame be placed before it
   * has been measured.
   */
  const FLOAT_TRANSLATE: Record<RailSide, string> = {
    top: 'translate(-50%, -100%)',
    bottom: 'translate(-50%, 0)',
    left: 'translate(-100%, -50%)',
    right: 'translate(0, -50%)',
  };

  const panel = (
    <div
      ref={panelRef}
      className="ctx-popover"
      role="dialog"
      aria-label={label}
      data-side={float ? spot?.side ?? placement : side}
      data-float={float || undefined}
      style={
        float
          ? ({
              position: 'fixed',
              left: spot?.x ?? 0,
              top: spot?.y ?? 0,
              transform: FLOAT_TRANSLATE[spot?.side ?? 'top'],
              // Hidden rather than mispositioned for the one frame before it
              // has been measured.
              visibility: spot ? 'visible' : 'hidden',
            } as React.CSSProperties)
          : ({
              [side === 'bottom' ? 'top' : 'bottom']: 'calc(100% + 8px)',
              ...(align === 'center'
                ? { left: '50%', translate: `calc(-50% + ${shift}px) 0` }
                : align === 'end'
                  ? { right: -shift }
                  : { left: shift }),
            } as React.CSSProperties)
      }
    >
      {typeof children === 'function' ? children(() => setOpen(false)) : children}
    </div>
  );

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
      {/* A floating panel leaves the rail's stacking context entirely: the rail
          is transformed every frame, and a fixed child of a transformed element
          is positioned against that element rather than against the viewport —
          so it would travel with the rail it is trying to stand clear of. */}
      {open && (float ? createPortal(panel, document.body) : panel)}
    </div>
  );
};

import React, { useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isInsidePortalSurface } from '../ui/portalSurface';
import { RailPopoverGroup, RailSideContext } from './railSide';
import { railSubject } from './railSubject';
import { anchoredPopover, placeRail, type RailSide } from '../../engine/interaction/railPlacement';
import { engineEvents } from '../../engine/EventBus';

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
   * side has more room" then puts it **on the object**. So it is placed like
   * the rail itself: against the selection, on any of four sides, inside the
   * same free strip, by the same function.
   */
  float?: boolean;
}

/** The first thing in a panel the keyboard can land on. */
const FOCUSABLE =
  'input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])';

const FLOAT_TRANSLATE: Record<RailSide, string> = {
  top: 'translate(-50%, -100%)',
  bottom: 'translate(-50%, 0)',
  left: 'translate(-100%, -50%)',
  right: 'translate(0, -50%)',
};

/**
 * A popover on the contextual rail.
 *
 * ## What makes it behave rather than merely appear
 *
 * - **It keeps itself on screen as it changes.** Placement used to be worked
 *   out once, when it opened. A panel that then grew — the shape swapper's
 *   other family disclosed, shading options appearing under a sketch level —
 *   ran off the bottom of the window. A `ResizeObserver` re-places it whenever
 *   its size changes, and when neither side can hold it whole it scrolls on
 *   the side away from the artwork rather than spilling onto it.
 * - **A floating panel follows its object.** Anchored panels ride the rail
 *   because they are inside it; a floating one is fixed to the window, so it
 *   used to stay behind when the board panned. It re-places on the camera and
 *   the object moving now, once per frame at most.
 * - **The rail reads like a menu bar.** With one popover open, moving the
 *   pointer onto another trigger — or arrowing to it — opens that one instead.
 *   Setting a stroke and then a sketch level is one sweep, not four clicks.
 * - **The keyboard is not stranded.** Opening from the keyboard puts focus in
 *   the panel; Escape closes it and gives focus back to its button, so the
 *   arrow keys carry on along the rail from where they were.
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
  const group = useContext(RailPopoverGroup);
  const placement = placementProp ?? railSide;
  const id = useId();

  const [localOpen, setLocalOpen] = useState(false);
  const open = group ? group.openId === id : localOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (group) group.setOpenId((current) => (next ? id : current === id ? null : current));
      else setLocalOpen(next);
    },
    [group, id]
  );

  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /** Set when the keyboard opened it, so focus moves in once it is placed. */
  const focusOnOpen = useRef(false);
  /** Opened by sweeping across from a sibling, which skips the entrance. */
  const [switched, setSwitched] = useState(false);

  const [side, setSide] = useState<'top' | 'bottom'>(placement);
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);
  /**
   * How far an anchored panel has been slid along the rail to stay on screen,
   * on top of whatever `align` asked for — alignment stays the intent and this
   * is only the correction.
   */
  const [shift, setShift] = useState(0);
  /** Where a floating panel has been placed, in viewport pixels. */
  const [spot, setSpot] = useState<{ x: number; y: number; side: RailSide } | null>(null);

  const place = useCallback(() => {
    const triggerEl = ref.current;
    const panel = panelRef.current;
    if (!triggerEl || !panel) return;
    const rect = triggerEl.getBoundingClientRect();
    // The panel's natural height, not the clamped one it may be showing now,
    // or a panel once squeezed could never be given its room back.
    const natural = panel.scrollHeight;

    if (float) {
      const from = railSubject();
      const box = panel.getBoundingClientRect();
      const fallback = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
      const bounds = from?.bounds ?? {
        top: 12,
        bottom: window.innerHeight - 12,
        left: 12,
        right: window.innerWidth - 12,
      };
      // Taller than the free strip: stay inside it and scroll, rather than run
      // past the top bar or under the dock — and place it at the height it
      // will actually be drawn, or its centring would be off by the overflow.
      const room = bounds.bottom - bounds.top;
      const height = Math.min(natural, room);
      const next = placeRail(from?.subject ?? fallback, { width: box.width, height }, bounds, 12);
      setSpot((current) =>
        current && current.x === next.x && current.y === next.y && current.side === next.side ? current : next
      );
      setMaxHeight(natural > room ? room : undefined);
      return;
    }

    const s = railSubject()?.subject;
    const decided = anchoredPopover(
      rect,
      s ? { top: s.y, bottom: s.y + s.height } : null,
      natural,
      placement,
      window.innerHeight
    );
    setSide(decided.side);
    setMaxHeight(decided.maxHeight);

    // Horizontal: measure where the panel landed and slide it back inside.
    // Measured rather than computed, because `align` and the translate that
    // implements it are CSS, and re-deriving them here would be a second copy
    // of the rule that positions the thing.
    const box = panel.getBoundingClientRect();
    const margin = 8;
    setShift((current) => {
      const naturalLeft = box.left - current;
      const naturalRight = box.right - current;
      const over = naturalRight - (window.innerWidth - margin);
      const under = margin - naturalLeft;
      return over > 0 ? -over : under > 0 ? under : 0;
    });
  }, [float, placement]);

  // Place on open, and again whenever the panel changes size.
  useLayoutEffect(() => {
    if (!open) return;
    place();
    const panel = panelRef.current;
    if (!panel || typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    });
    // The content, not the panel: a panel clamped to a max height does not
    // change size when what is inside it grows.
    Array.from(panel.children).forEach((child) => observer.observe(child));
    observer.observe(panel);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [open, place]);

  // A floating panel follows the board; an anchored one rides the rail already.
  useEffect(() => {
    if (!open || !float) return;
    let frame = 0;
    const follow = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    engineEvents.on('CameraChanged', follow);
    engineEvents.on('ObjectMoved', follow);
    engineEvents.on('ObjectModified', follow);
    window.addEventListener('resize', follow);
    return () => {
      cancelAnimationFrame(frame);
      engineEvents.off('CameraChanged', follow);
      engineEvents.off('ObjectMoved', follow);
      engineEvents.off('ObjectModified', follow);
      window.removeEventListener('resize', follow);
    };
  }, [open, float, place]);

  // Hand the keyboard in once the panel is where it will stay.
  useEffect(() => {
    if (!open || !focusOnOpen.current) return;
    if (float && !spot) return;
    focusOnOpen.current = false;
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true });
  }, [open, float, spot]);

  useEffect(() => {
    if (!open) {
      setSide(placement);
      setShift(0);
      setSpot(null);
      setMaxHeight(undefined);
      setSwitched(false);
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
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      const hadFocus =
        panelRef.current?.contains(document.activeElement) || triggerRef.current === document.activeElement;
      setOpen(false);
      if (hadFocus) triggerRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, setOpen]);

  /** Another popover on this rail is open, and this one should take over. */
  const siblingOpen = Boolean(group?.openId && group.openId !== id);

  const panel = (
    <div
      ref={panelRef}
      className="ctx-popover"
      role="dialog"
      aria-label={label}
      data-side={float ? spot?.side ?? placement : side}
      data-float={float || undefined}
      data-scrolls={maxHeight !== undefined || undefined}
      data-switched={switched || undefined}
      style={
        float
          ? ({
              position: 'fixed',
              left: spot?.x ?? 0,
              top: spot?.y ?? 0,
              maxHeight,
              transform: FLOAT_TRANSLATE[spot?.side ?? 'top'],
              // Hidden rather than mispositioned for the one frame before it
              // has been measured.
              visibility: spot ? 'visible' : 'hidden',
            } as React.CSSProperties)
          : ({
              [side === 'bottom' ? 'top' : 'bottom']: 'calc(100% + 8px)',
              maxHeight,
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
        ref={triggerRef}
        type="button"
        className="ctx-btn"
        data-tooltip={open ? undefined : label}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(e) => {
          if (!open && e.detail === 0) focusOnOpen.current = true;
          setSwitched(false);
          setOpen(!open);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            focusOnOpen.current = true;
            if (open) {
              panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true });
              focusOnOpen.current = false;
            } else {
              setOpen(true);
            }
          }
        }}
        onPointerEnter={(e) => {
          // Not while a button is held: dragging a slider out of its panel and
          // across the rail must not swap the panel out from under the drag.
          if (siblingOpen && e.buttons === 0) {
            setSwitched(true);
            setOpen(true);
          }
        }}
        onFocus={(e) => {
          if (siblingOpen && e.currentTarget.matches(':focus-visible')) {
            setSwitched(true);
            setOpen(true);
          }
        }}
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

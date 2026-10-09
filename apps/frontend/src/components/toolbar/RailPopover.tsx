import React, { useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOutsidePress } from '../ui/outsidePress';
import { RailPopoverGroup, RailSideContext } from './railSide';
import { railSubject } from './railSubject';
import { placeRail, type RailSide, type Rect } from '../../engine/interaction/railPlacement';
import { LIVE_HALO, POPOVER_HALO, placeRailPopover, type PopoverSide } from './rail/popoverPlacement';
import { engineEvents } from '../../engine/EventBus';
import './rail/rail.css';

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
  /**
   * A step on the flyout width scale (`--flyout-w-sm/md/lg`), the widths the
   * dock's panels take, so a list of rows on the rail is as wide as a list of
   * rows rising from the dock. Unset, the panel is as wide as what it holds,
   * which is right for a row of swatches or tiles.
   */
  size?: 'sm' | 'md' | 'lg';
  /**
   * The panel previews on the board while it is open: alignment ghosts, a
   * spacing being scrubbed, a live grid and its gap handles. It keeps a wider
   * halo around the selection clear, because what it draws there is the point.
   */
  live?: boolean;
}

/** The first thing in a panel the keyboard can land on. */
const FOCUSABLE =
  'input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])';

const toRect = (r: DOMRect): Rect => ({ x: r.left, y: r.top, width: r.width, height: r.height });

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
 * - **It never opens onto the selection when it can help it.** Away from the
 *   selection first (up when the rail is above it, down when below), beside it
 *   when that side is full, and only when nothing is clear over it, covering
 *   as little as possible. See `rail/popoverPlacement`.
 * - **It follows the board.** A pan or zoom that slides the selection under
 *   an open panel re-places it, once per frame at most, and a side that still
 *   works is kept until a better one has room to spare.
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
  size,
  live = false,
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

  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);
  /**
   * Where an anchored panel stands, as an offset from its trigger's box. It
   * stays a child of the rail (so focus, Escape and outside presses work as
   * they always have) and moves by `translate`, which leaves its layout, and
   * so the width it wraps to, exactly what it would be hanging off the button.
   */
  const [at, setAt] = useState<{ dx: number; dy: number; side: PopoverSide } | null>(null);
  /**
   * The side it is on and the size it was placed at, for the placement's
   * hysteresis. Only a panel of the same size holds its side: hysteresis is
   * for the board moving under it, and a panel that has just grown (the live
   * grid replacing its placeholder) is placed afresh.
   */
  const last = useRef<{ side: PopoverSide; w: number; h: number } | null>(null);
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

    // Only a popover on the rail knows a selection; anywhere else it hangs off its button.
    const railEl = triggerEl.closest<HTMLElement>('.ctx-toolbar');
    const from = railEl ? railSubject() : null;
    const margin = 8;
    const width = panel.offsetWidth;
    const held = last.current && last.current.w === width && last.current.h === natural ? last.current.side : undefined;
    const next = placeRailPopover({
      rail: toRect(railEl?.getBoundingClientRect() ?? rect),
      railSide: from?.side ?? placement,
      prefer: placement,
      trigger: toRect(rect),
      align,
      panel: { width, height: natural },
      subject: from?.subject ?? null,
      bounds: from?.room ?? {
        top: margin,
        left: margin,
        right: window.innerWidth - margin,
        bottom: window.innerHeight - margin,
      },
      obstacles: from?.obstacles,
      halo: live ? LIVE_HALO : POPOVER_HALO,
      previous: held,
    });
    last.current = { side: next.side, w: width, h: natural };
    const dx = Math.round(next.x - rect.left);
    const dy = Math.round(next.y - rect.top);
    setAt((current) =>
      current && current.dx === dx && current.dy === dy && current.side === next.side ? current : { dx, dy, side: next.side }
    );
    setMaxHeight(next.maxHeight);
  }, [float, placement, align, live]);

  // Place on open, and again whenever the panel changes size.
  useLayoutEffect(() => {
    if (!open) return;
    place();
    const panel = panelRef.current;
    if (!panel || typeof ResizeObserver === 'undefined') return;
    // At once, not on the next frame: the observer runs after layout and before
    // paint, so a panel whose contents arrive just after it opens (the live
    // grid replacing its placeholder) is never drawn where the smaller one went.
    const observer = new ResizeObserver(() => place());
    // The content, not the panel: a panel clamped to a max height does not
    // change size when what is inside it grows.
    Array.from(panel.children).forEach((child) => observer.observe(child));
    observer.observe(panel);
    return () => observer.disconnect();
  }, [open, place]);

  // Follow the board: a floating panel is fixed to the window, and an anchored
  // one rides the rail but must step aside if a pan or zoom slides the
  // selection under it. The rail re-places itself on the same events and
  // subscribed first, so its frame runs first and this one reads where it went.
  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const follow = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        place();
      });
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
  }, [open, place]);

  // Hand the keyboard in once the panel is where it will stay.
  useEffect(() => {
    if (!open || !focusOnOpen.current) return;
    if (float && !spot) return;
    focusOnOpen.current = false;
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true });
  }, [open, float, spot]);

  useEffect(() => {
    if (!open) {
      setAt(null);
      last.current = null;
      setSpot(null);
      setMaxHeight(undefined);
      setSwitched(false);
    }
  }, [open, placement]);

  // A floating panel is not inside the trigger's subtree, so "outside the
  // trigger" is no longer the same question as "outside the popover": both are
  // surfaces. The trigger toggles, so a press on it is left to its click; a
  // picker or menu opened from inside the panel is a floating child.
  useOutsidePress({ open, surfaces: [ref, panelRef], triggers: triggerRef, onOutside: () => setOpen(false) });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      // Safari does not focus a button on click, so focus left on the body
      // after clicking the trigger still belongs back on it.
      const active = document.activeElement;
      const hadFocus =
        !active || active === document.body || panelRef.current?.contains(active) || triggerRef.current === active;
      setOpen(false);
      if (hadFocus) triggerRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
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
      data-side={float ? spot?.side ?? placement : at?.side ?? placement}
      data-float={float || undefined}
      data-size={size}
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
          : at
            ? ({ left: 0, top: 0, maxHeight, translate: `${at.dx}px ${at.dy}px` } as React.CSSProperties)
            : ({
                // Before the first measure, which happens before paint: hung
                // off the rail's edge (4px of its padding, 6px of air).
                [placement === 'bottom' ? 'top' : 'bottom']: 'calc(100% + 10px)',
                ...(align === 'center'
                  ? { left: '50%', translate: '-50% 0' }
                  : align === 'end'
                    ? { right: 0 }
                    : { left: 0 }),
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

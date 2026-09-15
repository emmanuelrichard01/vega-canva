import React from 'react';
import { createPortal } from 'react-dom';
import { PORTAL_SURFACE_ATTR } from '../ui/portalSurface';

/**
 * A wide surface, opened from a button in the properties panel.
 *
 * ## Why a popover, having just taken two of these out of disclosures
 *
 * The objection to the `<details>` was never that the content was not on
 * screen. It was that a closed disclosure sitting in a list of rows reads as
 * fine print — it promises nothing, so the people who most need a chooser
 * never open it. A labelled button with a count on it is a different thing
 * entirely, and it is what every tool with a component browser uses.
 *
 * What a popover buys that neither an inline strip nor a disclosure can: it
 * **escapes the panel**. The properties column is about 260px wide, which
 * fits two example cards or a single cramped column of function names. The
 * same content at 440px is a three-up grid with room for a search field and
 * group headings. The constraint was doing the design harm, and no amount of
 * arranging inside 260px was going to fix that.
 *
 * ## Portalled, and marked as ours
 *
 * The panel is `overflow-y: auto`, so anything that needs to be wider than it
 * has to leave it — which means `position: fixed` through a portal, and which
 * means every outside-click handler above it stops recognising its own UI.
 * `PORTAL_SURFACE_ATTR` is the shared answer to that, and its own file
 * documents the bug it was written for. This carries the marker for the same
 * reason.
 *
 * ## One trigger vocabulary, two shapes
 *
 * Most triggers are the small labelled chip on a section heading. The chart
 * type is the exception — the whole type card is the trigger — so the class
 * is overridable rather than a second popover being written for one caller.
 */

interface Props {
  /** On the button. A count belongs here — "Examples · 24" promises something. */
  label: React.ReactNode;
  /** Names the surface for assistive tech, since the label may be a fragment. */
  title: string;
  width: number;
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
  icon?: React.ReactNode;
  /** Replaces the chip styling, for a trigger that is a whole card. */
  triggerClassName?: string;
  /** The trigger's accessible name, when its visible label is not one. */
  triggerLabel?: string;
  /** A one-line hint on the trigger, through the app's tooltip layer. */
  tooltip?: string;
  /**
   * Which trigger edge the surface lines up with.
   *
   * `end` (the default) suits a chip at the right of a heading: the panel is
   * pinned to the window's right edge, so a surface that grows leftward stays
   * on screen. A full-width trigger reads better with its left edges aligned.
   */
  align?: 'start' | 'end';
}

export const PanelPopover: React.FC<Props> = ({
  label,
  title,
  width,
  children,
  icon,
  triggerClassName = 'pnpop__trigger',
  triggerLabel,
  tooltip,
  align = 'end',
}) => {
  const [open, setOpen] = React.useState(false);
  const [at, setAt] = React.useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const surfaceRef = React.useRef<HTMLDivElement>(null);

  /**
   * Placed below the trigger, flipped above when it would overflow, then
   * clamped — the same three steps the colour picker settled on, for the same
   * reason: the panel is pinned to one edge of the window, so a surface wider
   * than it will always want to run off that edge.
   *
   * The width is clamped too, so a narrow window gets a narrower surface
   * rather than one whose far edge is off screen. Re-run on scroll *and* on
   * capture, because the panel scrolls inside itself and a `fixed` surface
   * does not move with it.
   */
  React.useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      if (!trigger) return;
      const margin = 8;
      const w = Math.min(width, window.innerWidth - margin * 2);
      const height = surfaceRef.current?.offsetHeight ?? 380;

      let top = trigger.bottom + 6;
      if (top + height > window.innerHeight - margin) top = trigger.top - height - 6;
      top = Math.min(top, Math.max(margin, window.innerHeight - height - margin));
      top = Math.max(margin, top);

      let left = align === 'start' ? trigger.left : trigger.right - w;
      left = Math.min(left, window.innerWidth - w - margin);
      left = Math.max(margin, left);

      setAt({ top, left, width: w });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, width, align]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (surfaceRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Stopped, so the canvas does not also read this as "deselect" and take
      // the chart away underneath the surface that was just closed.
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const close = React.useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        data-open={open || undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={triggerLabel}
        data-tooltip={open ? undefined : tooltip}
        onClick={() => setOpen((v) => !v)}
      >
        {icon}
        {label}
      </button>

      {open &&
        createPortal(
          <div
            ref={surfaceRef}
            className="pnpop"
            role="dialog"
            aria-label={title}
            // Measured once off screen, then placed: a first paint at 0,0
            // flashed the surface in the corner of the window for a frame.
            style={
              at
                ? { top: at.top, left: at.left, width: at.width }
                : { top: -9999, left: -9999, width, visibility: 'hidden' }
            }
            {...{ [PORTAL_SURFACE_ATTR]: 'panel-popover' }}
          >
            {typeof children === 'function' ? children(close) : children}
          </div>,
          document.body
        )}
    </>
  );
};

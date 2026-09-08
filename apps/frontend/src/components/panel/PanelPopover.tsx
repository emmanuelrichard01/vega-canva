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
 */

interface Props {
  /** On the button. A count belongs here — "Examples · 24" promises something. */
  label: React.ReactNode;
  /** Names the surface for assistive tech, since the label may be a fragment. */
  title: string;
  width: number;
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
  /** Marks the trigger as the active one while the surface is open. */
  icon?: React.ReactNode;
}

export const PanelPopover: React.FC<Props> = ({ label, title, width, children, icon }) => {
  const [open, setOpen] = React.useState(false);
  const [at, setAt] = React.useState<{ top: number; left: number } | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const surfaceRef = React.useRef<HTMLDivElement>(null);

  /**
   * Placed below the trigger, flipped above when it would overflow, then
   * clamped — the same three steps the colour picker settled on, for the same
   * reason: the panel is pinned to one edge of the window, so a surface wider
   * than it will always want to run off that edge.
   *
   * Re-run on scroll *and* on capture, because the panel scrolls inside itself
   * and a `fixed` surface does not move with it.
   */
  React.useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      if (!trigger) return;
      const height = surfaceRef.current?.offsetHeight ?? 380;
      const margin = 8;

      let top = trigger.bottom + margin;
      if (top + height > window.innerHeight - margin) top = trigger.top - height - margin;
      top = Math.min(top, Math.max(margin, window.innerHeight - height - margin));
      top = Math.max(margin, top);

      // Right-aligned to the trigger rather than centred: the panel is on the
      // right-hand edge, so a centred surface is half off-screen before the
      // clamp has anything to say about it.
      let left = trigger.right - width;
      left = Math.min(left, window.innerWidth - width - margin);
      left = Math.max(margin, left);

      setAt({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, width]);

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

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="pnpop__trigger"
        data-open={open || undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        {icon}
        {label}
      </button>

      {open &&
        at &&
        createPortal(
          <div
            ref={surfaceRef}
            className="pnpop"
            role="dialog"
            aria-label={title}
            style={{ top: at.top, left: at.left, width }}
            {...{ [PORTAL_SURFACE_ATTR]: 'panel-popover' }}
          >
            {typeof children === 'function' ? children(() => setOpen(false)) : children}
          </div>,
          document.body
        )}
    </>
  );
};

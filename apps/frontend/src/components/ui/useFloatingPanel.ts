import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { placeFloating, type Box, type FloatPlacement, type FloatSide } from '../../engine/interaction/floatingPlacement';
import { railSubject } from '../toolbar/railSubject';
import { engineEvents } from '../../engine/EventBus';
import { isInsidePortalSurface } from './portalSurface';

/**
 * A panel that floats beside the control that opened it, and keeps itself placed.
 *
 * Shared by the colour picker and the fill editor, which used to position
 * themselves two different ways — one fixed to the window and clamped, one
 * absolutely positioned inside whatever container it happened to be in, which
 * in the Properties panel meant inside a scrolling column that clipped it.
 *
 * ## Which side
 *
 * Decided by where the trigger is, because that says what the panel must not
 * cover:
 *
 * - **On the contextual rail**, keep clear of the selection the rail belongs to
 *   — the colour is being chosen to be seen *on* that object.
 * - **In a side panel**, open beside the panel, toward the board, rather than
 *   over the rows that are adjusted next.
 * - **Anywhere else**, below, then above.
 *
 * ## Keeping placed
 *
 * Re-placed when the panel changes size (a gradient gaining a stop row, a tab
 * with more swatches), when the window resizes or scrolls, and when the board
 * moves under a rail-anchored panel.
 *
 * ## Closing
 *
 * Outside presses close it, except presses inside another portalled surface
 * (a nested picker). Escape is caught on the **window** in the capture phase,
 * which runs before the document-level listeners the rail's popovers use — so
 * Escape closes the innermost panel first, instead of the rail popover behind
 * it tearing the picker down with it.
 */
export function useFloatingPanel({
  open,
  trigger,
  panel,
  onClose,
}: {
  open: boolean;
  trigger: HTMLElement | null;
  panel: HTMLElement | null;
  onClose: (reason: 'outside' | 'escape') => void;
}) {
  const [spot, setSpot] = useState<FloatPlacement | null>(null);

  const place = useCallback(() => {
    if (!trigger || !panel) return;
    const t = trigger.getBoundingClientRect();
    const onRail = Boolean(trigger.closest('.ctx-toolbar, .ctx-popover'));
    const inPanel = trigger.closest('.context-inspector, .hierarchy-panel');

    let prefer: FloatSide[] = ['bottom', 'top', 'right', 'left'];
    let avoid: Box | null = null;
    if (onRail) {
      const s = railSubject();
      if (s) {
        avoid = { left: s.subject.x, top: s.subject.y, right: s.subject.x + s.subject.width, bottom: s.subject.y + s.subject.height };
        // Away from the object first: if the rail is above it, go up.
        prefer = t.bottom <= avoid.top ? ['top', 'right', 'left', 'bottom'] : ['bottom', 'right', 'left', 'top'];
      }
    } else if (inPanel) {
      prefer = inPanel.classList.contains('context-inspector')
        ? ['left', 'bottom', 'top']
        : ['right', 'bottom', 'top'];
    }

    const next = placeFloating(
      t,
      // The natural height, so a panel squeezed once can be given its room back.
      { width: panel.offsetWidth, height: panel.scrollHeight },
      { width: window.innerWidth, height: window.innerHeight, margin: 8 },
      { prefer, avoid }
    );
    setSpot((current) =>
      current &&
      current.x === next.x &&
      current.y === next.y &&
      current.side === next.side &&
      current.maxHeight === next.maxHeight
        ? current
        : next
    );
  }, [trigger, panel]);

  useLayoutEffect(() => {
    if (!open) {
      setSpot(null);
      return;
    }
    place();
    if (!panel) return;
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(later) : null;
    observer?.observe(panel);
    Array.from(panel.children).forEach((child) => observer?.observe(child));
    window.addEventListener('resize', later);
    window.addEventListener('scroll', later, true);
    engineEvents.on('CameraChanged', later);
    engineEvents.on('ObjectMoved', later);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', later);
      window.removeEventListener('scroll', later, true);
      engineEvents.off('CameraChanged', later);
      engineEvents.off('ObjectMoved', later);
    };
  }, [open, panel, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panel?.contains(target) || trigger?.contains(target)) return;
      // A surface portalled from *inside* this panel is still this panel. One
      // portalled from outside it — which is what this panel is to its parent
      // — would also match, so only surfaces that are not this panel count.
      const surface = (target as Element).closest?.('[data-portal-surface]');
      if (surface && surface !== panel && isInsidePortalSurface(target)) {
        if (panel && surface.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_PRECEDING) return;
      }
      onClose('outside');
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      onClose('escape');
      trigger?.focus({ preventScroll: true });
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, panel, trigger, onClose]);

  return spot;
}

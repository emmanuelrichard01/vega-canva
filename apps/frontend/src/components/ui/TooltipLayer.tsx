import React, { useEffect, useRef, useState } from 'react';

/**
 * Every tooltip in the app, drawn once at the document root.
 *
 * ## Why not the pseudo-element
 *
 * Tooltips were `[data-tooltip]::after` — an absolutely positioned pseudo
 * element on the control itself. That works until the control sits inside
 * anything that scrolls, and then it is **clipped**, because an absolutely
 * positioned box is confined by its nearest clipping ancestor. Both side
 * panels scroll, so every tooltip in the Layers and Properties panels was cut
 * off at the panel edge.
 *
 * No z-index fixes this. `z-index` orders things within a stacking context; it
 * has no bearing on `overflow` clipping, and raising it on a clipped element
 * simply produces a clipped element that is on top. The only ways out are to
 * stop the ancestor clipping — which would break the panels' scrolling — or to
 * take the tooltip out of that subtree entirely.
 *
 * So this renders one `position: fixed` node at the root and moves it to
 * whichever control is hovered. Fixed positioning is resolved against the
 * viewport, which no ancestor's `overflow` can cut into.
 *
 * ## Why it reads the same attribute
 *
 * Every control in the app already carries `data-tooltip`, and several carry
 * `data-tooltip-pos`. Rewriting them into a component would have been hundreds
 * of call-site edits for no behavioural gain, and would have meant two tooltip
 * systems during the transition. This adopts them exactly as they are.
 *
 * ## Focus, not just hover
 *
 * Bound to `focusin` as well, so a keyboard user gets the same explanation a
 * mouse user does. The pseudo-element version was hover-only.
 */

/** How long the pointer must rest before a tip appears. */
const OPEN_DELAY = 380;
/** Gap between the control and the tip. */
const OFFSET = 8;
/** Keep-away margin from the viewport edge. */
const EDGE = 8;

type Side = 'top' | 'bottom' | 'left' | 'right';

interface Tip {
  text: string;
  x: number;
  y: number;
  side: Side;
}

export const TooltipLayer: React.FC = () => {
  const [tip, setTip] = useState<Tip | null>(null);
  const timerRef = useRef<number | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const clear = () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      setTip(null);
    };

    const show = (el: HTMLElement) => {
      const text = el.getAttribute('data-tooltip');
      if (!text) return;

      const rect = el.getBoundingClientRect();
      // Zero-sized means the control is not laid out — a collapsed panel, or a
      // node mid-unmount. Anchoring to it would put the tip in the corner.
      if (rect.width === 0 && rect.height === 0) return;

      const requested = (el.getAttribute('data-tooltip-pos') as Side) || 'top';
      setTip({
        text,
        side: requested,
        x: requested === 'left' ? rect.left : requested === 'right' ? rect.right : rect.left + rect.width / 2,
        y: requested === 'bottom' ? rect.bottom : requested === 'top' ? rect.top : rect.top + rect.height / 2,
      });
    };

    const onOver = (e: Event) => {
      const target = (e.target as HTMLElement)?.closest?.('[data-tooltip]') as HTMLElement | null;
      if (!target) return;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => show(target), OPEN_DELAY);
    };

    const onOut = (e: Event) => {
      const target = (e.target as HTMLElement)?.closest?.('[data-tooltip]');
      if (!target) return;
      clear();
    };

    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onOut);
    document.addEventListener('focusin', onOver);
    document.addEventListener('focusout', onOut);
    // A tip anchored to a control that has just scrolled away would hang in
    // empty space; the same goes for a press, which usually changes something.
    window.addEventListener('scroll', clear, true);
    document.addEventListener('pointerdown', clear, true);
    window.addEventListener('blur', clear);

    return () => {
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onOut);
      document.removeEventListener('focusin', onOver);
      document.removeEventListener('focusout', onOut);
      window.removeEventListener('scroll', clear, true);
      document.removeEventListener('pointerdown', clear, true);
      window.removeEventListener('blur', clear);
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  /**
   * Nudge back inside the viewport once the real size is known.
   *
   * Measured after paint rather than estimated from the string length: these
   * hold anything from "Select" to a sentence explaining why a control is
   * disabled, and a guess would be wrong for one of those.
   */
  useEffect(() => {
    const el = tipRef.current;
    if (!el || !tip) return;
    const rect = el.getBoundingClientRect();
    let dx = 0;
    if (rect.left < EDGE) dx = EDGE - rect.left;
    else if (rect.right > window.innerWidth - EDGE) dx = window.innerWidth - EDGE - rect.right;

    // A tip that would sit above the top of the window flips below its
    // control, which is the same thing every menu does when it runs out of room.
    const flip = tip.side === 'top' && rect.top < EDGE;
    /**
     * Written unconditionally, including when there is nothing to correct.
     *
     * This used to run only when a nudge was needed, which leaves the previous
     * tip's correction in place: React writes `style.transform` from the prop,
     * and when two tips in a row resolve to the same base string it sees no
     * change and skips the write — so the imperative `translateX` from the last
     * one survived onto a tip that did not need it. The result was a tooltip
     * near the panel's edge sitting somewhere it had never been positioned,
     * usually half off screen.
     */
    el.style.transform = `${transformFor(flip ? 'bottom' : tip.side)} translateX(${dx}px)`;
  }, [tip]);

  if (!tip) return null;

  return (
    <div
      ref={tipRef}
      className="tip"
      role="tooltip"
      style={{
        left: tip.x,
        top: tip.y,
        transform: transformFor(tip.side),
      }}
    >
      {tip.text}
    </div>
  );
};

/**
 * Placement expressed as a transform on a point.
 *
 * The element is anchored at the control's edge and then moved by its own
 * size, so the tip never needs to know how wide it is — which is what lets it
 * be positioned before it has been measured.
 */
function transformFor(side: Side): string {
  switch (side) {
    case 'bottom':
      return `translate(-50%, ${OFFSET}px)`;
    case 'left':
      return `translate(calc(-100% - ${OFFSET}px), -50%)`;
    case 'right':
      return `translate(${OFFSET}px, -50%)`;
    case 'top':
    default:
      return `translate(-50%, calc(-100% - ${OFFSET}px))`;
  }
}

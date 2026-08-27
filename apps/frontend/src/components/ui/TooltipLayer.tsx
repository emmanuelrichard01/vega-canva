import React, { useEffect, useRef, useState } from 'react';
import { splitShortcut } from './tooltipShortcut';

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

/** How long the pointer must rest before a tip appears, from cold. */
const OPEN_DELAY = 380;
/**
 * How long after a tip closes that the next one opens immediately.
 *
 * Without this, every control in a toolbar costs the full delay again, so
 * running along a row of eight buttons means waiting eight times to read eight
 * labels — which is precisely the moment someone is scanning a toolbar because
 * they do not yet know what the icons mean. Once the first tip has been earned,
 * the group is warm and the rest follow the pointer. Going quiet for longer
 * than this means the next tip is deliberate again and pays the full wait.
 *
 * This is the behaviour every desktop toolbar has had for thirty years, and
 * its absence is most of why tooltips here felt sluggish.
 */
const WARM_WINDOW = 900;
/** Gap between the control and the tip. */
const OFFSET = 8;
/** Keep-away margin from the viewport edge. */
const EDGE = 8;

type Side = 'top' | 'bottom' | 'left' | 'right';

interface Tip {
  text: string;
  /** A trailing accelerator, lifted out of the label and set as a key. */
  shortcut?: string;
  /**
   * The second line: what the tool does, when its name does not say.
   *
   * Read from `data-tooltip-desc` rather than parsed out of the label, because
   * the two are different kinds of thing and joining them into one string is
   * what produced "Direct select. anchors and handles (A)" — a name, a
   * sentence fragment and an accelerator run together with a full stop doing
   * the work of a line break.
   */
  desc?: string;
  x: number;
  y: number;
  side: Side;
  /** The control this tip belongs to, kept so the tip can check it is still wanted. */
  anchor: HTMLElement;
}


export const TooltipLayer: React.FC = () => {
  const [tip, setTip] = useState<Tip | null>(null);
  const timerRef = useRef<number | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  /** When the last tip closed, for the warm-window rule above. */
  const lastClosedRef = useRef(0);
  /** Whether a tip is currently up, tracked outside state so listeners see it. */
  const openRef = useRef(false);

  useEffect(() => {
    const clear = () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      if (openRef.current) {
        lastClosedRef.current = Date.now();
        openRef.current = false;
      }
      setTip(null);
    };

    const show = (el: HTMLElement) => {
      const raw = el.getAttribute('data-tooltip');
      if (!raw) return;

      const rect = el.getBoundingClientRect();
      // Zero-sized means the control is not laid out — a collapsed panel, or a
      // node mid-unmount. Anchoring to it would put the tip in the corner.
      if (rect.width === 0 && rect.height === 0) return;

      const requested = (el.getAttribute('data-tooltip-pos') as Side) || 'top';
      const { text, shortcut } = splitShortcut(raw);
      openRef.current = true;
      setTip({
        text,
        shortcut,
        desc: el.getAttribute('data-tooltip-desc') || undefined,
        side: requested,
        anchor: el,
        x: requested === 'left' ? rect.left : requested === 'right' ? rect.right : rect.left + rect.width / 2,
        y: requested === 'bottom' ? rect.bottom : requested === 'top' ? rect.top : rect.top + rect.height / 2,
      });
    };

    const onOver = (e: Event) => {
      const target = (e.target as HTMLElement)?.closest?.('[data-tooltip]') as HTMLElement | null;
      if (!target) return;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      /**
       * A control that opens a menu never takes the instant path.
       *
       * Those controls revoke their own tooltip by dropping `data-tooltip`
       * when their flyout opens, and that revocation is a React re-render —
       * which cannot beat a synchronous `show()` in the same event. Hovering a
       * dock button while the layer was warm therefore painted the tip
       * *directly on top of* the flyout it belongs to, in the same space above
       * the same button. Measured: tip at 192,551 over a flyout at 128,471.
       *
       * Waiting the full delay gives the menu time to open and the attribute
       * time to go, after which `show` reads no tooltip and does nothing. The
       * flyout is a better label than the tip was.
       */
      const opensMenu = target.getAttribute('aria-haspopup') === 'menu';
      // Warm: a tip is up, or one has just come down. Follow the pointer with
      // no wait, so scanning a toolbar reads as one continuous gesture.
      const warm = openRef.current || Date.now() - lastClosedRef.current < WARM_WINDOW;
      if (warm && !opensMenu) {
        show(target);
        return;
      }
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

    /**
     * One frame later, check the tip is still wanted.
     *
     * Several controls revoke their tooltip by dropping `data-tooltip` when
     * something better takes over the same space — the dock's buttons do it the
     * moment their flyout opens. That revocation is a React re-render, and a
     * re-render cannot beat a `show()` that ran synchronously in the same
     * event: the tip was already on screen, and nothing looked at the attribute
     * again.
     *
     * Asking the anchor rather than trusting the sender is the difference
     * between a tip that can be taken down and one that merely should have
     * been. It is the same reasoning as `railVeil.settle` — the state has to be
     * falsifiable from outside, because the component that would have revoked
     * it may already have unmounted.
     *
     * One frame is enough: React has committed by then. This is a single
     * scheduled check, not a loop, so a tip that stays wanted costs nothing
     * after it.
     */
    const stillWanted = () => tip.anchor.isConnected && !!tip.anchor.getAttribute('data-tooltip');
    const raf = requestAnimationFrame(() => { if (!stillWanted()) setTip(null); });

    /**
     * And keep asking, for as long as this tip is up.
     *
     * The single frame above closes the synchronous race, but not the case
     * where the tooltip is revoked *later* than that — a flyout opened from the
     * keyboard, a control that becomes disabled, a menu pinned by a click that
     * arrives while the tip is already on screen. In all of those the tip is
     * showing, its anchor has withdrawn it, and nothing was watching.
     *
     * An observer rather than a frame loop: this fires exactly when the
     * attribute changes and costs nothing while it does not, and it unhooks
     * with the tip. Polling would have to run at 60Hz for the whole time a
     * tooltip is visible to catch an event the DOM will simply tell us about.
     */
    const observer = new MutationObserver(() => { if (!stillWanted()) setTip(null); });
    observer.observe(tip.anchor, { attributes: true, attributeFilter: ['data-tooltip'] });

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [tip]);

  if (!tip) return null;

  return (
    <div
      ref={tipRef}
      className="tip"
      role="tooltip"
      /* Drives the entrance direction. Keyed on the *requested* side rather
         than the flipped one, because the animation is re-run by the class
         change and re-running it after the flip would replay the tip. */
      data-side={tip.side}
      style={{
        left: tip.x,
        top: tip.y,
        transform: transformFor(tip.side),
      }}
    >
      <span className="tip__head">
        <span className="tip__text">{tip.text}</span>
        {tip.shortcut && <kbd className="tip__key">{tip.shortcut}</kbd>}
      </span>
      {tip.desc && <span className="tip__desc">{tip.desc}</span>}
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

import React, { useEffect, useRef, useState } from 'react';
import { keycaps, splitShortcut } from './tooltipShortcut';
import { IS_MAC } from '../menu/shortcuts';
import { tooltips } from '../../engine/ui/tooltipManager';

const anchorIds = new WeakMap<Element, string>();
let anchorSeq = 0;
/** A stable key for an anchor, so a suppression can name it. Prefers the element's own id. */
export const anchorKey = (el: Element): string => {
  if (el.id) return el.id;
  let id = anchorIds.get(el);
  if (!id) anchorIds.set(el, (id = `tip-anchor-${(anchorSeq += 1)}`));
  return id;
};

const openSurfaces = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>(SURFACES)).filter((el) => el.getClientRects().length > 0);

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

/**
 * Delay, warm window and suppression are the tooltip manager's rules
 * (`engine/ui/tooltipManager`); this component draws what it allows.
 */
/** How long a touch must be held to read a label. */
const LONG_PRESS = 450;
/** Open surfaces a tip must never cover, and which silence tips while up. */
const SURFACES = '[role="menu"], .popover, [data-tooltip-surface]';
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

  useEffect(() => {
    const clear = () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      tooltips.hidden();
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
      tooltips.shown(anchorKey(el));
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

    /**
     * Whether this anchor may be tipped at all right now.
     *
     * An anchor that is open (`aria-expanded`) is never tipped: its flyout is
     * the better label. And while any menu or popover is open no tip shows,
     * because a tip over an open surface is the clash this prevents.
     */
    const allowed = (el: HTMLElement) =>
      el.getAttribute('aria-expanded') !== 'true' && openSurfaces().length === 0;

    const request = (target: HTMLElement, via: 'pointer' | 'focus' | 'longpress') => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      if (!allowed(target)) return;
      const decision = tooltips.decide(anchorKey(target), via);
      if (decision.action === 'blocked') return;
      // A control that opens a menu always waits a beat, so the menu's own
      // open can revoke the tip before it paints.
      if (decision.action === 'show' && !(via === 'pointer' && target.getAttribute('aria-haspopup') === 'menu')) {
        show(target);
        return;
      }
      const ms = decision.action === 'wait' ? decision.ms : 120;
      timerRef.current = window.setTimeout(() => {
        if (allowed(target) && !tooltips.isSuppressed(anchorKey(target))) show(target);
      }, ms);
    };

    const onOver = (e: Event) => {
      // Touch has no hover; its label comes from a long-press.
      if ((e as PointerEvent).pointerType === 'touch') return;
      const target = (e.target as HTMLElement)?.closest?.('[data-tooltip]') as HTMLElement | null;
      if (target) request(target, 'pointer');
    };

    // Keyboard focus is deliberate: immediate, and only for keyboard focus.
    const onFocus = (e: Event) => {
      const target = (e.target as HTMLElement)?.closest?.('[data-tooltip]') as HTMLElement | null;
      if (!target) return;
      let visible = true;
      try { visible = target.matches(':focus-visible'); } catch { /* older engines: allow */ }
      if (visible) request(target, 'focus');
    };

    let pressTimer: number | null = null;
    const cancelPress = () => {
      if (pressTimer) window.clearTimeout(pressTimer);
      pressTimer = null;
    };
    const onTouchDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      const target = (e.target as HTMLElement)?.closest?.('[data-tooltip]') as HTMLElement | null;
      cancelPress();
      if (target) pressTimer = window.setTimeout(() => request(target, 'longpress'), LONG_PRESS);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clear();
    };
    const stopListening = tooltips.onSuppress(() => clear());
    // A menu or popover mounting hides whatever tip is up.
    const surfaceWatch = new MutationObserver(() => {
      if (tooltips.open && openSurfaces().length > 0) clear();
    });
    surfaceWatch.observe(document.body, { childList: true });

    const onOut = (e: Event) => {
      const target = (e.target as HTMLElement)?.closest?.('[data-tooltip]');
      if (!target) return;
      clear();
    };

    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onOut);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('pointerdown', onTouchDown, true);
    document.addEventListener('pointerup', cancelPress, true);
    document.addEventListener('pointercancel', cancelPress, true);
    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusout', onOut);
    // A tip anchored to a control that has just scrolled away would hang in
    // empty space; the same goes for a press, which usually changes something.
    window.addEventListener('scroll', clear, true);
    document.addEventListener('pointerdown', clear, true);
    window.addEventListener('blur', clear);

    return () => {
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onOut);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('pointerdown', onTouchDown, true);
      document.removeEventListener('pointerup', cancelPress, true);
      document.removeEventListener('pointercancel', cancelPress, true);
      window.removeEventListener('keydown', onKeyDown, true);
      stopListening();
      surfaceWatch.disconnect();
      cancelPress();
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
    const hitsSurface = openSurfaces().some((surface) => {
      const r = surface.getBoundingClientRect();
      return rect.left < r.right && rect.right > r.left && rect.top < r.bottom && rect.bottom > r.top;
    });
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
    const opposite: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
    const placed = flip ? 'bottom' : hitsSurface ? opposite[tip.side] : tip.side;
    el.style.transform = `${transformFor(placed)} translateX(${dx}px)`;

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
        {tip.shortcut && (
          <span className="tip__keys">
            {keycaps(tip.shortcut, IS_MAC).map((k, i) => (
              <kbd key={i} className="tip__key">{k}</kbd>
            ))}
          </span>
        )}
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

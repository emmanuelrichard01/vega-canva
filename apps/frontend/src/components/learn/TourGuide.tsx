import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { tourState } from '../../engine/learn/tourState';
import {
  nextVisibleStep,
  placeCard,
  resolveAnchor,
  stepAllowed,
  stepBody,
  stepsFor,
  TOUR,
  type Box,
  type Placement,
  type TourStep,
} from '../../engine/learn/tour';
import { outlinePath } from '../../engine/learn/tourSketch';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { OnboardingLayer } from '../onboarding/OnboardingLayer';
import '../onboarding/onboarding.css';

/**
 * The tour: one card that travels, a spotlight cut to the element's own shape,
 * and a pen line drawn round that shape.
 *
 * - **One card, moving.** The eye is carried to the next thing rather than
 *   sent looking for it. The spotlight shares its duration and curve.
 * - **Accurate cut-out.** The hole is the element's box plus a halo, with the
 *   element's own corner radius grown by the same halo, so a pill gets a pill
 *   and a panel gets its 12px corner.
 * - **Never blocks.** The scrim takes no pointer events; only the card does.
 *   Collaboration, the board and every control stay live underneath.
 * - **Keyboard.** Arrows move, Home and End jump, Escape puts it away and the
 *   next start resumes there. Keys typed into a field are left alone.
 * - **Focus.** The card takes focus when the tour starts and gives it back to
 *   whatever had it when the tour ends. Each step is announced.
 * - **Roles.** Viewers and commenters walk their own subset with their own
 *   words (`tour.ts`). A step whose element is not on screen is passed over.
 */

/** The card's width. Fixed, so moving it is a translate and never a reflow. */
const CARD_W = 320;
/** A first guess at the height, replaced by the measured one after a frame. */
const CARD_H = 172;
/** How far the cut-out reaches outside the element. */
const HALO = 6;

const isEditable = (el: Element | null) =>
  !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable);

interface Probe {
  el: HTMLElement;
  box(): Box;
}

const queryProbes = (selector: string): Probe[] =>
  Array.from(document.querySelectorAll<HTMLElement>(selector)).map((el) => ({
    el,
    box: () => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    },
  }));

/** The element's own corner radius in pixels, capped to half its short side. */
function cornerOf(el: HTMLElement, box: Box): number {
  const raw = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
  return Math.min(raw, Math.min(box.width, box.height) / 2);
}

export const TourGuide: React.FC = () => {
  const { step } = useSyncExternalStore(tourState.subscribe, tourState.getSnapshot, tourState.getSnapshot);
  const { role } = useRoomPermissions();

  const [anchor, setAnchor] = useState<{ box: Box; radius: number } | null>(null);
  const [place, setPlace] = useState<Placement | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  /** Which way the reader was going, so a missing step is passed in that direction. */
  const heading = useRef<1 | -1>(1);
  const returnFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const bodyId = useId();

  const present = useCallback(
    (s: TourStep) => stepAllowed(s, role) && resolveAnchor(s, queryProbes) !== null,
    [role]
  );

  const measure = useCallback(() => {
    if (step === null) return;
    const current = TOUR[step];
    const found = stepAllowed(current, role) ? resolveAnchor(current, queryProbes) : null;
    if (!found) {
      setAnchor(null);
      const onward = nextVisibleStep(step + heading.current, heading.current, present);
      if (onward === null) {
        // Nothing left to point at going this way. Going forward that is the
        // end; going back it is the first step that exists, if any does.
        const back = heading.current === -1 ? nextVisibleStep(step, 1, present) : null;
        if (back === null) tourState.stop();
        else tourState.goTo(back);
      } else tourState.goTo(onward);
      return;
    }
    const box = found.box();
    setAnchor((prev) => {
      const radius = cornerOf(found.el, box);
      const same =
        prev &&
        prev.radius === radius &&
        prev.box.x === box.x &&
        prev.box.y === box.y &&
        prev.box.width === box.width &&
        prev.box.height === box.height;
      return same ? prev : { box, radius };
    });
    const h = cardRef.current?.offsetHeight || CARD_H;
    const next = placeCard(box, { width: CARD_W, height: h }, { width: window.innerWidth, height: window.innerHeight }, current.side);
    // Unchanged placements keep their identity, so a mutation elsewhere on the
    // page does not re-render the tour.
    setPlace((prev) => (prev && prev.x === next.x && prev.y === next.y && prev.side === next.side ? prev : next));
  }, [step, role, present]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  /**
   * Follow the screen while it moves: the window resizing, panels opening, the
   * dock reflowing or sliding in. Coalesced to one measure per frame, and only while the tour
   * is running.
   */
  useEffect(() => {
    if (step === null) return;
    let frame = 0;
    const soon = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    window.addEventListener('resize', soon);
    window.addEventListener('scroll', soon, true);
    // Chrome that slides or fades in moves by transform, which neither observer
    // below reports. The end of its motion is when its box is final.
    window.addEventListener('transitionend', soon, true);
    window.addEventListener('animationend', soon, true);
    const resized = new ResizeObserver(soon);
    resized.observe(document.body);
    if (cardRef.current) resized.observe(cardRef.current);
    const mutated = new MutationObserver(soon);
    mutated.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'data-tour'] });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', soon);
      window.removeEventListener('scroll', soon, true);
      window.removeEventListener('transitionend', soon, true);
      window.removeEventListener('animationend', soon, true);
      resized.disconnect();
      mutated.disconnect();
    };
  }, [step, measure]);

  const running = step !== null;

  /** Take focus on start, give it back on the way out. */
  useEffect(() => {
    if (!running) return;
    const active = document.activeElement;
    returnFocus.current = active instanceof HTMLElement && active !== document.body ? active : null;
    return () => {
      const back = returnFocus.current;
      if (back && back.isConnected) back.focus({ preventScroll: true });
    };
  }, [running]);

  const visible = running && !!anchor && !!place;
  useEffect(() => {
    if (visible && !cardRef.current?.contains(document.activeElement)) nextRef.current?.focus({ preventScroll: true });
  }, [visible, step]);

  const order = stepsFor(role);
  const at = step === null ? -1 : order.indexOf(step);

  const go = useCallback((direction: 1 | -1) => {
    heading.current = direction;
    if (direction === 1) tourState.next();
    else tourState.back();
  }, []);

  useEffect(() => {
    if (!running) return;
    const onKey = (e: KeyboardEvent) => {
      const inCard = cardRef.current?.contains(document.activeElement) ?? false;
      if (!inCard && isEditable(document.activeElement)) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        tourState.stop();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        go(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        go(-1);
      } else if ((e.key === 'Home' || e.key === 'End') && inCard && order.length > 0) {
        e.preventDefault();
        heading.current = e.key === 'Home' ? 1 : -1;
        tourState.goTo(e.key === 'Home' ? order[0] : order[order.length - 1]);
      }
    };
    // Capture, so Escape ends the tour rather than clearing the selection under
    // it, and the arrows do not also nudge whatever is selected.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [running, go, order]);

  if (step === null || !anchor || !place) return null;

  const current = TOUR[step];
  const last = at === order.length - 1;
  const { box, radius } = anchor;

  /**
   * Portaled to `<body>`: a header with `backdrop-filter` is a containing block
   * for `position: fixed`, and anything fixed inside it is sized to that strip.
   */
  return createPortal(
    <div className="tour">
      <div
        className="tour__spot"
        aria-hidden="true"
        style={{
          transform: `translate(${box.x - HALO}px, ${box.y - HALO}px)`,
          width: box.width + HALO * 2,
          height: box.height + HALO * 2,
          borderRadius: radius + HALO,
        }}
      />

      {/* Keyed on the step so the ring draws itself on for each one. */}
      <svg className="tour__ink" key={current.id} aria-hidden="true">
        <path className="tour__ring" pathLength={1} d={outlinePath(box, radius, current.id)} />
      </svg>

      <div
        ref={cardRef}
        className="tour__card"
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-side={place.side}
        style={{ transform: `translate(${place.x}px, ${place.y}px)`, width: CARD_W }}
      >
        <span className="sr-only" aria-live="polite">
          {`Step ${at + 1} of ${order.length}: ${current.title}`}
        </span>
        <div className="tour__body" key={current.id}>
          <h2 id={titleId} className="tour__title">
            {current.title}
          </h2>
          <p id={bodyId} className="tour__text">
            {stepBody(current, role)}
          </p>
        </div>

        <div className="tour__foot">
          <div className="tour__dots" role="group" aria-label="Steps">
            {order.map((i, n) => (
              <button
                key={TOUR[i].id}
                type="button"
                aria-current={i === step ? 'step' : undefined}
                aria-label={`Step ${n + 1}: ${TOUR[i].title}`}
                className="tour__dot"
                data-active={i === step || undefined}
                onClick={() => {
                  heading.current = i > step ? 1 : -1;
                  tourState.goTo(i);
                }}
              />
            ))}
          </div>

          <div className="tour__actions">
            {at > 0 && (
              <button type="button" className="tour__back" onClick={() => go(-1)} aria-label="Previous step">
                <ArrowLeft size={14} aria-hidden="true" />
              </button>
            )}
            <button ref={nextRef} type="button" className="tour__next" onClick={() => (last ? tourState.finish() : go(1))}>
              {last ? 'Done' : 'Next'}
              {!last && <ArrowRight size={14} aria-hidden="true" />}
            </button>
          </div>
        </div>

        <button
          type="button"
          className="tour__close"
          onClick={() => tourState.stop()}
          aria-label="Close the tour. Starting it again picks up here"
          data-tooltip="Close"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    </div>,
    document.body
  );
};

/**
 * The first-run layer: the getting-started checklist for editors, the tour's
 * offer for everyone else, and the dashboard's guided start.
 *
 * Exported under its old name so the board's mount line stays as it is.
 */
export const TourOffer: React.FC<{ visible: boolean }> = OnboardingLayer;

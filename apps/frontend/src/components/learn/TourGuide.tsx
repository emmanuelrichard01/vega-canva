import React, { useCallback, useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { tourState } from '../../engine/learn/tourState';
import { nextVisibleStep, placeCard, TOUR, type Box, type Placement } from '../../engine/learn/tour';
import { pointerPath, ringBox, ringPath } from '../../engine/learn/tourSketch';
import { roughEllipse, roughPolyline, seedFrom } from '../../engine/model/rough';

/**
 * The walk round the screen.
 *
 * ## Why one card that travels rather than a popover per step
 *
 * A tour built as "hide this bubble, show that one" gives the eye nothing to
 * follow: something goes out over there, something comes on over here, and the
 * reader has to find the new one every time. Six steps of that is six small
 * searches.
 *
 * One card, moving, is a single continuous event. The eye is carried to the
 * next thing rather than sent looking for it, and the movement itself says the
 * two things are related -- which is exactly what a tour is claiming. The help
 * panel's rail marker makes the same argument at a smaller scale, and it is the
 * same technique: measure, then move one element.
 *
 * The spotlight moves with it, so the pair reads as one object turning its
 * attention. They share a duration and a curve, and changing one means changing
 * the other.
 *
 * ## Why it is drawn by hand
 *
 * A tour is annotation rather than interface, and the register should say so.
 * Everything on this screen is a rectangle with a shadow; a popover with a beak
 * is one more of those, competing with the controls it is pointing at, where a
 * pen mark cannot be mistaken for something to press.
 *
 * It is ours rather than borrowed because the product already draws this way:
 * the ring and the pointer come out of `rough.ts`, the same generator the
 * canvas renders hand-drawn shapes with, at the same profiles. See
 * `tourSketch.ts` for where the hand stops, which is at the pointing.
 *
 * ## Why the spotlight is a box-shadow
 *
 * A hole in a dim field is usually four rectangles round the gap, which cannot
 * have a rounded corner and needs four things kept in step while it moves. One
 * element with an enormous spread shadow is the whole surround in a single
 * node, it takes a border radius, and there is one thing to animate.
 *
 * It is lighter than it was, because the ring is what does the pointing now and
 * the scrim only has to quiet what is around it. It costs layout work per
 * frame, because size cannot be transitioned on the compositor: one element for
 * four hundred milliseconds, six times, on a screen where nothing else is
 * moving.
 *
 * ## Why a missing anchor is skipped rather than pointed at
 *
 * Every anchor here exists in the source -- `tour.test.ts` fails otherwise --
 * but existing in the source is not being on screen. A rail is only rendered
 * while its panel is collapsed, the radar goes when it is opened, and focus
 * mode takes the lot. A spotlight on the top-left corner of an empty screen is
 * worse than one step fewer, so a step whose element is absent is passed over
 * in whichever direction the reader was already going.
 */

/** The card's width. Fixed, so moving it is a translate and never a reflow. */
const CARD_W = 312;
/**
 * A first guess at the height, used for one frame and then replaced.
 *
 * The real one is measured, because the steps are not the same height: two
 * lines of body or three, and a title that wraps on a narrow card. Assuming a
 * constant was the first version and it is wrong in the direction that matters
 * -- a card taller than the guess overlaps the spotlight it is pointing at,
 * which is the one thing the placement exists to avoid.
 */
const CARD_H = 180;

/** How far the spotlight is cut outside the element it is showing. */
const HALO = 8;

const boxOf = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
};

export const TourGuide: React.FC = () => {
  const { step } = useSyncExternalStore(
    tourState.subscribe,
    tourState.getSnapshot,
    tourState.getSnapshot
  );

  const [anchor, setAnchor] = useState<Box | null>(null);
  const [place, setPlace] = useState<Placement | null>(null);
  const cardRef = React.useRef<HTMLDivElement>(null);

  /**
   * Find the current step's element, and pass over the step if it is not there.
   *
   * The direction matters. Somebody pressing Back through a step whose element
   * has gone should keep going back, not be bounced forward past the thing they
   * were trying to return to.
   */
  const [heading, setHeading] = useState<1 | -1>(1);

  const measure = useCallback(() => {
    if (step === null) return;
    const el = document.querySelector(`[data-tour="${TOUR[step].anchor}"]`);
    if (!el) {
      setAnchor(null);
      /**
       * Skip to the next step that is actually on screen — or end the tour if
       * there is none that way. `nextVisibleStep` carries the reasoning and
       * the bug this replaces.
       *
       * The direction of travel is honoured: somebody pressing Back through a
       * step that has gone should keep going back rather than be bounced
       * forward past what they were returning to.
       */
      const onward = nextVisibleStep(step + heading, heading, (a) =>
        Boolean(document.querySelector(`[data-tour="${a}"]`))
      );
      // Nothing left to point at in the direction being travelled. Ending is
      // the honest outcome: a tour with no visible subject has nothing to say,
      // and leaving it running is the invisible-dialog bug.
      if (onward === null) tourState.stop();
      else tourState.goTo(onward);
      return;
    }
    const box = boxOf(el);
    setAnchor(box);
    // Measured after the commit, so this is the height of the step now on
    // screen rather than of the one that just left.
    const height = cardRef.current?.offsetHeight || CARD_H;
    setPlace(
      placeCard(
        box,
        { width: CARD_W, height },
        { width: window.innerWidth, height: window.innerHeight },
        TOUR[step].side
      )
    );
  }, [step, heading]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  /**
   * Follow the screen while it moves.
   *
   * The board pans under the tour, panels open, and the window resizes. A card
   * measured once is a card pointing at where something used to be, which is a
   * more confusing failure than not pointing at all.
   */
  useEffect(() => {
    if (step === null) return;
    const on = () => measure();
    window.addEventListener('resize', on);
    window.addEventListener('scroll', on, true);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('scroll', on, true);
    };
  }, [step, measure]);

  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        tourState.stop();
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        setHeading(1);
        tourState.next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setHeading(-1);
        tourState.back();
      }
    };
    // Capture, so Escape ends the tour rather than clearing the selection
    // underneath it, and so the arrows do not also nudge whatever is selected.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [step]);

  if (step === null || !anchor || !place) return null;

  const current = TOUR[step];
  const last = step === TOUR.length - 1;

  /**
   * The pen stroke from the card to the ring.
   *
   * Aimed at the ring rather than at the element, so it stops at the mark
   * instead of crossing it -- an arrow that lands inside the circle it drew is
   * two annotations arguing about which one is doing the pointing.
   */
  const pointer = pointerPath(
    { x: place.x, y: place.y, width: CARD_W, height: cardRef.current?.offsetHeight || CARD_H },
    ringBox(anchor),
    place.side,
    current.id
  );

  /**
   * Portaled to `<body>`, not rendered where it is mounted.
   *
   * The same trap the profile editor and the comments overlay both document:
   * the header carries a `backdrop-filter`, which makes it a containing block
   * for `position: fixed`, and anything fixed inside it is sized to a 52px
   * strip instead of to the viewport.
   */
  return createPortal(
    <div className="tour" role="dialog" aria-modal="false" aria-label={`Tour, step ${step + 1} of ${TOUR.length}`}>
      {/* The surround, as one shadow. Never takes a click: the point of a tour
          is that the board underneath is still yours. */}
      <div
        className="tour__spot"
        aria-hidden="true"
        style={{
          transform: `translate(${anchor.x - HALO}px, ${anchor.y - HALO}px)`,
          width: anchor.width + HALO * 2,
          height: anchor.height + HALO * 2,
        }}
      />

      {/**
        * The marks. Keyed on the step so each one draws itself on rather than
        * cutting from the last, and drawn over the scrim so the ring reads as
        * being on the glass rather than under it.
        */}
      <svg className="tour__ink" key={current.id} aria-hidden="true">
        {/* `pathLength` normalises each mark to a length of one, so a single
            dash rule draws on a ring, a shaft and a head of very different
            real lengths at the same rate. */}
        <path className="tour__ring" pathLength={1} d={ringPath(anchor, current.id)} />
        {/* Absent when the card had to be clamped against its target, where a
            stroke between two touching things points at nothing. */}
        {pointer && <path className="tour__shaft" pathLength={1} d={pointer.shaft} />}
        {pointer && <path className="tour__head" pathLength={1} d={pointer.head} />}
      </svg>

      <div
        ref={cardRef}
        className="tour__card"
        data-side={place.side}
        style={{ transform: `translate(${place.x}px, ${place.y}px)`, width: CARD_W }}
      >
        {/* Keyed on the step, so the words cross-fade while the card travels.
            The movement is the continuity here, which is what makes a fade the
            right thing inside it. */}
        <div className="tour__body" key={current.id}>
          {/* No "3 of 6" above the title. The dots below already say where you
              are, and they can also be pressed, so a second readout was the
              same fact twice with the mute half on top -- and it pushed the
              handwritten title, which is the voice, into second place. The
              count survives where it is genuinely needed, in the dialog's
              accessible name. */}
          <h2 className="tour__title">{current.title}</h2>
          <p className="tour__text">{current.body}</p>
        </div>

        <div className="tour__foot">
          <div className="tour__dots" role="tablist" aria-label="Steps">
            {TOUR.map((s, i) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={i === step}
                aria-label={s.title}
                className={`tour__dot${i === step ? ' is-active' : ''}`}
                onClick={() => {
                  setHeading(i > step ? 1 : -1);
                  tourState.goTo(i);
                }}
              />
            ))}
          </div>

          <div className="tour__actions">
            {step > 0 && (
              <button
                type="button"
                className="tour__back"
                onClick={() => {
                  setHeading(-1);
                  tourState.back();
                }}
                aria-label="Previous step"
              >
                <ArrowLeft size={14} />
              </button>
            )}
            <button
              type="button"
              className="tour__next"
              onClick={() => {
                setHeading(1);
                tourState.next();
              }}
            >
              {last ? 'Done' : 'Next'}
              {!last && <ArrowRight size={14} aria-hidden />}
            </button>
          </div>
        </div>

        <button
          type="button"
          className="tour__close"
          onClick={() => tourState.stop()}
          aria-label="End the tour"
        >
          <X size={13} />
        </button>
      </div>
    </div>,
    document.body
  );
};

/**
 * The mark on the offer, drawn by the same pen as the tour it offers.
 *
 * A circle with a stroke into it: the two marks the walkthrough is made of, at
 * badge size. It is the honest way to advertise a hand-drawn tour, and it is
 * cheaper than the alternative -- a lucide glyph would have been a third
 * visual language on a card whose whole job is to introduce the second.
 *
 * Computed once at module load, because both paths are pure functions of a
 * seed and rebuilding them per render produces the identical string at a cost.
 */
const OFFER_RING = roughEllipse(20, 20, 15, 14, {
  seed: seedFrom('offer:ring'),
  level: 'heavy',
  width: 2,
});

const OFFER_TICK = roughPolyline(
  [
    { x: 13, y: 21 },
    { x: 18, y: 26 },
    { x: 28, y: 13 },
  ],
  { seed: seedFrom('offer:tick'), closed: false, level: 'medium', width: 2 }
);

/**
 * The offer, once.
 *
 * ## Why it is offered rather than started
 *
 * A tour that begins on its own is the product deciding that its own
 * introduction matters more than whatever you opened it to do, and somebody
 * arriving through a shared link is trying to reach a colleague's board. So
 * this is two buttons and a sentence, and declining is recorded exactly as
 * firmly as accepting: neither is asked twice.
 *
 * ## Why it comes before everything else that coaches
 *
 * It used to wait for the dock's question about frames, which was backwards:
 * the tour is where things are and the dock's question is a specific follow-up
 * about one of them. Worse, the dock coach only appears once the board has an
 * object on it, so on a *new* board nothing was offered at all and the tour
 * could only be found in the reference panel's footer. An empty board is the
 * best moment for it, not a moment to be excluded from.
 *
 * ## Why it waits a beat
 *
 * Not for effect. A card that is already there when the page finishes painting
 * reads as part of the page, and this is a question about the page. A second
 * and a half is long enough for somebody to have looked at the board first,
 * which is what makes it an offer rather than a toll gate.
 */
const OFFER_DELAY = 1500;

export const TourOffer: React.FC<{ visible: boolean }> = ({ visible }) => {
  const { seen, step } = useSyncExternalStore(
    tourState.subscribe,
    tourState.getSnapshot,
    tourState.getSnapshot
  );
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!visible || seen) return;
    const t = window.setTimeout(() => setReady(true), OFFER_DELAY);
    return () => window.clearTimeout(t);
  }, [visible, seen]);

  if (!visible || seen || step !== null || !ready) return null;

  return (
    <aside className="tour-offer" role="note" aria-label="Take a tour">
      <span className="tour-offer__mark" aria-hidden="true">
        <svg viewBox="0 0 40 40">
          <path className="tour-offer__ring" pathLength={1} d={OFFER_RING} />
          <path className="tour-offer__tick" pathLength={1} d={OFFER_TICK} />
        </svg>
      </span>

      <div className="tour-offer__body">
        <p className="tour-offer__title">First time here?</p>
        {/* The count comes from the table, not from the sentence. "six steps"
            was written out, and the reference panel's own button already says
            `Take the {TOUR.length}-step tour` — so the two would have
            disagreed the moment a step was added, with the prose version being
            the one nobody would think to update. Same fault `toolNames.ts`
            opens by describing, in the copy rather than in a binding. */}
        <p className="tour-offer__text">
          Twenty seconds, {TOUR.length} steps, and you will know where everything is.
        </p>
      </div>

      <div className="tour-offer__actions">
        <button type="button" className="tour-offer__ghost" onClick={() => tourState.decline()}>
          Not now
        </button>
        <button type="button" className="tour-offer__primary" onClick={() => tourState.start()}>
          Show me round
        </button>
      </div>
    </aside>
  );
};

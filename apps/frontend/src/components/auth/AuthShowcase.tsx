import React, { useEffect, useState } from 'react';

/**
 * What this is, said in the only free moment the product ever gets.
 *
 * ## Why this replaced the welcome sequence
 *
 * There was a three-beat modal on the board -- the canvas has no edges, other
 * people can be here, nothing is lost offline -- shown once, after signing in.
 * It was good writing in the wrong place twice over.
 *
 * Wrong place, first: it interrupted the one screen whose entire promise is an
 * unbroken surface. Somebody arriving through a shared link is trying to reach
 * a board a colleague is already working in, and the product's answer was a
 * card in front of it.
 *
 * Wrong place, second: the screen *before* it had a whole empty half. The auth
 * screen is a 400px card floating in a page, at the one moment when attention
 * is genuinely free -- a person typing their name is not yet trying to do
 * anything else. Saying it here costs nobody a click, and it means the board is
 * never interrupted at all.
 *
 * ## Why every beat stays mounted
 *
 * The first version keyed the stage on the beat index, so React threw the old
 * one away and mounted the new one. Each beat therefore had an entrance and no
 * exit: the outgoing text vanished on a frame boundary and the incoming text
 * rose into the hole it left. That reads as a slideshow, and it is the single
 * thing that separates a panel that feels made from one that feels assembled.
 *
 * All three are mounted and carry a state instead. The one leaving drifts up
 * and dissolves while the one arriving rises into place, so at every moment
 * there is something on screen and the two overlap the way a dissolve should.
 * Only the active one is in the accessibility tree; the other two are `inert`
 * and hidden, so a screen reader is not handed three competing headings.
 *
 * ## Why it is drawn rather than filmed
 *
 * A screen recording of the app inside the app is redundant the day it is made
 * and wrong a month later. These draw the *idea*, which does not go stale when
 * a panel moves, and they are a few hundred bytes of vector that stay crisp on
 * a 5K display and cost nothing on a phone.
 *
 * ## Why it advances on its own
 *
 * There is nothing to do here except type a name, so a Next button would be a
 * second thing to do on a screen that should have one. It cycles, it shows
 * where it is, and any beat can be jumped to. It stops entirely under
 * `prefers-reduced-motion`, where a panel that changes by itself is exactly
 * what the setting is asking not to happen.
 */

const BEAT_MS = 6800;

interface Beat {
  eyebrow: string;
  title: string;
  body: string;
  art: React.ReactNode;
}

/**
 * A field of dots that never arrives anywhere.
 *
 * The claim is edgelessness, so the drawing must not have an edge and must not
 * turn round. The first version drifted back and forth, which is a rectangle
 * of dots wobbling: it says the opposite of the sentence beside it.
 *
 * This pans one way for ever. The tile is drawn two cells wider than it needs
 * to be and translated by exactly one cell period, so the loop point is
 * invisible and the field simply keeps going -- which is the whole idea, drawn.
 */
const Edgeless: React.FC = () => (
  <svg viewBox="0 0 320 220" className="showcase__art" aria-hidden="true">
    <defs>
      <radialGradient id="scFade" cx="50%" cy="46%" r="62%">
        <stop offset="40%" stopColor="#fff" stopOpacity="0.9" />
        <stop offset="100%" stopColor="#fff" stopOpacity="0" />
      </radialGradient>
      <mask id="scDots">
        <rect width="320" height="220" fill="url(#scFade)" />
      </mask>
    </defs>

    <g mask="url(#scDots)">
      <g className="showcase__drift">
        {Array.from({ length: 14 }).map((_, row) =>
          Array.from({ length: 21 }).map((__, col) => (
            <circle
              key={`${row}-${col}`}
              cx={col * 18 - 12}
              cy={row * 18 - 6}
              r="1.5"
              fill="var(--showcase-ink)"
              opacity="0.45"
            />
          ))
        )}
      </g>
    </g>

    {/* Objects at three depths, moving at three rates. The parallax between
        them is what makes a flat field read as space rather than as wallpaper,
        and it is why they are not simply drifting together.

        Three masses, deliberately unequal. The first version had two greys of
        almost the same size on the same side, which reads as repetition rather
        than as depth: a composition needs a hero, a supporting mass and an
        accent, and three similar rectangles is none of those. */}
    <g className="showcase__near">
      <rect x="52" y="74" width="106" height="64" rx="13" fill="var(--showcase-accent)" />
    </g>
    <g className="showcase__far">
      <rect x="184" y="134" width="96" height="38" rx="11" fill="var(--showcase-ink)" opacity="0.26" />
    </g>

    {/* A fourth thing arriving from off the edge and settling, once a loop.
        Nothing else in the picture says you can *keep going*; a block that
        comes in from outside the frame does. */}
    <g className="showcase__arrive">
      <rect x="200" y="54" width="52" height="34" rx="10" fill="var(--showcase-ink)" opacity="0.2" />
    </g>
  </svg>
);

/**
 * Two cursors, mid-gesture, one of them holding something.
 *
 * Presence is the claim, so there are two hands rather than one, and the names
 * ride on the cursors because that is how the product actually shows who is
 * who. The accent block is picked up and set down over the loop: a cursor that
 * only travels is a decoration, and a cursor that moves something is the claim.
 */
const Together: React.FC = () => (
  <svg viewBox="0 0 320 220" className="showcase__art" aria-hidden="true">
    {/**
      * Four things on a diagonal, and nothing overlapping anything it does not
      * mean to.
      *
      * The first arrangement piled them: the blue cursor landed in the middle
      * of the accent block with its name chip over the fill, which reads as a
      * badge stuck on a shape rather than as somebody holding it. A cursor with
      * a name needs about sixty units of clear space beside it, and that is a
      * layout constraint rather than a detail.
      *
      * So the blue pointer's tip sits exactly on the block's bottom-left corner
      * and its chip hangs below, in open ground. The two move by the same
      * offset on the same curve, which is what makes the relationship read: the
      * cursor is not near the block, it is carrying it.
      */}
    <rect x="38" y="34" width="110" height="66" rx="14" fill="var(--showcase-ink)" opacity="0.18" />

    <g className="showcase__carried">
      <rect x="152" y="104" width="106" height="62" rx="14" fill="var(--showcase-accent)" opacity="0.94" />
    </g>

    <g className="showcase__hand showcase__hand--a">
      <path d="M0 0 L0 19 L4.8 13.8 L8.6 21.4 L12.4 19.4 L8.6 12 L15 12 Z" fill="var(--showcase-accent)" />
      <rect x="14" y="16" width="56" height="18" rx="9" fill="var(--showcase-accent)" />
    </g>
    <g className="showcase__hand showcase__hand--b">
      <path d="M0 0 L0 19 L4.8 13.8 L8.6 21.4 L12.4 19.4 L8.6 12 L15 12 Z" fill="#4C8DFF" />
      <rect x="14" y="16" width="48" height="18" rx="9" fill="#4C8DFF" />
    </g>
  </svg>
);

/**
 * A connection that drops, work that does not, and a merge.
 *
 * Drawn as a thread that breaks and rejoins rather than as a cloud with a slash
 * through it: the claim is not "it works offline", it is that the two halves
 * come back together rather than one overwriting the other. The pulse that runs
 * the length of it afterwards is the merge arriving, which is the half people
 * actually worry about.
 */
const Durable: React.FC = () => (
  <svg viewBox="0 0 320 220" className="showcase__art" aria-hidden="true">
    <path
      className="showcase__thread"
      d="M40 158 C 96 158, 96 74, 160 74 C 224 74, 224 158, 280 158"
      fill="none"
      stroke="var(--showcase-ink)"
      strokeOpacity="0.22"
      strokeWidth="3"
      strokeLinecap="round"
    />
    <path
      className="showcase__thread showcase__thread--live"
      d="M40 158 C 96 158, 96 74, 160 74 C 224 74, 224 158, 280 158"
      fill="none"
      stroke="var(--showcase-accent)"
      strokeWidth="3.5"
      strokeLinecap="round"
    />
    {/* The merge arriving. A short bright dash travelling the whole run once
        the two halves have met. */}
    <path
      className="showcase__pulse"
      d="M40 158 C 96 158, 96 74, 160 74 C 224 74, 224 158, 280 158"
      fill="none"
      stroke="var(--showcase-ink)"
      strokeWidth="3.5"
      strokeLinecap="round"
    />
    <circle className="showcase__node showcase__node--a" cx="40" cy="158" r="8" fill="var(--showcase-accent)" />
    <circle className="showcase__node showcase__node--b" cx="280" cy="158" r="8" fill="var(--showcase-accent)" />
    <circle className="showcase__join" cx="160" cy="74" r="11" fill="var(--showcase-accent)" />
  </svg>
);

const BEATS: readonly Beat[] = [
  {
    eyebrow: 'The surface',
    title: 'A canvas with no edges',
    body: 'No page to fill, no artboard to fit inside, no zoom that runs out. Put something down anywhere and keep going in any direction.',
    art: <Edgeless />,
  },
  {
    eyebrow: 'The people',
    title: 'Everyone, at the same time',
    body: 'Send the link and they are in. No account, nothing to accept. You watch their cursor move as they think.',
    art: <Together />,
  },
  {
    eyebrow: 'The work',
    title: 'It keeps working offline',
    body: 'Edits made with the network down merge when you come back rather than being rejected. Export real vectors whenever you want them.',
    art: <Durable />,
  },
];

export const AuthShowcase: React.FC = () => {
  const [beat, setBeat] = useState(0);
  /**
   * The beat that is on its way out, so it can be drawn leaving.
   *
   * Held separately from the index rather than derived as "the previous one",
   * because on the first render there is no previous beat and a derived value
   * would animate one out of nothing. Cleared once the dissolve has finished so
   * a beat is never left in the exit state.
   */
  const [leaving, setLeaving] = useState<number | null>(null);
  /**
   * Paused while somebody is reading, and stopped for anyone who has asked for
   * less motion.
   *
   * Read once at mount rather than subscribed: this decides whether a timer is
   * created at all, and somebody changing the system setting mid-signup is not
   * a case worth a listener.
   */
  const [paused, setPaused] = useState(false);
  const still = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const go = React.useCallback(
    (next: number) => {
      setBeat((current) => {
        if (next === current) return current;
        setLeaving(current);
        return next;
      });
    },
    []
  );

  useEffect(() => {
    if (paused || still) return;
    const t = window.setTimeout(() => go((beat + 1) % BEATS.length), BEAT_MS);
    return () => window.clearTimeout(t);
  }, [beat, paused, still, go]);

  useEffect(() => {
    if (leaving === null) return;
    const t = window.setTimeout(() => setLeaving(null), 640);
    return () => window.clearTimeout(t);
  }, [leaving]);

  return (
    <section
      className="showcase"
      aria-label="What Vega Studio is"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* The wash. Two soft fields that drift against each other, which is what
          keeps a flat panel from reading as a coloured rectangle. Behind
          everything and never in front of type. */}
      <div className="showcase__wash" aria-hidden="true">
        <span className="showcase__orb showcase__orb--one" />
        <span className="showcase__orb showcase__orb--two" />
      </div>

      {/* Grain and a vignette, in that order. Both are the difference between a
          dark panel and one that looks made: a flat fill at this size shows
          banding across the gradient, and grain is what breaks it up. */}
      <div className="showcase__grain" aria-hidden="true" />
      <div className="showcase__vignette" aria-hidden="true" />

      <div className="showcase__stage">
        {BEATS.map((b, i) => {
          const state = i === beat ? 'active' : i === leaving ? 'leaving' : 'idle';
          return (
            <div
              key={b.title}
              className="showcase__beat"
              data-state={state}
              // Only the beat on screen is in the accessibility tree. Three
              // headings competing is worse than none.
              aria-hidden={state === 'active' ? undefined : true}
            >
              <div className="showcase__frame">{b.art}</div>
              <p className="showcase__eyebrow">{b.eyebrow}</p>
              <h2 className="showcase__title">{b.title}</h2>
              <p className="showcase__body">{b.body}</p>
            </div>
          );
        })}
      </div>

      <div className="showcase__rail" role="tablist" aria-label="Highlights">
        {BEATS.map((b, i) => (
          <button
            key={b.title}
            type="button"
            role="tab"
            aria-selected={i === beat}
            aria-label={b.title}
            className={`showcase__tick${i === beat ? ' is-active' : ''}`}
            onClick={() => go(i)}
          >
            {/* The fill is the timer made visible, so the panel never changes
                without having said it was about to. */}
            <span className="showcase__tick-fill" data-running={i === beat && !paused && !still ? '' : undefined} />
          </button>
        ))}
      </div>
    </section>
  );
};

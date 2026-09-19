import React, { useEffect, useState } from 'react';
import { roughEllipse, roughPolyline, seedFrom } from '../../engine/model/rough';

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
 * screen is a card floating in a page, at the one moment when attention is
 * genuinely free -- a person typing their name is not yet trying to do anything
 * else. Saying it here costs nobody a click, and it means the board is never
 * interrupted at all.
 *
 * ## Why every beat stays mounted
 *
 * The first version keyed the stage on the beat index, so React threw the old
 * one away and mounted the new one. Each beat therefore had an entrance and no
 * exit: the outgoing text vanished on a frame boundary and the incoming text
 * rose into the hole it left. That reads as a slideshow, and it is the single
 * thing that separates a panel that feels made from one that feels assembled.
 *
 * All four are mounted and carry a state instead. The one leaving drifts up and
 * dissolves while the one arriving rises into place, so at every moment there is
 * something on screen and the two overlap the way a dissolve should. Only the
 * active one is in the accessibility tree.
 *
 * ## Why it is drawn rather than filmed
 *
 * A screen recording of the app inside the app is redundant the day it is made
 * and wrong a month later. These draw the *idea*, which does not go stale when
 * a panel moves, and they are a few hundred bytes of vector that stay crisp on
 * a 5K display and cost nothing on a phone.
 *
 * The last beat goes further and draws itself with `rough.ts`, the generator the
 * canvas actually renders hand-drawn shapes with. A claim about the product's
 * own pen, made by that pen, cannot be out of date.
 */

const BEAT_MS = 7000;

/**
 * There is no eyebrow here, and there should never be one again.
 *
 * Each beat carried one — "The surface", "The people" — set in brand orange
 * above the title. Two separate rules in this project forbid exactly that, and
 * DESIGN.md's own No Eyebrow Rule cites *this element* as the instance that
 * shipped: an uppercase kicker labels the heading instead of saying anything
 * the heading does not, and brand orange as text on a light ground measures
 * about 2.1:1, which the Don'ts list forbids outright.
 *
 * "The surface" over "A canvas with no edges" is the heading's own subject read
 * back to it. Deleting it costs no information and returns the beat to one
 * claim, which is what a beat is.
 */
interface Beat {
  title: string;
  body: string;
  art: React.ReactNode;
}

/* -------------------------------------------------------------- the people */

/**
 * Somebody else's cursor, with their name on it.
 *
 * The names are the point. Two arrows drifting is a screensaver; two arrows
 * with names is the claim being made, because what a shared board actually
 * feels like is seeing who is doing what. They are three letters each and
 * belong to nobody, which is deliberate: a plausible full name on a marketing
 * screen is a person who did not agree to be there.
 *
 * The chip is sized from the text rather than fixed, so a longer name later
 * does not overflow a rectangle drawn for a shorter one.
 */
const Cursor: React.FC<{ name: string; color: string; className: string }> = ({
  name,
  color,
  className,
}) => {
  const width = 17 + name.length * 7.2;
  return (
    <g className={className}>
      <path
        d="M0 0 L0 19 L4.8 13.8 L8.6 21.4 L12.4 19.4 L8.6 12 L15 12 Z"
        fill={color}
        stroke="var(--showcase-bg)"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <rect x="13" y="15" width={width} height="19" rx="9.5" fill={color} />
      <text
        x={13 + width / 2}
        y="28.5"
        textAnchor="middle"
        fill="#fff"
        fontSize="11"
        fontWeight="600"
        fontFamily="var(--font-sans)"
      >
        {name}
      </text>
    </g>
  );
};

/**
 * Two people on one board, and what each of them is doing.
 *
 * ## Why they do different things
 *
 * The first version had two cursors travelling and one block moving with one of
 * them. Both hands doing the same kind of nothing is a decoration; what makes
 * presence legible is being able to tell *what somebody is up to* without
 * asking them. So one is dragging a card and the other has something selected,
 * which are the two states this product actually shows a collaborator in.
 *
 * The selection ring is that idea drawn twice: it is the colour of the person
 * who made it, which is exactly how the board draws one.
 */
const Together: React.FC = () => (
  <svg viewBox="0 0 320 220" className="showcase__art" aria-hidden="true">
    {/* Kai's, with their selection on it. */}
    <g className="showcase__picked">
      <rect x="34" y="42" width="112" height="64" rx="13" fill="var(--showcase-ink)" opacity="0.13" />
      <rect x="30" y="38" width="120" height="72" rx="16" fill="none" stroke="#4C8DFF" strokeWidth="2" />
      {/* The handles a real selection carries, at two corners, so the ring
          reads as a selection rather than as a second border. */}
      <rect x="26" y="34" width="8" height="8" rx="2" fill="#4C8DFF" />
      <rect x="146" y="106" width="8" height="8" rx="2" fill="#4C8DFF" />
    </g>

    {/* Ada's, being carried. */}
    <g className="showcase__carried">
      <rect x="164" y="116" width="110" height="64" rx="13" fill="var(--showcase-accent)" opacity="0.95" />
    </g>

    <Cursor name="Kai" color="#4C8DFF" className="showcase__hand showcase__hand--b" />
    <Cursor name="Ada" color="var(--showcase-accent)" className="showcase__hand showcase__hand--a" />
  </svg>
);

/* ------------------------------------------------------------- the surface */

/**
 * A field that never arrives anywhere, and things at three depths.
 *
 * The claim is edgelessness, so the drawing must not have an edge and must not
 * turn round. The first version drifted back and forth, which is a rectangle of
 * dots wobbling and says the opposite of the sentence beside it. This pans one
 * way for ever: the tile is drawn wider than the frame and moved by exactly one
 * cell period, so the loop point cannot be seen.
 *
 * The objects are a card with lines in it, a pair of bars and a disc rather
 * than three grey rectangles. Three rectangles is a wireframe; a card, a list
 * and a shape is a board.
 */
const Edgeless: React.FC = () => (
  <svg viewBox="0 0 320 220" className="showcase__art" aria-hidden="true">
    <defs>
      <radialGradient id="scFade" cx="50%" cy="46%" r="64%">
        <stop offset="38%" stopColor="#fff" stopOpacity="0.95" />
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
              r="1.4"
              fill="var(--showcase-ink)"
              opacity="0.4"
            />
          ))
        )}
      </g>
    </g>

    <g className="showcase__near">
      <rect x="44" y="70" width="106" height="68" rx="14" fill="var(--showcase-accent)" />
      <rect x="60" y="88" width="58" height="7" rx="3.5" fill="#fff" opacity="0.6" />
      <rect x="60" y="103" width="76" height="7" rx="3.5" fill="#fff" opacity="0.34" />
    </g>

    <g className="showcase__far">
      <rect x="176" y="142" width="98" height="14" rx="7" fill="var(--showcase-ink)" opacity="0.2" />
      <rect x="176" y="164" width="62" height="14" rx="7" fill="var(--showcase-ink)" opacity="0.12" />
    </g>

    {/* Something arriving from outside the frame, once a loop. Nothing else in
        the picture says you can keep going; a thing that comes in from off the
        edge does. */}
    <g className="showcase__arrive">
      <circle cx="230" cy="64" r="25" fill="var(--showcase-ink)" opacity="0.15" />
    </g>
  </svg>
);

/* ---------------------------------------------------------------- the work */

/**
 * A connection that drops, work that does not, and a merge.
 *
 * Drawn as a thread that breaks and rejoins rather than as a cloud with a slash
 * through it: the claim is not "it works offline", it is that the two halves
 * come back together rather than one overwriting the other. The pulse that runs
 * the length of it afterwards is the merge arriving, which is the half people
 * actually worry about.
 */
const THREAD = 'M40 156 C 96 156, 96 72, 160 72 C 224 72, 224 156, 280 156';

const Durable: React.FC = () => (
  <svg viewBox="0 0 320 220" className="showcase__art" aria-hidden="true">
    <path className="showcase__thread" d={THREAD} fill="none" stroke="var(--showcase-ink)" strokeOpacity="0.2" strokeWidth="3" strokeLinecap="round" />
    <path className="showcase__thread showcase__thread--live" d={THREAD} fill="none" stroke="var(--showcase-accent)" strokeWidth="3.5" strokeLinecap="round" />
    <path className="showcase__pulse" d={THREAD} fill="none" stroke="var(--showcase-ink)" strokeWidth="3.5" strokeLinecap="round" />

    <circle className="showcase__node showcase__node--a" cx="40" cy="156" r="9" fill="var(--showcase-accent)" />
    <circle className="showcase__node showcase__node--b" cx="280" cy="156" r="9" fill="var(--showcase-accent)" />
    <circle className="showcase__join" cx="160" cy="72" r="12" fill="var(--showcase-accent)" />
  </svg>
);

/* ---------------------------------------------------------------- the look */

/**
 * The same shape, ruled and drawn.
 *
 * Made with `rough.ts`, the generator the canvas renders hand-drawn shapes with,
 * at the profiles it actually ships. A claim about the product's own pen, made
 * by that pen, cannot go out of date, and it is the one thing on this screen
 * that could not be copied off a marketing page without building it first.
 *
 * Computed once at module load: the paths are pure functions of a seed, so
 * recomputing them on every render would produce the identical string at a cost.
 */
/**
 * The ruled pair, at exactly the coordinates the drawn pair uses.
 *
 * A rectangle and an ellipse, both square-cornered, because the claim is *the
 * same shape twice*. The first version put a rounded rectangle on the left
 * against a sharp sketched one on the right and gave the sketch no circle at
 * all, so the eye read two different drawings rather than one drawing done two
 * ways, and the whole point of the beat went with it.
 */
const RULED_RECT = { x: 28, y: 74, width: 110, height: 86 };
const RULED_RING = { cx: 83, cy: 117, rx: 30, ry: 22 };

const DRAWN = roughPolyline(
  [
    { x: 182, y: 74 },
    { x: 292, y: 74 },
    { x: 292, y: 160 },
    { x: 182, y: 160 },
  ],
  { seed: seedFrom('showcase:rect'), closed: true, level: 'medium', width: 2.5 }
);

const DRAWN_RING = roughEllipse(237, 117, 30, 22, {
  seed: seedFrom('showcase:ring'),
  level: 'light',
  width: 2,
});

const Handmade: React.FC = () => (
  <svg viewBox="0 0 320 220" className="showcase__art" aria-hidden="true">
    {/* Ruled, on the left: what everything else in this category gives you. */}
    <rect {...RULED_RECT} fill="var(--showcase-ink)" opacity="0.1" />
    <rect {...RULED_RECT} fill="none" stroke="var(--showcase-ink)" strokeOpacity="0.3" strokeWidth="2" />
    <ellipse {...RULED_RING} fill="none" stroke="var(--showcase-ink)" strokeOpacity="0.22" strokeWidth="2" />

    {/* Drawn, on the right, by the real generator. */}
    <g className="showcase__pen">
      <path d={DRAWN} fill="none" stroke="var(--showcase-accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d={DRAWN_RING} fill="none" stroke="var(--showcase-accent)" strokeOpacity="0.5" strokeWidth="2" strokeLinecap="round" />
    </g>
  </svg>
);

const BEATS: readonly Beat[] = [
  {
    title: 'A canvas with no edges',
    body: 'No page to fill, no artboard to fit inside, no zoom that runs out. Put something down anywhere and keep going in any direction.',
    art: <Edgeless />,
  },
  {
    title: 'Everyone, at the same time',
    body: 'Send the link and they are in. No account, nothing to accept. You see their cursor, their name, and what they are holding.',
    art: <Together />,
  },
  {
    title: 'It keeps working offline',
    body: 'Edits made with the network down merge when you come back. Nobody has to be told their afternoon was overwritten.',
    art: <Durable />,
  },
  {
    title: 'Ruled, or drawn by hand',
    body: 'Any shape can be sketched instead of drafted, and everyone on the board sees the same strokes. This one was drawn by the app.',
    art: <Handmade />,
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
  const [paused, setPaused] = useState(false);
  const still = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const go = React.useCallback((next: number) => {
    setBeat((current) => {
      if (next === current) return current;
      setLeaving(current);
      return next;
    });
  }, []);

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
      {/* The ground: three soft fields over a base wash, then grain and a
          vignette. Every colour comes from a token that changes with the theme,
          so the light version is a warm tinted page rather than the dark one
          turned inside out. */}
      <div className="showcase__wash" aria-hidden="true">
        <span className="showcase__field showcase__field--one" />
        <span className="showcase__field showcase__field--two" />
        <span className="showcase__field showcase__field--three" />
      </div>
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
              aria-hidden={state === 'active' ? undefined : true}
            >
              <div className="showcase__frame">{b.art}</div>
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

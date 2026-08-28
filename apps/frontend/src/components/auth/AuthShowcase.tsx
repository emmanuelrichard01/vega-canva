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
 * Putting the same three ideas in both places would have been the duplication
 * this codebase keeps finding. So there is one telling of it, and it is here.
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

const BEAT_MS = 6400;

interface Beat {
  eyebrow: string;
  title: string;
  body: string;
  art: React.ReactNode;
}

/**
 * A field of dots that fades at every edge rather than stopping at one.
 *
 * The claim is edgelessness, so the drawing must not have an edge. A bounded
 * grid of dots would illustrate the opposite of the sentence beside it.
 */
const Edgeless: React.FC = () => (
  <svg viewBox="0 0 320 220" className="showcase__art" aria-hidden="true">
    <defs>
      <radialGradient id="scFade" cx="50%" cy="48%" r="58%">
        <stop offset="45%" stopColor="#fff" stopOpacity="0.85" />
        <stop offset="100%" stopColor="#fff" stopOpacity="0" />
      </radialGradient>
      <mask id="scDots">
        <rect width="320" height="220" fill="url(#scFade)" />
      </mask>
    </defs>
    <g mask="url(#scDots)" className="showcase__drift">
      {Array.from({ length: 13 }).map((_, row) =>
        Array.from({ length: 19 }).map((__, col) => (
          <circle
            key={`${row}-${col}`}
            cx={col * 18 + 6}
            cy={row * 18 + 6}
            r="1.6"
            fill="var(--showcase-ink)"
            opacity="0.5"
          />
        ))
      )}
    </g>
    {/* Two objects at two depths. The parallax between them is what makes a
        flat dot field read as space rather than as wallpaper. */}
    <g className="showcase__near">
      <rect x="66" y="72" width="92" height="58" rx="10" fill="var(--showcase-accent)" />
    </g>
    <g className="showcase__far">
      <rect x="176" y="112" width="76" height="44" rx="10" fill="var(--showcase-ink)" opacity="0.32" />
    </g>
  </svg>
);

/**
 * Two cursors, mid-gesture, with names on them.
 *
 * Presence is the claim, so the drawing shows two hands rather than one, and
 * the names are on the cursors because that is how the product actually shows
 * who is who.
 */
const Together: React.FC = () => (
  <svg viewBox="0 0 320 220" className="showcase__art" aria-hidden="true">
    <rect x="52" y="58" width="112" height="72" rx="12" fill="var(--showcase-ink)" opacity="0.2" />
    <rect x="180" y="94" width="94" height="62" rx="12" fill="var(--showcase-accent)" opacity="0.92" />

    <g className="showcase__hand showcase__hand--a">
      <path d="M0 0 L0 19 L4.8 13.8 L8.6 21.4 L12.4 19.4 L8.6 12 L15 12 Z" fill="var(--showcase-accent)" />
      <rect x="14" y="16" width="46" height="17" rx="8" fill="var(--showcase-accent)" />
    </g>
    <g className="showcase__hand showcase__hand--b">
      <path d="M0 0 L0 19 L4.8 13.8 L8.6 21.4 L12.4 19.4 L8.6 12 L15 12 Z" fill="#4C8DFF" />
      <rect x="14" y="16" width="38" height="17" rx="8" fill="#4C8DFF" />
    </g>
  </svg>
);

/**
 * A connection that drops, work that does not, and a merge.
 *
 * Drawn as a line that breaks and rejoins rather than as a cloud with a slash
 * through it: the claim is not "it works offline", it is that the two halves
 * come back together rather than one overwriting the other.
 */
const Durable: React.FC = () => (
  <svg viewBox="0 0 320 220" className="showcase__art" aria-hidden="true">
    <path
      className="showcase__thread"
      d="M40 158 C 96 158, 96 74, 160 74 C 224 74, 224 158, 280 158"
      fill="none"
      stroke="var(--showcase-ink)"
      strokeOpacity="0.28"
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

  useEffect(() => {
    if (paused || still) return;
    const t = window.setTimeout(() => setBeat((b) => (b + 1) % BEATS.length), BEAT_MS);
    return () => window.clearTimeout(t);
  }, [beat, paused, still]);

  const current = BEATS[beat];

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

      {/* `key` on the beat, so each mounts fresh and plays its own entrance
          rather than cross-fading text inside a box that never moves. */}
      <div className="showcase__stage" key={beat}>
        <div className="showcase__frame">{current.art}</div>
        <p className="showcase__eyebrow">{current.eyebrow}</p>
        <h2 className="showcase__title">{current.title}</h2>
        <p className="showcase__body">{current.body}</p>
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
            onClick={() => setBeat(i)}
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

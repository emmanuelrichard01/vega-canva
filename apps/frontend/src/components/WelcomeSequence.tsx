import React, { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Logo } from './ui/Logo';

/**
 * The first thirty seconds.
 *
 * ## What this is, and what it deliberately is not
 *
 * It is **not** a tour. A tour points at chrome — "this is the layers panel,
 * this is the toolbar" — which teaches the furniture rather than the idea, and
 * has to be sat through before you are allowed to touch anything. The in-place
 * guidance in `CanvasEmptyState` and `FirstRunGuide` already teaches the
 * furniture, at the moment each piece becomes relevant, without blocking.
 *
 * This answers the one question those cannot: **what is this thing for.**
 * Three beats, once ever, and then never again — the board is unbounded, other
 * people can be on it with you, and the work stays yours. Anything that can be
 * discovered by using the product is not in here.
 *
 * ## Why it is skippable from the first frame
 *
 * Someone arriving through a shared link is trying to reach a specific board
 * that a colleague is already working in. Making them watch anything first is
 * the product asserting its own importance over theirs. Escape closes it, the
 * skip control is present from the start rather than appearing on the last
 * beat, and the whole thing is one keystroke from gone.
 */

const STORAGE_KEY = 'vega_welcome_v1';

interface Beat {
  title: string;
  body: string;
  /** The idea, drawn. Text alone would make this a slideshow of claims. */
  art: React.ReactNode;
}

/**
 * Each beat draws its own idea rather than carrying a screenshot.
 *
 * A screenshot of the app inside the app is both redundant and immediately
 * out of date; a diagram of the *idea* stays true and reads in a glance.
 */
const BEATS: Beat[] = [
  {
    title: 'A canvas with no edges',
    body: 'No page, no artboard to fill, no zoom that runs out. Put something anywhere and keep going in any direction.',
    art: (
      <svg viewBox="0 0 220 120" aria-hidden="true" className="welcome__svg">
        <defs>
          <radialGradient id="wsFade" cx="50%" cy="50%" r="55%">
            <stop offset="55%" stopColor="var(--text-primary)" stopOpacity="0.5" />
            <stop offset="100%" stopColor="var(--text-primary)" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* A dot field that fades out rather than stopping — the edgelessness
            is the whole point, so the drawing must not have an edge either. */}
        <rect width="220" height="120" fill="url(#wsFade)" mask="url(#wsDots)" />
        <mask id="wsDots">
          <rect width="220" height="120" fill="black" />
          {Array.from({ length: 12 }).map((_, row) =>
            Array.from({ length: 22 }).map((__, col) => (
              <circle key={`${row}-${col}`} cx={col * 10 + 5} cy={row * 10 + 5} r="1.1" fill="white" />
            ))
          )}
        </mask>
        <rect x="46" y="34" width="52" height="34" rx="6" fill="var(--accent)" />
        <rect x="112" y="52" width="62" height="26" rx="6" fill="var(--text-primary)" opacity="0.28" />
      </svg>
    ),
  },
  {
    title: 'Everyone, at the same time',
    body: 'Send the link and they are in. No account, nothing to accept. You will see their cursor move as they think.',
    art: (
      <svg viewBox="0 0 220 120" aria-hidden="true" className="welcome__svg">
        <rect x="30" y="30" width="70" height="46" rx="8" fill="var(--text-primary)" opacity="0.16" />
        <rect x="120" y="48" width="70" height="40" rx="8" fill="var(--accent)" opacity="0.9" />
        {/* Two cursors, two colours, both mid-gesture — presence is the claim,
            so the drawing shows two hands rather than one. */}
        <g className="welcome__cursor welcome__cursor--a">
          <path d="M0 0 L0 15 L4 11 L7 17 L10 15 L7 9 L12 9 Z" fill="var(--accent)" />
        </g>
        <g className="welcome__cursor welcome__cursor--b">
          <path d="M0 0 L0 15 L4 11 L7 17 L10 15 L7 9 L12 9 Z" fill="#3B82F6" />
        </g>
      </svg>
    ),
  },
  {
    title: 'It keeps working offline',
    body: 'Edits made without a connection merge when you come back rather than being rejected. Export real vectors whenever you want them.',
    art: (
      <svg viewBox="0 0 220 120" aria-hidden="true" className="welcome__svg">
        <rect x="34" y="26" width="152" height="68" rx="10" fill="none" stroke="var(--text-primary)" strokeOpacity="0.22" strokeWidth="2" />
        <path d="M62 74 L96 44 L124 66 L158 38" fill="none" stroke="var(--accent)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="158" cy="38" r="6" fill="var(--accent)" />
      </svg>
    ),
  },
];

export const WelcomeSequence: React.FC = () => {
  const [done, setDone] = useState(() => localStorage.getItem(STORAGE_KEY) === 'seen');
  const [beat, setBeat] = useState(0);
  const [leaving, setLeaving] = useState(false);

  const finish = React.useCallback(() => {
    // Marked immediately, not when the exit finishes: a reload during the
    // fade must not bring it back.
    localStorage.setItem(STORAGE_KEY, 'seen');
    setLeaving(true);
    window.setTimeout(() => setDone(true), 320);
  }, []);

  const next = () => (beat < BEATS.length - 1 ? setBeat((b) => b + 1) : finish());

  useEffect(() => {
    if (done) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      // Enter and the arrows advance, so the whole thing is operable without
      // ever finding the button.
      if (e.key === 'Enter' || e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') setBeat((b) => Math.max(0, b - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (done) return null;
  const current = BEATS[beat];

  return (
    <div className={`welcome${leaving ? ' is-leaving' : ''}`} role="dialog" aria-label="Welcome to Vega Studio">
      <div className="welcome__card">
        <div className="welcome__head">
          <Logo piece="mark" size={28} />
          <span className="welcome__brand">Vega Studio</span>
          {/* Present from the first frame. Someone following a shared link is
              trying to reach a colleague's board, not to watch an intro. */}
          <button type="button" className="welcome__skip" onClick={finish}>
            Skip
          </button>
        </div>

        {/* `key` on the beat, so each one mounts fresh and replays its own
            entrance rather than cross-fading text inside a static box. */}
        <div className="welcome__stage" key={beat}>
          <div className="welcome__art">{current.art}</div>
          <h2 className="welcome__title">{current.title}</h2>
          <p className="welcome__body">{current.body}</p>
        </div>

        <div className="welcome__foot">
          <div className="welcome__dots" role="tablist" aria-label="Progress">
            {BEATS.map((b, i) => (
              <button
                key={b.title}
                type="button"
                role="tab"
                aria-selected={i === beat}
                aria-label={b.title}
                className={`welcome__dot${i === beat ? ' is-active' : ''}`}
                onClick={() => setBeat(i)}
              />
            ))}
          </div>
          <button type="button" className="welcome__next" onClick={next}>
            {beat === BEATS.length - 1 ? 'Start creating' : 'Next'}
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

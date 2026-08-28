import React, { useEffect, useState } from 'react';
import { Check, Share2, X, Maximize2 } from 'lucide-react';
import { useStore } from '../hooks/useStore';

/**
 * What the interface cannot say for itself.
 *
 * ## Scope, and what was deliberately left out
 *
 * The obvious walkthrough here would be a five-step modal tour of the tool
 * dock, the layers panel and the inspector. That would be wrong twice over:
 * it interrupts the one screen whose whole promise is an unbroken surface,
 * and it re-teaches things the interface already teaches. `CanvasEmptyState`
 * already says what the board is and how to put the first thing on it, in
 * place, without blocking anything — so this starts *after* that has worked.
 *
 * What is left is the part the screen genuinely cannot show you:
 *
 * 1. **That other people can be here.** Real-time collaboration is the entire
 *    premise of the product and it is completely invisible when you are alone.
 *    Nothing on a single-player canvas hints that a link is the whole
 *    invitation, or that you will see someone's cursor move as they work.
 * 2. **That the chrome gets out of the way.** Panels collapse and `\` gives
 *    the board the whole screen. Both are worth knowing and neither announces
 *    itself.
 *
 * ## How it behaves
 *
 * Non-modal, and it **advances by doing rather than by clicking Next**. A step
 * completes when you actually perform it, so the guide is a record of what you
 * have discovered rather than a slideshow to click through. It never blocks
 * the canvas, it can be dismissed permanently in one click, and it appears
 * only once you have made something — so it greets someone who is already
 * engaged instead of someone still deciding whether to be.
 *
 * State lives in `localStorage`, never the document: which tips *you* have
 * seen is a fact about you, not about the board, and putting it in the CRDT
 * would dismiss it for every collaborator and grow the update log with it.
 */

const STORAGE_KEY = 'vega_guide_v1';

interface Props {
  /** The share sheet has been opened at least once this session. */
  hasShared: boolean;
  /** A panel has been collapsed, or focus mode entered. */
  hasReclaimedSpace: boolean;
}

export const FirstRunGuide: React.FC<Props> = ({ hasShared, hasReclaimedSpace }) => {
  const objectCount = useStore((state) => Object.keys(state.objects).length);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(STORAGE_KEY) === 'done');

  const steps = [
    {
      id: 'share',
      done: hasShared,
      icon: <Share2 size={15} />,
      title: 'Bring someone in',
      body: 'Share the link and they are on this board. No account, no invitation to accept. Their cursor appears as they move.',
    },
    {
      id: 'space',
      done: hasReclaimedSpace,
      icon: <Maximize2 size={15} />,
      title: 'Take the space back',
      body: 'Collapse either panel to widen the board, or press \\ to hand it the whole screen.',
    },
  ];

  const allDone = steps.every((s) => s.done);

  /**
   * Finish once everything has been done — after a beat, so the last step is
   * seen to complete rather than the panel vanishing under the action that
   * completed it.
   */
  useEffect(() => {
    if (!allDone || dismissed) return;
    const t = window.setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, 'done');
      setDismissed(true);
    }, 1600);
    return () => window.clearTimeout(t);
  }, [allDone, dismissed]);

  // Nothing on the board yet: the empty state is doing this job, and two
  // pieces of guidance on one screen is one too many.
  if (dismissed || objectCount === 0) return null;

  const close = () => {
    localStorage.setItem(STORAGE_KEY, 'done');
    setDismissed(true);
  };

  const remaining = steps.filter((s) => !s.done).length;

  return (
    <aside className="guide" aria-label="Getting started">
      <div className="guide__head">
        <span className="guide__eyebrow">
          {allDone ? 'All set' : `${remaining} thing${remaining === 1 ? '' : 's'} worth knowing`}
        </span>
        <button
          type="button"
          className="guide__close"
          onClick={close}
          aria-label="Dismiss getting started"
          data-tooltip="Dismiss"
        >
          <X size={14} />
        </button>
      </div>

      <ul className="guide__list">
        {steps.map((step) => (
          <li key={step.id} className={`guide__step${step.done ? ' is-done' : ''}`}>
            <span className="guide__icon" aria-hidden="true">
              {step.done ? <Check size={15} /> : step.icon}
            </span>
            <span>
              <span className="guide__title">{step.title}</span>
              {/* The body drops away once the step is done, so a completed
                  guide collapses to a short list of things you now know
                  rather than staying the same size and re-reading itself. */}
              {!step.done && <span className="guide__body">{step.body}</span>}
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
};

import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { useStore } from '../../hooks/useStore';
import { learnState } from '../../engine/learn/learnState';
import { keyFor, lessonForTool, type Lesson } from '../../engine/learn/lessons';
import { LessonDemo } from './LessonDemo';

/**
 * The thing a tool cannot say about itself, said when you pick it up.
 *
 * ## Why not a tour
 *
 * A tour is the obvious build and it is wrong for the reason `WelcomeSequence`
 * and `DockCoach` both already record: it teaches the furniture, in an order
 * nobody chose, before the board can be touched. It also teaches everything at
 * the moment nothing is relevant, which is the moment least likely to be
 * remembered.
 *
 * This fires on the one signal that means somebody is about to need the answer:
 * they armed the tool. The lesson is about that tool, it is on screen while
 * they are looking for what to do with it, and it is gone the moment they do.
 *
 * ## Why it retires by doing rather than by clicking
 *
 * `FirstRunGuide` established the pattern here and it is the best thing in this
 * product's onboarding: a step completes when you perform it. So this watches
 * the object count and the tool. Make something with the tool the lesson is
 * about and the lesson is learned, permanently, with no button pressed. Glance
 * at it and wander off and it comes back next time, which is the correct
 * behaviour for something you did not read.
 *
 * That distinction is the whole reason `learnState` separates shown from
 * learned. A dismissal that fired on sight would retire the lessons of exactly
 * the people who never read one.
 *
 * ## Why it is above the dock
 *
 * The tool you just pressed is down there, so the eye is already down there.
 * It is also the one band of this screen that is chrome rather than canvas: the
 * top belongs to the board's name, both sides to panels, and the corners to the
 * radar and the zoom control. `NoticeLayer` picked the same place for the same
 * reason, and the two are stacked rather than overlapping.
 *
 * ## Why one mute and not one dismissal each
 *
 * Somebody who closes the third of these has told you something about all
 * twelve. Making them close twelve is the product not listening. Muting is
 * reversible from the reference library, which is where a person who changed
 * their mind would go looking.
 */

interface Props {
  /** The armed tool, straight from `Room`. */
  activeTool: string;
  /** Hidden with the rest of the chrome in focus mode. */
  visible: boolean;
}

/**
 * How long a tool must stay armed before its lesson appears.
 *
 * Cycling through the dock with the keyboard passes through four tools in a
 * second, and a coach mark that fired on each would be a strobe. This is long
 * enough that arriving somewhere on purpose is the only thing that raises one,
 * and short enough that it never feels like a wait.
 */
const SETTLE_MS = 550;

export const LessonCoach: React.FC<Props> = ({ activeTool, visible }) => {
  const { muted } = useSyncExternalStore(
    learnState.subscribe,
    learnState.getSnapshot,
    learnState.getSnapshot
  );
  const objectCount = useStore((s) => Object.keys(s.objects).length);

  /** The lesson currently on screen, which lags the tool by `SETTLE_MS`. */
  const [shown, setShown] = useState<Lesson | null>(null);
  /**
   * The board as it was when this lesson appeared.
   *
   * The retirement test is "did anything get made while this was up", and the
   * only honest way to ask it is to remember the count at the moment it went
   * up. A bare `objectCount > 0` would retire every lesson instantly on a board
   * that already has work on it, which is most boards.
   */
  const countAtShow = useRef(0);

  const candidate = lessonForTool(activeTool);
  const candidateId = candidate && !learnState.isLearned(candidate.id) ? candidate.id : null;

  useEffect(() => {
    if (muted || !candidateId) {
      setShown(null);
      return;
    }
    const t = window.setTimeout(() => {
      countAtShow.current = Object.keys(useStore.getState().objects).length;
      setShown(lessonForTool(activeTool) ?? null);
    }, SETTLE_MS);
    return () => window.clearTimeout(t);
  }, [candidateId, muted, activeTool]);

  /**
   * Learned by doing.
   *
   * One new object while the lesson is up is the proof that the gesture was
   * performed. It is deliberately loose: the alternative is every tool
   * reporting its own success, which would be sixteen call sites to keep in
   * step for a feature whose worst failure is showing a hint one extra time.
   */
  useEffect(() => {
    if (!shown) return;
    if (objectCount > countAtShow.current) {
      learnState.learn(shown.id);
      setShown(null);
    }
  }, [objectCount, shown]);

  /** Escape puts it away without teaching anything, and without muting. */
  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const el = document.activeElement?.tagName;
      if (el === 'INPUT' || el === 'TEXTAREA') return;
      setShown(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shown]);

  if (!visible || !shown) return null;

  const key = keyFor(shown);

  return (
    <aside className="coach" role="note" aria-label={shown.title}>
      {shown.demo && <LessonDemo demo={shown.demo} />}

      <div className="coach__body">
        <div className="coach__head">
          <h2 className="coach__title">{shown.title}</h2>
          {/* The binding, from `TOOL_SHORTCUTS` rather than from a string
              here. A lesson that wrote its own key would be the surface a
              confused person reaches for and the one least likely to be
              updated when a key moves. */}
          {key && <kbd className="coach__key">{key}</kbd>}
        </div>

        <p className="coach__gist">{shown.gist}</p>

        {/* Two only, on the canvas. The full list is in the reference, and a
            five-step panel over a board somebody is working on is a dialog
            pretending not to be one. */}
        <ul className="coach__steps">
          {shown.steps.slice(0, 2).map((step) => (
            <li key={step.act} className="coach__step">
              <span className="coach__act">{step.act}</span>
              <span className="coach__gives">{step.gives}</span>
            </li>
          ))}
        </ul>

        <div className="coach__foot">
          {/* Not "Got it". Pressing that is a claim about the future, and the
              honest offer here is the one about every other hint as well. */}
          <button type="button" className="coach__mute" onClick={() => learnState.mute()}>
            Stop showing tips
          </button>
          <span className="coach__more">
            Press <kbd>?</kbd> for the rest
          </span>
        </div>
      </div>

      <button
        type="button"
        className="coach__close"
        onClick={() => setShown(null)}
        aria-label="Dismiss this tip"
        data-tooltip="Dismiss"
      >
        <X size={13} />
      </button>
    </aside>
  );
};

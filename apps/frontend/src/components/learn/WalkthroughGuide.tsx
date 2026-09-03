import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Check, X } from 'lucide-react';
import { useStore } from '../../hooks/useStore';
import { walkthroughState } from '../../engine/learn/walkthroughState';
import { lessonOf, stepCopy } from '../../engine/learn/walkthrough';
import { anchorBox, onScreen } from '../../engine/learn/walkAnchor';
import { ringPath } from '../../engine/learn/tourSketch';
import { cameraSystem } from '../../engine/CameraSystem';
import { engineEvents } from '../../engine/EventBus';
import { keyFor } from '../../engine/learn/lessons';
import type { Box } from '../../engine/learn/tour';

/**
 * A lesson performed one gesture at a time.
 *
 * ## What this does that `LessonCoach` does not
 *
 * The coach mark shows a whole lesson at once and retires it when *any* new
 * object appears. That is the right trade for a hint you did not ask for —
 * it costs one glance and it is deliberately loose about what counts. It is
 * the wrong shape for actually learning a gesture: reading "click once per
 * corner, then press Enter" is not the same as having done it, and drawing a
 * rectangle should not count as having learned to route a line.
 *
 * This shows one step, and moves on **only when that step's own gesture has
 * been observed in the document**. There is no Next button, and its absence is
 * the design rather than an omission: a Next button lets somebody finish a
 * walkthrough having performed none of it, which makes the completion mark a
 * lie and the whole feature decoration. Every advance here is evidence.
 *
 * ## Why it points at the board and not at the dock
 *
 * The step you have just completed produced something, and that something is
 * the subject of the next sentence. A card that says "drop an end in the
 * middle of an object" while sitting above the dock is asking the reader to
 * find the object; a ring round the connector they just made is telling them.
 *
 * The conversion from a world position to a place on screen goes through
 * `walkAnchor`, tested, because it is the arithmetic invariant 10 exists for
 * and it has already been wrong once in this codebase for the life of the
 * feature that contained it. When the subject is off screen — panned away, or
 * behind a panel — there is no ring and the card falls back to the dock, since
 * pointing at nothing is a worse claim than not pointing.
 *
 * ## Why the ring is drawn rather than a border
 *
 * `TourGuide` makes this argument and it holds here: everything on this screen
 * is a rectangle with a shadow, so one more of those competes with the controls
 * it is annotating. A pen mark from the product's own `rough.ts` cannot be
 * mistaken for something to press, and this canvas already draws that way.
 */

/** How long the completed step stays up before the next one replaces it. */
const BEAT_MS = 620;

interface Props {
  /** Selected ids, straight from `Room` — one of the things a step can observe. */
  selectedIds: readonly string[];
  /** Hidden with the rest of the chrome in focus mode. */
  visible: boolean;
}

export const WalkthroughGuide: React.FC<Props> = ({ selectedIds, visible }) => {
  const { walk, index, before } = useSyncExternalStore(
    walkthroughState.subscribe,
    walkthroughState.getSnapshot,
    walkthroughState.getSnapshot
  );

  const objects = useStore((s) => s.objects);

  /**
   * The step that has just been satisfied, held for one beat.
   *
   * Advancing the instant the gesture lands replaces the words under the
   * reader's eye at the moment they look up from having done the thing, so the
   * confirmation they get is a different sentence appearing. Holding the
   * finished step with a tick for half a second is the acknowledgement, and it
   * is the only animation here.
   */
  const [struck, setStruck] = useState<number | null>(null);
  const beat = useRef<number | undefined>(undefined);

  /**
   * The observation, run on every document change.
   *
   * In an effect rather than during render because it *writes* — advancing is
   * a state change, and a store commit inside a render body is the loop this
   * codebase has hit before. The dependencies are the two things a step can be
   * about: what is on the board, and what is selected.
   */
  useEffect(() => {
    if (!walk || !before) return;
    const advanced = walkthroughState.observe({ objects, selected: selectedIds });
    if (!advanced) return;
    setStruck(index);
    window.clearTimeout(beat.current);
    beat.current = window.setTimeout(() => setStruck(null), BEAT_MS);
  }, [objects, selectedIds, walk, before, index]);

  useEffect(() => () => window.clearTimeout(beat.current), []);

  /* ----------------------------------------------------------- the anchor */

  const [ring, setRing] = useState<Box | null>(null);

  /**
   * Where to point, recomputed as the camera moves.
   *
   * The subject is the newest object the walkthrough is responsible for: what
   * was not on the board when the step began. On the first step there is
   * nothing yet, which is correct — there is nothing to point at until the
   * reader has made something.
   *
   * `engineEvents` carries the camera, and the rAF loop that applies it does
   * not re-render this tree by design. So the ring is refreshed on the camera's
   * own event rather than on a frame of its own: a second loop here would be
   * the per-frame cost the presence layer was rebuilt to remove.
   */
  useLayoutEffect(() => {
    if (!walk || !before) {
      setRing(null);
      return;
    }

    const measure = () => {
      const fresh = Object.entries(objects).filter(([id]) => !before.ids.has(id));
      const subject = fresh[fresh.length - 1]?.[1];
      const stage = document.querySelector('.konvajs-content')?.getBoundingClientRect();
      if (!subject || !stage) {
        setRing(null);
        return;
      }
      const box = anchorBox(
        { x: subject.x, y: subject.y, width: subject.width, height: subject.height },
        { x: cameraSystem.x, y: cameraSystem.y, zoom: cameraSystem.zoom },
        // The stage origin, which is what stops this being a stage coordinate
        // used as a window one. See `walkAnchor`.
        { x: stage.left, y: stage.top }
      );
      setRing(onScreen(box, { width: window.innerWidth, height: window.innerHeight }) ? box : null);
    };

    measure();
    window.addEventListener('resize', measure);
    // The camera is applied outside React, so `CameraChanged` on the engine's
    // own bus is how a DOM overlay hears a pan or a zoom. `off` is returned by
    // `on`, so the listener cannot be left behind.
    const stop = engineEvents.on('CameraChanged', measure);
    return () => {
      window.removeEventListener('resize', measure);
      stop();
    };
  }, [walk, before, index, objects]);

  if (!visible || !walk) return null;

  const lesson = lessonOf(walk);
  const copy = stepCopy(walk, index);
  if (!lesson || !copy) return null;

  const key = keyFor(lesson);
  const done = struck !== null;

  return (
    <>
      {/* The ring, in the product's own pen. Purely decorative to a reader
          using a screen reader — the card carries the whole instruction — so
          it is hidden from the tree rather than described. */}
      {ring && (
        <svg className="walk-ring" aria-hidden width="100%" height="100%">
          {/* The raw box, not a padded one: `ringPath` adds its own standoff,
              and passing it an already-padded box draws the ring twice as far
              out as every other ring in the product. */}
          <path className="walk-ring__path" d={ringPath(ring, `${walk.lesson}-${index}`)} />
        </svg>
      )}

      <aside
        className="walk"
        role="note"
        aria-live="polite"
        aria-label={`${lesson.title}, step ${index + 1} of ${walk.steps.length}`}
      >
        <div className="walk__body">
          <div className="walk__head">
            <h2 className="walk__title">{lesson.title}</h2>
            {key && <kbd className="walk__key">{key}</kbd>}
          </div>

          {/*
            One step, not the list. The list is what the coach mark and the
            reference are for; a walkthrough that shows every step at once is
            a coach mark that also happens to count.
          */}
          <p className={done ? 'walk__act walk__act--done' : 'walk__act'}>
            {done && <Check size={13} aria-hidden />}
            {copy.act}
          </p>
          <p className="walk__gives">{copy.gives}</p>

          <div className="walk__foot">
            {/*
              Progress as pips rather than "3 of 5". A count invites the
              question of how long this will take, which is the question a
              walkthrough wants nobody asking; a short row of marks answers it
              without being asked.
            */}
            <ol className="walk__pips" aria-hidden>
              {walk.steps.map((s, i) => (
                <li
                  key={s.step}
                  className="walk__pip"
                  data-state={i < index ? 'done' : i === index ? 'now' : 'todo'}
                />
              ))}
            </ol>
            <span className="walk__hint">Do it on the board to continue</span>
          </div>
        </div>

        <button
          type="button"
          className="walk__close"
          onClick={() => walkthroughState.stop()}
          aria-label="Leave this walkthrough"
          data-tooltip="Leave"
        >
          <X size={13} />
        </button>
      </aside>
    </>
  );
};

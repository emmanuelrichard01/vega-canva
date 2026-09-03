import { digest, satisfied, walkthroughFor, type Digest, type Snapshot, type Walkthrough } from './walkthrough';
import { learnState } from './learnState';

/**
 * Which walkthrough is running, how far through, and what the board looked
 * like when the current step began.
 *
 * ## Why the digest lives here and not in the component
 *
 * It is the one piece of state that must be captured at an exact moment —
 * the instant a step becomes current — and a component that re-renders on
 * every document change has no reliable way to say "that moment". Held in a
 * `useRef` it would survive re-renders and *not* survive the component
 * unmounting, which is what focus mode and a panel toggle both do; held in
 * state it would be a render behind the change it is measuring.
 *
 * Here it is written in exactly two places, both of which are the definition
 * of a step beginning: starting a walkthrough, and advancing to the next step.
 *
 * ## Why finishing a walkthrough retires the lesson
 *
 * `learnState` already distinguishes a lesson *shown* from a lesson *learned*,
 * and retires it on the evidence that its gesture was performed. Somebody who
 * has completed the walkthrough has performed every gesture in it, observed
 * one at a time, which is strictly better evidence than the coach mark's own
 * "one new object appeared". So it says so, and the coach mark for that lesson
 * stops appearing — otherwise finishing the walkthrough for connectors would
 * be followed by a card offering to teach connectors.
 *
 * ## What is not persisted, and why
 *
 * Only which walkthroughs have been *completed*. Not the step you were on: a
 * reload mid-walkthrough should land you on the board rather than three steps
 * into something you were halfway through when the page fell over, which is
 * the argument `tourState` makes and it holds here for the same reason. And
 * never in the CRDT — what you have been taught is a fact about you, not about
 * the board.
 */

const DONE_KEY = 'vega_walkthroughs_v1';

interface State {
  /** The walkthrough being performed, or null. */
  walk: Walkthrough | null;
  /** Which of its steps is current. */
  index: number;
  /** The board as it was when that step began. */
  before: Digest | null;
  /** Lesson ids whose walkthrough has been completed. */
  done: readonly string[];
}

type Listener = () => void;
const listeners = new Set<Listener>();

function readDone(): readonly string[] {
  try {
    const raw = localStorage.getItem(DONE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    // Filtered against the real table, so a walkthrough that was renamed or
    // removed cannot leave a permanent ghost in somebody's storage.
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string' && Boolean(walkthroughFor(id)))
      : [];
  } catch {
    // Private browsing, a full quota, or a blocked store. Offering a
    // walkthrough twice is a smaller failure than throwing on first render.
    return [];
  }
}

let state: State = { walk: null, index: 0, before: null, done: readDone() };

function commit(next: State) {
  state = next;
  listeners.forEach((fn) => fn());
}

function persist(done: readonly string[]) {
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify(done));
  } catch {
    // Kept in memory for this session, which is what the surfaces read.
  }
}

export const walkthroughState = {
  getSnapshot: (): State => state,

  subscribe: (listener: Listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  isDone: (lessonId: string): boolean => state.done.includes(lessonId),

  /**
   * Begin, from the board as it stands.
   *
   * The snapshot is taken here rather than on the first observation, because
   * anything already on the board must not count toward the first step. Start
   * a connector walkthrough on a board that already has connectors on it and
   * the first step would otherwise be complete before it was read.
   */
  start(lessonId: string, snapshot: Snapshot) {
    const walk = walkthroughFor(lessonId);
    if (!walk) return;
    commit({ ...state, walk, index: 0, before: digest(snapshot.objects) });
  },

  /**
   * Look at the board and advance if the current step's gesture has happened.
   *
   * Returns whether it advanced, so the caller can react to the moment rather
   * than diffing the state it was just handed. Called on every document
   * change; the work is one pass over the objects that changed hands, which is
   * the same order the renderer is already doing.
   */
  observe(snapshot: Snapshot): boolean {
    const { walk, index, before } = state;
    if (!walk || !before) return false;
    const step = walk.steps[index];
    if (!step || !satisfied(step.observe, before, snapshot)) return false;

    const next = index + 1;
    if (next >= walk.steps.length) {
      /**
       * Finished. The lesson is retired on the way out, because every gesture
       * in it has now been observed — better evidence than the coach mark
       * accepts, so it would be strange for the card to keep offering.
       */
      learnState.learn(walk.lesson);
      const done = state.done.includes(walk.lesson) ? state.done : [...state.done, walk.lesson];
      persist(done);
      commit({ walk: null, index: 0, before: null, done });
      return true;
    }

    // A new step begins, so a new digest. Without this the second step would
    // be measured against the board as it was before the first, and anything
    // the first step created would count toward it.
    commit({ ...state, index: next, before: digest(snapshot.objects) });
    return true;
  },

  /**
   * Leave without finishing, and without recording it as done.
   *
   * Deliberately not the same as completing it: somebody who stops halfway has
   * not performed the gestures, and marking it done would take the walkthrough
   * off the shelf on the strength of them having opened it.
   */
  stop() {
    if (!state.walk) return;
    commit({ ...state, walk: null, index: 0, before: null });
  },
};

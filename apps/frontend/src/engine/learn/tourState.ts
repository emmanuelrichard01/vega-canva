import { TOUR } from './tour';

/**
 * Whether the walkthrough is running, and how far through.
 *
 * ## Why a store and not component state
 *
 * Three surfaces start it -- the offer on a first run, the reference panel's
 * footer, and the command palette -- and none of them owns it. Held in whichever
 * component happened to render the tour, every one of those would need a
 * callback threaded down to it, which is how a small feature ends up touching
 * six files' prop types.
 *
 * ## Why `seen` and `running` are separate
 *
 * `seen` is whether this browser has ever been offered the tour, which is the
 * only thing worth persisting. Whether it is running right now is not: a reload
 * mid-tour should land you on the board, not back at step three of a
 * walkthrough you were halfway through when the page fell over.
 *
 * Never in the CRDT, for the same reason `learnState` is not: which parts of
 * the furniture *you* have been shown is a fact about you, and putting it on
 * the board would run a collaborator's tour because you finished yours.
 */

const SEEN_KEY = 'vega_tour_v1';

interface State {
  /** `null` when nothing is running; otherwise the index into `TOUR`. */
  step: number | null;
  /** Whether this browser has been offered the tour before. */
  seen: boolean;
}

type Listener = () => void;

const listeners = new Set<Listener>();

function readSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === 'yes';
  } catch {
    // Private browsing or a blocked store. Offering a tour twice is a smaller
    // failure than throwing on the first render of the board.
    return false;
  }
}

let state: State = { step: null, seen: readSeen() };

function commit(next: State) {
  state = next;
  listeners.forEach((fn) => fn());
}

function remember() {
  try {
    localStorage.setItem(SEEN_KEY, 'yes');
  } catch {
    // Kept in memory for this session, which is what the surfaces read.
  }
}

export const tourState = {
  getSnapshot: (): State => state,

  subscribe: (listener: Listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /**
   * Begin, and record that the offer has been made.
   *
   * Marked seen on *start* rather than on finish, deliberately. Somebody who
   * begins the tour and leaves after two steps has answered the question the
   * offer was asking, and putting it back in front of them next time is the
   * product not listening.
   */
  start() {
    remember();
    commit({ step: 0, seen: true });
  },

  /** Decline the offer without taking it. Same record, no tour. */
  decline() {
    remember();
    commit({ step: null, seen: true });
  },

  next() {
    if (state.step === null) return;
    const to = state.step + 1;
    commit({ ...state, step: to >= TOUR.length ? null : to });
  },

  back() {
    if (state.step === null || state.step === 0) return;
    commit({ ...state, step: state.step - 1 });
  },

  /** Jump straight to a step, for the progress dots. */
  goTo(step: number) {
    if (state.step === null || step < 0 || step >= TOUR.length) return;
    commit({ ...state, step });
  },

  stop() {
    if (state.step === null) return;
    commit({ ...state, step: null });
  },
};

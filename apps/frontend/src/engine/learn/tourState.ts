import { TOUR } from './tour';
import { storageGet, storageGetJson, storageSet } from '../../utils/safeStorage';

/**
 * Whether the tour is running, how far through, and where to pick it up.
 *
 * A store rather than component state because several surfaces start it (the
 * getting-started checklist, Help, the board menu, the command palette) and
 * none of them owns it.
 *
 * ## What is remembered
 *
 * - `seen`: the tour has been offered. Offered once; declining is as final as
 *   accepting.
 * - `resumeAt`: the step somebody left on. Escape or the close button parks
 *   the tour there and the next start picks it up; finishing clears it.
 * - `finished`: the last step was reached, so the next start is from the top.
 *
 * Whether it is running right now is not stored: a reload mid-tour lands on the
 * board, and the next start resumes.
 *
 * Never in the CRDT. What *you* have been shown is a fact about you, and on the
 * board it would run a collaborator's tour because you finished yours.
 */

const KEY = 'vega_tour_v2';
/** The previous record: `'yes'` once the offer had been answered. */
const LEGACY_KEY = 'vega_tour_v1';

export interface TourSnapshot {
  /** `null` when nothing is running; otherwise the index into `TOUR`. */
  step: number | null;
  /** Whether this browser has been offered the tour. */
  seen: boolean;
  /** Where a stopped tour picks up, or `null` when there is nothing to resume. */
  resumeAt: number | null;
  /** Whether the tour has ever been walked to its end. */
  finished: boolean;
}

interface Stored {
  seen?: unknown;
  resumeAt?: unknown;
  finished?: unknown;
}

type Listener = () => void;

const listeners = new Set<Listener>();

const validStep = (n: unknown): number | null =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < TOUR.length ? n : null;

export function readTourRecord(): TourSnapshot {
  const stored = storageGetJson<Stored | null>(KEY, null);
  const legacySeen = storageGet(LEGACY_KEY) === 'yes';
  return {
    step: null,
    seen: stored?.seen === true || legacySeen,
    resumeAt: validStep(stored?.resumeAt),
    finished: stored?.finished === true,
  };
}

let state: TourSnapshot = readTourRecord();

/** Re-read storage, for tests and for another tab's answer. */
export function reloadTourState() {
  state = readTourRecord();
  listeners.forEach((fn) => fn());
}

function commit(next: TourSnapshot) {
  state = next;
  // Kept in memory for the session even when storage refuses the write; the
  // in-memory snapshot is what every surface reads.
  storageSet(KEY, JSON.stringify({ seen: next.seen, resumeAt: next.resumeAt, finished: next.finished }));
  listeners.forEach((fn) => fn());
}

function finish() {
  commit({ ...state, step: null, seen: true, resumeAt: null, finished: true });
}

export const tourState = {
  getSnapshot: (): TourSnapshot => state,

  subscribe: (listener: Listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /** Whether a start would pick up part-way rather than from the top. */
  canResume: (): boolean => state.resumeAt !== null && state.resumeAt > 0,

  /**
   * Begin, or pick up where it was left.
   *
   * Marked seen on start: somebody who begins and leaves after two steps has
   * answered the question the offer was asking.
   */
  start() {
    commit({ ...state, step: state.resumeAt ?? 0, seen: true });
  },

  /** Begin from the first step, whatever was saved. */
  restart() {
    commit({ ...state, step: 0, seen: true, resumeAt: 0 });
  },

  /**
   * The offer was made and not taken. Same record, no tour.
   *
   * Never stops a tour that is running: the checklist calls this when it
   * appears, which can be just after a guided start has begun the tour.
   */
  decline() {
    if (state.seen) return;
    commit({ ...state, seen: true });
  },

  next() {
    if (state.step === null) return;
    const to = state.step + 1;
    if (to >= TOUR.length) finish();
    else commit({ ...state, step: to, resumeAt: to });
  },

  back() {
    if (state.step === null || state.step === 0) return;
    commit({ ...state, step: state.step - 1, resumeAt: state.step - 1 });
  },

  /** Jump straight to a step, for the progress dots and for skipping absent ones. */
  goTo(step: number) {
    if (state.step === null || validStep(step) === null) return;
    commit({ ...state, step, resumeAt: step });
  },

  /** Walked to the end. The next start begins again from the top. */
  finish: () => finish(),

  /** Put it away part-way. The next start resumes here. */
  stop() {
    if (state.step === null) return;
    commit({ ...state, step: null, resumeAt: state.step });
  },
};

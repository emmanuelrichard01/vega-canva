import { LESSONS } from './lessons';

/**
 * Which lessons this person has already been shown, and whether they want any.
 *
 * ## Why `localStorage` and never the document
 *
 * What *you* have been taught is a fact about you, not about the board.
 * `FirstRunGuide` already makes this argument and it is worth repeating because
 * the mistake is so easy: putting it in the CRDT would dismiss a coach mark for
 * every collaborator the moment one person read it, and would grow the update
 * log with a record of who had learned what.
 *
 * ## Why a store rather than a hook reading storage
 *
 * Two surfaces read this at once -- the canvas coach and the reference library,
 * which marks what you already know -- and a lesson retired on the canvas has
 * to grey out in the library on the same frame. Two components each reading
 * `localStorage` in a `useState` initialiser would each hold their own stale
 * copy, which is the ordinary version of the two-derivations bug.
 *
 * ## Why "shown" and "learned" are different
 *
 * A lesson is *shown* when the coach mark appears and *learned* when you go on
 * to actually use the tool. Only the second retires it. That distinction is the
 * whole reason this is worth storing: a coach mark you glanced at and ignored
 * should come back the next time you pick the tool up, and one whose gesture
 * you then performed should not. Advance by doing, which is the pattern the
 * first-run guide already proves out here.
 */

const STORAGE_KEY = 'vega_lessons_v1';
const MUTED_KEY = 'vega_lessons_muted_v1';

interface State {
  /** Lesson ids whose gesture has actually been performed. */
  learned: readonly string[];
  /** No coach marks at all. The library still works. */
  muted: boolean;
}

type Listener = () => void;

const listeners = new Set<Listener>();

/** The ids that exist today, so storage cannot resurrect a deleted lesson. */
const KNOWN = new Set(LESSONS.map((l) => l.id));

function read(): State {
  if (typeof localStorage === 'undefined') return { learned: [], muted: false };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      // Filtered against the real list, so a lesson that was renamed or
      // removed cannot leave a permanent ghost in somebody's storage.
      learned: Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === 'string' && KNOWN.has(id))
        : [],
      muted: localStorage.getItem(MUTED_KEY) === 'yes',
    };
  } catch {
    // Private browsing, a full quota, or a policy that blocks storage. Coaching
    // that throws is worse than coaching that repeats.
    return { learned: [], muted: false };
  }
}

/**
 * The snapshot, held rather than rebuilt.
 *
 * `useSyncExternalStore` compares by identity and calls `getSnapshot` on every
 * render, so parsing storage in there would hand React a new array each time
 * and re-render for ever. This is the same shape every other external store in
 * the codebase uses.
 */
let state: State = read();

function commit(next: State) {
  state = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next.learned));
    localStorage.setItem(MUTED_KEY, next.muted ? 'yes' : 'no');
  } catch {
    // Kept in memory for this session even when it cannot be written. The
    // in-memory value is what the surfaces actually read.
  }
  listeners.forEach((fn) => fn());
}

export const learnState = {
  getSnapshot: (): State => state,

  subscribe: (listener: Listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  isLearned: (id: string): boolean => state.learned.includes(id),

  /** Retire a lesson, because its gesture has now been performed. */
  learn(id: string) {
    if (!KNOWN.has(id) || state.learned.includes(id)) return;
    commit({ ...state, learned: [...state.learned, id] });
  },

  /**
   * Stop offering coach marks entirely.
   *
   * One control, not one per lesson. Somebody dismissing the third of these has
   * told you something about all of them, and making them dismiss twelve is the
   * product not listening.
   */
  mute() {
    if (state.muted) return;
    commit({ ...state, muted: true });
  },

  unmute() {
    if (!state.muted) return;
    commit({ ...state, muted: false });
  },

  /** Everything back to unlearned, for the reference library's own control. */
  reset() {
    commit({ learned: [], muted: false });
  },
};

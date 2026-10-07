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
const DISMISSED_KEY = 'vega_lessons_dismissed_v1';
const SHOWN_KEY = 'vega_lessons_shown_v1';

/**
 * How many times a coach mark may appear without being acted on.
 *
 * Two, and then it stays in the library. A hint that returns on every arming of
 * the tool until you happen to make something is the nagging this product
 * promises not to do; once is too few, because the first appearance is often
 * while the pointer is somewhere else.
 */
export const MAX_SHOWS = 2;

interface State {
  /** Lesson ids whose gesture has actually been performed. */
  learned: readonly string[];
  /** No coach marks at all. The library still works. */
  muted: boolean;
  /** Lesson ids the person asked never to be shown again. Not the same as learned. */
  dismissed: readonly string[];
  /** How many times each coach mark has appeared. */
  shown: Readonly<Record<string, number>>;
}

const EMPTY: State = { learned: [], muted: false, dismissed: [], shown: {} };

type Listener = () => void;

const listeners = new Set<Listener>();

/** The ids that exist today, so storage cannot resurrect a deleted lesson. */
const KNOWN = new Set(LESSONS.map((l) => l.id));

function read(): State {
  if (typeof localStorage === 'undefined') return EMPTY;
  try {
    // Filtered against the real list, so a lesson that was renamed or removed
    // cannot leave a permanent ghost in somebody's storage.
    const ids = (key: string): string[] => {
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === 'string' && KNOWN.has(id))
        : [];
    };
    const rawShown = localStorage.getItem(SHOWN_KEY);
    const parsedShown = rawShown ? JSON.parse(rawShown) : null;
    const shown: Record<string, number> = {};
    if (parsedShown && typeof parsedShown === 'object' && !Array.isArray(parsedShown)) {
      for (const [id, n] of Object.entries(parsedShown)) {
        if (KNOWN.has(id) && typeof n === 'number' && n > 0) shown[id] = Math.floor(n);
      }
    }
    return {
      learned: ids(STORAGE_KEY),
      muted: localStorage.getItem(MUTED_KEY) === 'yes',
      dismissed: ids(DISMISSED_KEY),
      shown,
    };
  } catch {
    // Private browsing, a full quota, or a policy that blocks storage. Coaching
    // that throws is worse than coaching that repeats.
    return EMPTY;
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
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(next.dismissed));
    localStorage.setItem(SHOWN_KEY, JSON.stringify(next.shown));
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

  /**
   * Whether the coach mark should stop appearing: the gesture has been done,
   * the person said never, or it has been shown as often as it is allowed to
   * be. The library is unaffected by any of the three.
   */
  isRetired: (id: string): boolean =>
    state.learned.includes(id) || state.dismissed.includes(id) || (state.shown[id] ?? 0) >= MAX_SHOWS,

  /** The coach mark for this lesson has just appeared. */
  noteShown(id: string) {
    if (!KNOWN.has(id)) return;
    commit({ ...state, shown: { ...state.shown, [id]: (state.shown[id] ?? 0) + 1 } });
  },

  /** "Do not show this one again": this lesson only, and forever. */
  dismiss(id: string) {
    if (!KNOWN.has(id) || state.dismissed.includes(id)) return;
    commit({ ...state, dismissed: [...state.dismissed, id] });
  },

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

  /**
   * Back on. There is deliberately no "forget what I have learned" beside it:
   * that was a button in the reference footer, it quietly unmuted as a side
   * effect, and what it gave back was a coach mark for a lesson the library
   * already shows in full with its drawing.
   */
  unmute() {
    if (!state.muted) return;
    commit({ ...state, muted: false });
  },
};

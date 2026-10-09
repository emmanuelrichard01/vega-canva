/**
 * The show: one presentation's state, and the commands that change it.
 *
 * The presenter on the board, the presenter view (in a second window or split
 * on this screen) and the keyboard all speak these commands, and only
 * `reduceShow` decides what they do. So "next" from the presenter view, a
 * click on the slide and the right arrow cannot drift apart, and the rules
 * (blanking clears on a move, a jump past the end clamps, the timer pauses
 * and resumes) are tested once, here, without a browser.
 *
 * The store is a module singleton read through `useSyncExternalStore`. The
 * presenter view in a second window is rendered by this window into that one,
 * so both read this same object: there is no message to lose and no second
 * copy of the board.
 */

export type Blank = 'black' | 'white' | null;

export interface ShowState {
  active: boolean;
  /** The playable slides, in order. */
  ids: string[];
  index: number;
  blank: Blank;
  /** A held or toggled laser pointer. */
  laser: boolean;
  /** Elapsed-time clock: when it last started, and what it had banked before. */
  timer: { runningSince: number | null; banked: number };
  /** Whether the room has been invited to follow. */
  everyone: boolean;
}

export type ShowCommand =
  | { type: 'start'; ids: string[]; index: number; now: number; everyone?: boolean }
  | { type: 'stop' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'first' }
  | { type: 'last' }
  /** By position in `ids`. */
  | { type: 'goto'; index: number }
  /** By the number a person typed, 1-based. */
  | { type: 'goto-number'; number: number }
  | { type: 'goto-id'; id: string }
  /** The deck changed under the show: keep the current slide if it survived. */
  | { type: 'deck'; ids: string[] }
  | { type: 'blank'; blank: Exclude<Blank, null> }
  | { type: 'unblank' }
  | { type: 'laser'; on: boolean }
  | { type: 'timer-toggle'; now: number }
  | { type: 'timer-reset'; now: number }
  | { type: 'everyone'; on: boolean };

export const IDLE_SHOW: ShowState = {
  active: false,
  ids: [],
  index: 0,
  blank: null,
  laser: false,
  timer: { runningSince: null, banked: 0 },
  everyone: false,
};

const clamp = (i: number, n: number) => Math.max(0, Math.min(Math.max(0, n - 1), i));

/** Move to `index`, clearing a blank screen: moving on is how a presenter comes back. */
function moveTo(state: ShowState, index: number): ShowState {
  const next = clamp(index, state.ids.length);
  if (next === state.index && state.blank === null) return state;
  return { ...state, index: next, blank: null };
}

export function reduceShow(state: ShowState, cmd: ShowCommand): ShowState {
  if (cmd.type === 'start') {
    if (cmd.ids.length === 0) return state;
    return {
      ...IDLE_SHOW,
      active: true,
      ids: [...cmd.ids],
      index: clamp(cmd.index, cmd.ids.length),
      timer: { runningSince: cmd.now, banked: 0 },
      everyone: cmd.everyone === true,
    };
  }
  if (!state.active) return state;

  switch (cmd.type) {
    case 'stop':
      return IDLE_SHOW;
    case 'next':
      return moveTo(state, state.index + 1);
    case 'previous':
      return moveTo(state, state.index - 1);
    case 'first':
      return moveTo(state, 0);
    case 'last':
      return moveTo(state, state.ids.length - 1);
    case 'goto':
      return Number.isFinite(cmd.index) ? moveTo(state, Math.round(cmd.index)) : state;
    case 'goto-number':
      return Number.isFinite(cmd.number) && cmd.number >= 1 ? moveTo(state, Math.round(cmd.number) - 1) : state;
    case 'goto-id': {
      const at = state.ids.indexOf(cmd.id);
      return at < 0 ? state : moveTo(state, at);
    }
    case 'deck': {
      if (cmd.ids.length === 0) return IDLE_SHOW;
      const current = state.ids[state.index];
      const kept = current ? cmd.ids.indexOf(current) : -1;
      // The current slide was removed or skipped: stay at the same place in the deck.
      const index = kept >= 0 ? kept : clamp(state.index, cmd.ids.length);
      const same = cmd.ids.length === state.ids.length && cmd.ids.every((id, i) => id === state.ids[i]);
      return same && index === state.index ? state : { ...state, ids: [...cmd.ids], index };
    }
    case 'blank':
      return { ...state, blank: state.blank === cmd.blank ? null : cmd.blank };
    case 'unblank':
      return state.blank === null ? state : { ...state, blank: null };
    case 'laser':
      return state.laser === cmd.on ? state : { ...state, laser: cmd.on };
    case 'timer-toggle': {
      const { runningSince, banked } = state.timer;
      return {
        ...state,
        timer:
          runningSince === null
            ? { runningSince: cmd.now, banked }
            : { runningSince: null, banked: banked + Math.max(0, cmd.now - runningSince) },
      };
    }
    case 'timer-reset':
      return { ...state, timer: { runningSince: state.timer.runningSince === null ? null : cmd.now, banked: 0 } };
    case 'everyone':
      return state.everyone === cmd.on ? state : { ...state, everyone: cmd.on };
    default:
      return state;
  }
}

/** Milliseconds on the presenter's clock at `now`. */
export function elapsed(state: ShowState, now: number): number {
  const { runningSince, banked } = state.timer;
  return banked + (runningSince === null ? 0 : Math.max(0, now - runningSince));
}

/** `m:ss`, or `h:mm:ss` past the hour. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

let state: ShowState = IDLE_SHOW;
const listeners = new Set<() => void>();

export const show = {
  getSnapshot: (): ShowState => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  dispatch(cmd: ShowCommand): ShowState {
    const next = reduceShow(state, cmd);
    if (next !== state) {
      state = next;
      listeners.forEach((fn) => fn());
    }
    return state;
  },
};

/** The id of the slide on screen, or undefined when nothing is being shown. */
export function currentSlideId(s: ShowState = state): string | undefined {
  return s.active ? s.ids[s.index] : undefined;
}

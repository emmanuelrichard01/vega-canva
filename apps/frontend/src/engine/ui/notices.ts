/**
 * Everything the application says to the person using it.
 *
 * ## What this replaces, and why it had to be one thing
 *
 * There were five surfaces for telling someone something, and they had drifted
 * into disagreeing:
 *
 * - a transient toast above the dock (`canvas-notice`), one at a time, where a
 *   second message silently destroyed the first;
 * - a dismissible receipt below the header (`restore-notice`), with its own
 *   geometry, its own dismissal rule and its own idea of an error;
 * - an offline banner written in **fifteen inline style properties**, which
 *   `DESIGN.md` forbids for the reason it forbids all of them — it bypasses the
 *   token roles and does not move when the theme does;
 * - the sync dot in the header;
 * - a visually-hidden live region announcing the connection.
 *
 * Two of those said the same sentence in different words four inches apart —
 * the dot's tooltip read *"Offline. Changes are saved on this device"* while
 * the banner read *"Working Offline. Changes will sync automatically."* That is
 * invariant 7 in prose, and this codebase has already made exactly this call
 * once, in the radar: *"two statements of one fact four inches apart have to be
 * kept in step and one of them will not be."*
 *
 * ## The distinction that collapses five surfaces into two
 *
 * **An event is something that happened. A state is something that is true.**
 *
 * Being offline is a state. It does not begin and end at a moment you want to
 * be told about, it persists, and it is *already visible* in the header. A
 * banner parked over the canvas for the whole time it lasts is a notification
 * that cannot be dismissed and does not need to be read twice — so it is not a
 * notification at all, it is a badly-placed status light.
 *
 * A paste producing nine objects is an event. It happened once, it is worth one
 * sentence, and the sentence should leave.
 *
 * So: states live in the header indicator, which is always there and says more
 * when there is more to say. Events live here, and they are all the same kind
 * of thing whether they came from a paste, an export or a restore.
 *
 * ## Severity decides lifetime, and the caller does not
 *
 * The old `showToast` gave every message 3200ms, which is right for "Pasted 3
 * objects" and wrong for "That SVG could not be read" — the second one is the
 * only one you needed to read, and it was gone in the same three seconds while
 * you were still looking at the canvas to see what had happened. An error you
 * did not finish reading is an error you did not read, so errors stay until
 * they are dismissed. Callers pick a tone, which they know; they do not pick a
 * duration, which they would each get slightly wrong.
 */

export type NoticeTone = 'info' | 'success' | 'warning' | 'error';

export interface NoticeAction {
  label: string;
  run: () => void;
}

export interface Notice {
  id: string;
  tone: NoticeTone;
  message: string;
  /**
   * One optional thing to do about it.
   *
   * Deliberately one. A notice with two buttons is a dialog that forgot to be
   * modal, and the second button is always the one nobody presses.
   */
  action?: NoticeAction;
  /** When it should leave, as a timestamp. `null` means it stays until dismissed. */
  expiresAt: number | null;
  /** When it arrived, for ordering and for the repeat rule below. */
  createdAt: number;
  /**
   * How many times this same message has arrived in a row.
   *
   * Shown as a count rather than as a stack of identical rows. Pressing paste
   * four times on a malformed SVG should say the same thing once, with a "x4",
   * rather than filling the corner with four copies of it — which is both
   * noisier and less informative, since the useful fact is that it kept
   * happening.
   */
  repeats: number;
}

/**
 * How long each tone stays, in milliseconds. `null` is "until dismissed".
 *
 * Warnings get longer than confirmations because they are usually a *partial*
 * success — "Placed 9, 3 did not fit" — and the part you need is the second
 * half of the sentence.
 */
export const NOTICE_LIFETIME: Record<NoticeTone, number | null> = {
  info: 3200,
  success: 3200,
  warning: 6000,
  error: null,
};

/**
 * How many are shown at once.
 *
 * Three, because the fourth is never read: by the time a stack is that tall it
 * is a log, and a log belongs somewhere you can scroll. When a fourth arrives
 * the oldest *dismissible* one goes — never an error, which is the one thing in
 * the stack that was waiting for a person rather than for a timer.
 */
export const MAX_VISIBLE = 3;

/** Two of the same message inside this window are one message with a count. */
const REPEAT_WINDOW = 8000;

export interface NoticeInput {
  message: string;
  tone?: NoticeTone;
  action?: NoticeAction;
  /** Overrides the tone's lifetime. `null` pins it until dismissed. */
  duration?: number | null;
}

let sequence = 0;

/**
 * Add a notice to a list, or fold it into the one already there.
 *
 * Pure, and separated from the store below so the three rules that actually
 * matter — repeats fold, the cap drops the right one, errors are never dropped
 * — can be asserted without timers, a DOM, or a store.
 */
export function pushNotice(list: readonly Notice[], input: NoticeInput, now: number): Notice[] {
  const tone = input.tone ?? 'info';
  const lifetime = input.duration === undefined ? NOTICE_LIFETIME[tone] : input.duration;
  const expiresAt = lifetime === null ? null : now + lifetime;

  /**
   * The same thing said again is the same notice, said again.
   *
   * Matched on message *and* tone: "Placed 9 images" arriving as a success and
   * later as a warning are two different outcomes that happen to share a
   * sentence, and folding them would hide the one that mattered.
   */
  const existing = list.findIndex(
    (n) => n.message === input.message && n.tone === tone && now - n.createdAt < REPEAT_WINDOW
  );
  if (existing !== -1) {
    const next = list.slice();
    next[existing] = {
      ...next[existing],
      repeats: next[existing].repeats + 1,
      // The clock restarts: it just happened again, so it has just become
      // relevant again.
      createdAt: now,
      expiresAt,
      action: input.action ?? next[existing].action,
    };
    return next;
  }

  const notice: Notice = {
    id: `notice-${(sequence += 1)}`,
    tone,
    message: input.message,
    action: input.action,
    expiresAt,
    createdAt: now,
    repeats: 1,
  };

  const next = [...list, notice];
  if (next.length <= MAX_VISIBLE) return next;

  /**
   * Over the cap: drop the oldest one that a timer would have taken anyway.
   *
   * Never an error. An error is in the list precisely because it is waiting for
   * a person to see it, and quietly evicting it to make room for "Copied" would
   * mean the noisiest events push out the only one worth reading.
   */
  const victim = next.findIndex((n) => n.expiresAt !== null);
  if (victim === -1) return next.slice(next.length - MAX_VISIBLE);
  next.splice(victim, 1);
  return next;
}

/** Everything still worth showing. */
export function expireNotices(list: readonly Notice[], now: number): Notice[] {
  return list.filter((n) => n.expiresAt === null || n.expiresAt > now);
}

/** Whether anything in this list is waiting on a timer, so a tick is worth running. */
export function hasExpiring(list: readonly Notice[]): boolean {
  return list.some((n) => n.expiresAt !== null);
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

type Listener = () => void;

const listeners = new Set<Listener>();
let notices: Notice[] = [];
let timer: number | undefined;

function emit() {
  listeners.forEach((fn) => fn());
}

/**
 * One timer for the whole list, aimed at whichever notice leaves next.
 *
 * A timeout per notice is the obvious version and it leaks: a notice folded
 * into an earlier one, or evicted by the cap, leaves its timer behind to fire
 * against a list it is no longer in. One timer that is re-aimed on every change
 * has nothing to leak, and re-aiming is a subtraction.
 */
function schedule() {
  window.clearTimeout(timer);
  timer = undefined;
  if (!hasExpiring(notices)) return;

  const now = Date.now();
  const soonest = notices.reduce(
    (min, n) => (n.expiresAt === null ? min : Math.min(min, n.expiresAt)),
    Infinity
  );
  timer = window.setTimeout(() => {
    notices = expireNotices(notices, Date.now());
    emit();
    schedule();
    // A floor, so a notice that expires the instant it arrives — a zero
    // duration from a caller — cannot spin this into a tight loop.
  }, Math.max(16, soonest - now));
}

export const notices$ = {
  getSnapshot: (): Notice[] => notices,

  subscribe: (listener: Listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Say something. Returns the id, so a caller can take it back down early. */
  notify(input: NoticeInput | string): string {
    const normalized = typeof input === 'string' ? { message: input } : input;
    const before = notices;
    notices = pushNotice(notices, normalized, Date.now());
    // The id of whatever this turned into: a new notice, or the one it folded
    // into. Either is the thing the caller would want to dismiss.
    const added = notices.find((n) => !before.includes(n));
    emit();
    schedule();
    return added?.id ?? '';
  },

  dismiss(id: string) {
    const next = notices.filter((n) => n.id !== id);
    if (next.length === notices.length) return;
    notices = next;
    emit();
    schedule();
  },

  clear() {
    if (notices.length === 0) return;
    notices = [];
    emit();
    schedule();
  },
};

/**
 * The shorthand three quarters of the callers want.
 *
 * `notify('Copied')` reads better than the object form at every call site that
 * has nothing to add, and the object form is still there for the ones that do.
 */
export const notify = (input: NoticeInput | string): string => notices$.notify(input);

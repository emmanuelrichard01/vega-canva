import { useSyncExternalStore } from 'react';
import { metadataMap, localAuthorId } from '../document';
import { canEditObjects, canPostComments } from '../model/permissions';
import {
  TIMER_KEY,
  MINUTE_MS,
  addTime,
  idleTimer,
  liveOffset,
  pauseTimer,
  readTimer,
  resumeTimer,
  startTimer,
  writeTimer,
  type TimerState,
} from './workshopTimer';
import {
  VOTE_KEY,
  MAX_VOTES_PER_PERSON,
  clickDot,
  dotsKey,
  dotsPrefix,
  readDots,
  readSession,
  type VoteSession,
} from './vote';

/**
 * The workshop's shared state, read from the document's metadata map.
 *
 * Timer and vote live under `workshop.*` keys in `metadataMap`, so they ride
 * the existing sync, survive a reload and need no schema change. This store
 * only mirrors them for React and holds the one thing that is not shared: the
 * clock offset measured when a timer change arrives live.
 */

export interface WorkshopSnapshot {
  timer: TimerState;
  /** `localNow - writerNow` for the current timer state; 0 when it was loaded cold. */
  offset: number;
  session: VoteSession | null;
  dotsByVoter: Record<string, string[]>;
  mine: string[];
}

const IDLE: TimerState = idleTimer(0);
const listeners = new Set<() => void>();
let offset = 0;
let snapshot: WorkshopSnapshot | null = null;

function read(): WorkshopSnapshot {
  const timer = readTimer(metadataMap.get(TIMER_KEY)) ?? IDLE;
  const session = readSession(metadataMap.get(VOTE_KEY));
  const dotsByVoter: Record<string, string[]> = {};
  if (session) {
    const prefix = dotsPrefix(session.id);
    metadataMap.forEach((value, key) => {
      if (key.startsWith(prefix)) dotsByVoter[key.slice(prefix.length)] = readDots(value);
    });
  }
  const me = localAuthorId();
  return { timer, offset, session, dotsByVoter, mine: dotsByVoter[me] ?? [] };
}

const emit = () => {
  snapshot = null;
  listeners.forEach((fn) => fn());
};

let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  metadataMap.observe((event) => {
    let touched = false;
    event.changes.keys.forEach((_change, key) => {
      if (!key.startsWith('workshop.')) return;
      touched = true;
      if (key === TIMER_KEY && !event.transaction.local) {
        const next = readTimer(metadataMap.get(TIMER_KEY));
        offset = next ? liveOffset(next, Date.now()) : 0;
      }
    });
    if (touched) emit();
  });
}

const subscribe = (fn: () => void) => {
  wire();
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const getWorkshop = (): WorkshopSnapshot => (snapshot ??= read());

export const useWorkshop = (): WorkshopSnapshot => useSyncExternalStore(subscribe, getWorkshop, getWorkshop);

/** Whether this client may run the timer and the vote (the facilitator role is whoever can edit). */
export const canFacilitate = (): boolean => canEditObjects();

function putTimer(state: TimerState) {
  if (!canFacilitate()) return;
  offset = 0; // we are the writer: our clock is the timeline
  metadataMap.set(TIMER_KEY, writeTimer(state));
  emit();
}

export const workshop = {
  timerStart: (ms: number) => putTimer(startTimer(ms, Date.now())),
  timerPause: () => putTimer(pauseTimer(getWorkshop().timer, Date.now(), getWorkshop().offset)),
  timerResume: () => putTimer(resumeTimer(getWorkshop().timer, Date.now())),
  timerAddMinute: () => putTimer(addTime(getWorkshop().timer, MINUTE_MS, Date.now(), getWorkshop().offset)),
  timerReset: () => putTimer(idleTimer(Date.now())),

  voteStart(perPerson: number) {
    if (!canFacilitate()) return;
    const old = getWorkshop().session;
    const session: VoteSession = {
      id: Math.random().toString(36).slice(2, 8),
      perPerson: Math.max(1, Math.min(MAX_VOTES_PER_PERSON, Math.floor(perPerson))),
      by: localAuthorId(),
      startedAt: Date.now(),
      revealed: false,
    };
    metadataMap.doc?.transact(() => {
      if (old) workshop.clearDots(old.id);
      metadataMap.set(VOTE_KEY, JSON.stringify(session));
    });
  },
  voteReveal() {
    const s = getWorkshop().session;
    if (!s || !canFacilitate()) return;
    metadataMap.set(VOTE_KEY, JSON.stringify({ ...s, revealed: true }));
  },
  voteEnd() {
    const s = getWorkshop().session;
    if (!s || !canFacilitate()) return;
    metadataMap.doc?.transact(() => {
      workshop.clearDots(s.id);
      metadataMap.delete(VOTE_KEY);
    });
  },
  clearDots(sessionId: string) {
    const prefix = dotsPrefix(sessionId);
    [...metadataMap.keys()].filter((k) => k.startsWith(prefix)).forEach((k) => metadataMap.delete(k));
  },
  /** Place or take back a dot for this client. Returns whether anything changed. */
  vote(objectId: string): boolean {
    const { session, mine } = getWorkshop();
    if (!session || session.revealed || !canPostComments()) return false;
    const next = clickDot(mine, objectId, session.perPerson);
    if (next.length === mine.length && next.every((id, i) => id === mine[i])) return false;
    metadataMap.set(dotsKey(session.id, localAuthorId()), JSON.stringify(next));
    return true;
  },
};

import { storageGet, storageGetJson, storageRemove, storageSet } from '../../utils/safeStorage';

/**
 * The getting-started checklist: five first moves, each ticked by doing it.
 *
 * ## Why it is ticked by evidence and never by a click
 *
 * A row that can be ticked by pressing it is a to-do list about the product,
 * and finishing it proves nothing. Every item here is satisfied by something
 * the board or the session can observe: a node *you* made after the checklist
 * started watching, a collaborator's arrival, the record button playing.
 * Clicking a row only arms the tool or opens the control that does the thing.
 *
 * ## Why it belongs to the browser, not the board
 *
 * Like `learnState` and `tourState`: what you have done is a fact about you.
 * In the CRDT it would tick a collaborator's list because you drew a line.
 */

export type ChecklistItemId = 'draw' | 'sticky' | 'connect' | 'invite' | 'music';

export interface ChecklistItem {
  id: ChecklistItemId;
  label: string;
  /** What the row does when pressed, said as the button's accessible description. */
  action: string;
  /** The tool the row arms, if pressing it arms one. */
  tool?: string;
}

export const CHECKLIST: readonly ChecklistItem[] = [
  { id: 'draw', label: 'Draw something', action: 'Arms the pen', tool: 'pen' },
  { id: 'sticky', label: 'Add a sticky note', action: 'Arms the sticky note', tool: 'sticky' },
  { id: 'connect', label: 'Connect two shapes', action: 'Arms the connector', tool: 'connector' },
  { id: 'invite', label: 'Invite someone', action: 'Opens Share' },
  { id: 'music', label: 'Try the music', action: 'Opens the player' },
];

const IDS = new Set<string>(CHECKLIST.map((i) => i.id));

/* --------------------------------------------------------------- detection */

/** The few node fields detection reads. Anything in the document satisfies it. */
export interface NodeLike {
  type: string;
  createdBy?: string;
  from?: { nodeId?: string | null } | null;
  to?: { nodeId?: string | null } | null;
}

/**
 * Which document items the board now proves.
 *
 * Only nodes that were not there when watching began (`baseline`) and that
 * `me` created count. A template's stickies, or a collaborator's, are not
 * evidence that *you* added one.
 *
 * - draw: a freehand or vector path, or a shape.
 * - sticky: a sticky note.
 * - connect: a connector with **both** ends attached to something. One loose
 *   end is a line that was drawn, not two shapes that were connected.
 */
export function detectFromDocument(
  objects: Readonly<Record<string, NodeLike>>,
  baseline: ReadonlySet<string>,
  me: string
): ChecklistItemId[] {
  const found = new Set<ChecklistItemId>();
  for (const id in objects) {
    if (baseline.has(id)) continue;
    const node = objects[id];
    if (!node || node.createdBy !== me) continue;
    if (node.type === 'path' || node.type === 'shape') found.add('draw');
    else if (node.type === 'sticky') found.add('sticky');
    else if (node.type === 'connector' && node.from?.nodeId && node.to?.nodeId) found.add('connect');
    if (found.size === 3) break;
  }
  return CHECKLIST.filter((i) => found.has(i.id)).map((i) => i.id);
}

/* ------------------------------------------------------------------- state */

const KEY = 'vega_get_started_v1';
/** Set by the dashboard's guided start, read once by the board it opens. */
const INTENT_KEY = 'vega_get_started_intent';

export interface ChecklistSnapshot {
  /** Items proven so far, in checklist order. */
  done: readonly ChecklistItemId[];
  /** Put away by its close button. Help can bring it back. */
  dismissed: boolean;
  /** Folded down to its progress ring. */
  collapsed: boolean;
}

interface Stored {
  done?: unknown;
  dismissed?: unknown;
  collapsed?: unknown;
}

type Listener = () => void;
const listeners = new Set<Listener>();

const ordered = (ids: Iterable<string>): ChecklistItemId[] => {
  const set = new Set(ids);
  return CHECKLIST.filter((i) => set.has(i.id)).map((i) => i.id);
};

/**
 * Somebody who used the product before the checklist existed.
 *
 * They get it folded to its ring rather than open: discoverable, but not five
 * instructions they followed months ago.
 */
function returning(): boolean {
  return storageGet('vega_tour_v1') === 'yes' || (storageGet('vega_lessons_v1') ?? '[]') !== '[]';
}

export function readChecklist(): ChecklistSnapshot {
  const stored = storageGetJson<Stored | null>(KEY, null);
  if (!stored || typeof stored !== 'object') {
    return { done: [], dismissed: false, collapsed: returning() };
  }
  const done = Array.isArray(stored.done)
    ? ordered(stored.done.filter((id): id is string => typeof id === 'string' && IDS.has(id)))
    : [];
  return { done, dismissed: stored.dismissed === true, collapsed: stored.collapsed === true };
}

let state: ChecklistSnapshot = readChecklist();

function commit(next: ChecklistSnapshot) {
  state = next;
  storageSet(KEY, JSON.stringify(next));
  listeners.forEach((fn) => fn());
}

export const checklistState = {
  getSnapshot: (): ChecklistSnapshot => state,

  subscribe: (listener: Listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  isComplete: (): boolean => state.done.length === CHECKLIST.length,

  /** Record items as done. Returns the ones that were newly ticked. */
  mark(ids: readonly ChecklistItemId[]): ChecklistItemId[] {
    const fresh = ids.filter((id) => IDS.has(id) && !state.done.includes(id));
    if (fresh.length === 0) return [];
    commit({ ...state, done: ordered([...state.done, ...fresh]) });
    return fresh;
  },

  collapse() {
    if (!state.collapsed) commit({ ...state, collapsed: true });
  },

  expand() {
    if (state.collapsed) commit({ ...state, collapsed: false });
  },

  dismiss() {
    if (!state.dismissed) commit({ ...state, dismissed: true });
  },

  /** Bring a dismissed checklist back, open. Progress is kept. */
  reopen() {
    commit({ ...state, dismissed: false, collapsed: false });
  },

  /** Re-read storage, for tests and for another tab's answer. */
  reload() {
    state = readChecklist();
    listeners.forEach((fn) => fn());
  },
};

/* ------------------------------------------------------------------ intent */

export type StartIntent = 'guided';

/** The dashboard asks the next board to open with the guided start. */
export function requestGuidedStart() {
  storageSet(INTENT_KEY, JSON.stringify({ intent: 'guided', at: Date.now() }));
}

/**
 * Read the dashboard's request once, and forget it.
 *
 * Stale after ten minutes, so a guided start that never reached a board (a
 * closed tab, a failed load) does not ambush the next board opened tomorrow.
 */
export function takeStartIntent(now = Date.now()): StartIntent | null {
  const raw = storageGetJson<{ intent?: unknown; at?: unknown } | null>(INTENT_KEY, null);
  storageRemove(INTENT_KEY);
  if (!raw || raw.intent !== 'guided' || typeof raw.at !== 'number') return null;
  return now - raw.at < 10 * 60_000 ? 'guided' : null;
}

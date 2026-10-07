/**
 * The people list, as decisions rather than drawing: who comes first, what to
 * say they are doing, and whether they are somewhere you can already see.
 *
 * Kept apart from `PresenceRoster.tsx` so each rule can be asserted in Node.
 */

import type { ActivityKind, Collaborator } from './collaborators';
import { viewportCenter, type ViewportState } from './PresenceTypes';

/** Every activity gets a word here: you opened this list to ask what someone is doing. */
export const ACTIVITY_WORD: Record<ActivityKind, string> = {
  typing: 'Typing',
  recording: 'Recording',
  drawing: 'Drawing',
  moving: 'Moving objects',
};

export type RosterState = 'active' | 'viewing' | 'idle';

/** What someone is doing, as one of three states and the words for it. */
export function rosterState(person: Pick<Collaborator, 'away' | 'activity'>): { state: RosterState; word: string } {
  if (person.away) return { state: 'idle', word: 'Idle' };
  if (person.activity) return { state: 'active', word: ACTIVITY_WORD[person.activity] };
  return { state: 'viewing', word: 'Viewing' };
}

/**
 * Whoever is doing something first, then whoever is here, then the idle, each
 * group by name. The faces that show in the header are the first few of this
 * order, so they are the people worth following.
 */
export function rosterOrder<T extends Pick<Collaborator, 'away' | 'activity' | 'name'>>(people: readonly T[]): T[] {
  const rank = (p: T) => (p.away ? 2 : p.activity ? 0 : 1);
  return [...people].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** Where this tab's camera is, in the units `ViewportState` uses. */
export interface MyView {
  x: number;
  y: number;
  zoom: number;
  width: number;
  height: number;
}

/**
 * Whether the middle of someone's screen is inside yours.
 *
 * `null` when they have published no viewport yet, so the list says nothing
 * rather than guessing.
 */
export function inMyView(theirs: ViewportState | null, mine: MyView): boolean | null {
  if (!theirs) return null;
  const centre = viewportCenter(theirs);
  const sx = centre.x * mine.zoom + mine.x;
  const sy = centre.y * mine.zoom + mine.y;
  return sx >= 0 && sx <= mine.width && sy >= 0 && sy <= mine.height;
}

/** The camera that puts the middle of someone's screen in the middle of yours, at your zoom. */
export function poseToReach(theirs: ViewportState, mine: MyView): { x: number; y: number; zoom: number } {
  const centre = viewportCenter(theirs);
  return {
    x: mine.width / 2 - centre.x * mine.zoom,
    y: mine.height / 2 - centre.y * mine.zoom,
    zoom: mine.zoom,
  };
}

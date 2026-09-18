/**
 * Audience: who is watching you, and who is asking to be watched.
 *
 * Presence until now was entirely one-directional — you could see everyone
 * else, and nothing anyone else did told you anything about *you*. That is the
 * gap this closes, and it is the gap that makes a board feel like a room
 * rather than a shared file:
 *
 * - **"Two people are following you."** `followMode` already locks a camera to
 *   a leader, and the leader had no idea. So they narrate to nobody, or pan
 *   away from the thing three people are looking at. The follower knows they
 *   are following, so the follower says so (`PresenceState.following`), and
 *   this counts it.
 * - **"Ada is showing something."** The inverse: a way to say *come and look*
 *   without typing "top left, near the blue frame" into a call.
 *
 * Pure, and separate from the React that draws it, for the reason the rest of
 * this directory is: a presence feature needs two live browsers to observe, so
 * whatever can be decided in Node should be (`HANDOFF.md` §3).
 */

import type { Collaborator } from './collaborators';

/**
 * How long an offer to look stands before it lapses.
 *
 * Long enough to finish the sentence that goes with it, short enough that a
 * forgotten spotlight is not a permanent banner. A presenter who still has
 * something to show simply raises it again — which is also the honest signal,
 * because they are still there.
 */
export const SPOTLIGHT_MS = 45_000;

/**
 * Everyone whose camera is locked to `clientId`.
 *
 * `away` people are kept deliberately. Someone who wandered off with their
 * camera still attached is still going to see what happens next, and telling
 * the leader they have no audience when the screens are in fact following
 * would be the more misleading of the two answers.
 */
export function followersOf(list: readonly Collaborator[], clientId: number | undefined): Collaborator[] {
  if (clientId === undefined) return [];
  return list.filter((person) => person.following === clientId);
}

/**
 * The live spotlight, if there is one worth showing.
 *
 * Three things disqualify an offer, in the order they are most likely:
 *
 * 1. **It has lapsed.** A peer whose tab was frozen mid-presentation stops
 *    broadcasting but its last state lingers in awareness, so the timestamp is
 *    checked here rather than trusted.
 * 2. **You are already following them.** You are looking at exactly what they
 *    are showing; an invitation to do so is noise.
 * 3. **Nobody raised one.** The common case, and it costs a `find`.
 *
 * When two people spotlight at once the newest wins, because it is the one
 * that was just said out loud.
 */
export function activeSpotlight(
  list: readonly Collaborator[],
  now: number,
  followingId: number | null
): Collaborator | null {
  let best: Collaborator | null = null;
  for (const person of list) {
    if (!person.spotlightAt) continue;
    if (now - person.spotlightAt > SPOTLIGHT_MS) continue;
    if (person.clientId === followingId) continue;
    if (!best || person.spotlightAt > best.spotlightAt!) best = person;
  }
  return best;
}

/**
 * "Ada", "Ada and Bo", "Ada, Bo and 2 others".
 *
 * Names up to two people and counts the rest. Three names is already a line of
 * text where a number would do, and the point of the sentence is the fact that
 * someone is watching, not the register of who.
 */
export function describeAudience(people: readonly Collaborator[]): string {
  const names = people.map((p) => p.name);
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  const rest = names.length - 2;
  return `${names[0]}, ${names[1]} and ${rest} ${rest === 1 ? 'other' : 'others'}`;
}

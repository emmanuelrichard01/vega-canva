/**
 * The link that opens a board already following somebody.
 *
 * A presenter shares `…/room/abc?follow=<author id>`; whoever opens it lands on
 * the board and their camera attaches to the presenter as soon as the presenter
 * is in the room. The target is the **durable author id**, not the per-tab
 * `clientId`, so the link keeps working when the presenter reloads.
 *
 * Following is only a way of looking. The link adds no access: whatever role
 * the link or the room grants is exactly what the visitor gets.
 */

/** The query parameter. */
export const FOLLOW_PARAM = 'follow';

/** How long a visitor waits for the presenter to be in the room before giving up quietly. */
export const FOLLOW_WAIT_MS = 45_000;

/** `url` with `follow=<authorId>` set, leaving every other part of it alone. */
export function withFollowParam(url: string, authorId: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set(FOLLOW_PARAM, authorId);
  return parsed.toString();
}

/** The author id a location asks to follow, or `null`. */
export function readFollowTarget(search: string): string | null {
  const value = new URLSearchParams(search).get(FOLLOW_PARAM);
  const trimmed = value?.trim();
  // An id is a short opaque string; anything else is somebody's idea of a joke.
  if (!trimmed || trimmed.length > 128) return null;
  return trimmed;
}

/** `search` without the follow parameter, so a reload or a copied address does not follow again. */
export function withoutFollowParam(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(FOLLOW_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}

/** The `clientId` of the person with this author id who is in the room now, if any. */
export function resolveFollowTarget(
  people: ReadonlyArray<{ clientId: number; id: string }>,
  authorId: string
): number | null {
  // Newest tab wins when one person has two open.
  let found: number | null = null;
  for (const person of people) if (person.id === authorId) found = person.clientId;
  return found;
}

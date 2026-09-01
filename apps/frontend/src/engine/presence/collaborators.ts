/**
 * What everyone else is doing, as data — plus the arithmetic three different
 * surfaces need to draw it.
 *
 * Three views answer the same question at three ranges: the **pointer arrow**
 * says where someone is within the screen, the **edge arrow** says which way
 * they are when that is off-screen, and the **radar** says where they are in
 * the document. They used to be three separate readers of awareness with three
 * different ideas of the answer — one interpolated in screen space, one did not
 * interpolate at all, and one was mounted with a hardcoded camera. Now there is
 * one reader (`collaboratorStore`) and this module holds everything about it
 * that is pure.
 *
 * Nothing here imports React, Konva, Yjs or the camera. That is what lets the
 * awkward parts — edge placement, radar framing, which is nearly all of the
 * behaviour that was actually wrong — be tested in Node, which matters here
 * because a presence layer needs two live browsers to observe (`HANDOFF.md` §3).
 */

import type { ViewportState } from './PresenceTypes';

export interface Point {
  x: number;
  y: number;
}

/**
 * What someone is *doing*, as a closed set.
 *
 * This used to be a free string containing an emoji — `'✏️ Typing'` — written
 * in two places and rendered verbatim. That put copy, an icon and a state into
 * one field on the wire, so it could not be styled, could not be translated,
 * and could not be tested. The kind travels; the words and the colour are
 * chosen where it is drawn.
 *
 * Only four, and each has a precise trigger. Resist adding a fifth for
 * something you can already see happening.
 */
export type ActivityKind = 'typing' | 'recording' | 'drawing' | 'moving';

const ACTIVITY_KINDS = new Set<string>(['typing', 'recording', 'drawing', 'moving']);

/**
 * The verb shown next to someone's name — and it is deliberately not defined
 * for all of them.
 *
 * A label earns its place only when you **cannot see the thing itself**.
 * Recording is invisible: nothing on the canvas changes while a microphone is
 * live, so it has to be said. Typing is nearly invisible: text appears, but
 * whose it is and that more is coming are not on screen.
 *
 * Drawing and moving are the opposite — the stroke is being drawn in front of
 * you, the object is sliding under their cursor. Labelling those adds a word
 * to the screen that the screen has already said, and it is the fastest way to
 * make a busy board unreadable. They still travel, because they drive the
 * radar's ping and hold the name chip up while someone works.
 */
export const ACTIVITY_LABEL: Partial<Record<ActivityKind, string>> = {
  typing: 'Typing',
  recording: 'Recording',
};

/** One other person in the room, normalized from their awareness state. */
export interface Collaborator {
  clientId: number;
  name: string;
  /** Their raw identity colour. Chips derive readable colours from it. */
  color: string;
  /**
   * One or two letters for an avatar.
   *
   * This and `color` are the whole of how somebody looks in the room, and that
   * is deliberate: awareness is rebroadcast at pointer frequency to every peer,
   * so anything carried here is on the wire many times a second. A name and a
   * colour are the two things that have to be, because they are what a cursor
   * label and a selection ring are made of. See `ui/Avatar.tsx`.
   */
  initials: string;
  /**
   * Their pointer in **world** coordinates, or `null` when it is not over a
   * canvas. Cursor is the "right now" signal and is meant to disappear.
   */
  cursor: Point | null;
  /**
   * The smoothed cursor, also **world** coordinates.
   *
   * Smoothing in world space rather than screen space is deliberate: a screen
   * position changes when *your* camera moves, so the old screen-space lerp
   * made everyone's pointer slide across the board whenever you panned, as
   * though they were all drifting. In world space a pan moves the arrow with
   * the content it is over, exactly like every other object on the canvas.
   */
  smoothed: Point | null;
  /**
   * Where they are working. Persists while they read or use a panel, which is
   * why the radar and the edge arrows read this and not `cursor`.
   */
  viewport: ViewportState | null;
  /** What they are doing, if it is one of the four things worth broadcasting. */
  activity: ActivityKind | null;
  /**
   * The tool in their hand, as a tool id.
   *
   * `presenceManager.updateTool` has always published this and nothing has
   * ever read it. It is what lets a collaborator's arrow wear the same badge
   * yours does — the cheapest possible answer to "what is Mike about to do",
   * because it needs no new field, no new surface and no new vocabulary.
   */
  tool: string | null;
  away: boolean;
  selection: string[];
  /** Objects of theirs mid-flight, world space. */
  throws: Point[];
  /** Live cursor reaction emoji */
  reaction?: { emoji: string; timestamp: number } | null;
}

const FALLBACK_COLOR = '#6B7280';

/**
 * Up to two letters for an avatar.
 *
 * Two words give their initials; one word gives its first letter. Taking the
 * first two letters of a single name reads as an acronym for something ("AL",
 * "DA") rather than as a person.
 */
export function initialsFor(name: string): string {
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0][0].toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** Narrow an awareness `throws` record to the poses that are actually usable. */
function readThrows(raw: unknown): Point[] {
  if (!raw || typeof raw !== 'object') return [];
  const items = Array.isArray(raw) ? raw : Object.values(raw as Record<string, unknown>);
  return items
    .filter(
      (p): p is Point =>
        !!p &&
        typeof p === 'object' &&
        Number.isFinite((p as Point).x) &&
        Number.isFinite((p as Point).y)
    )
    .map((p) => ({ x: p.x, y: p.y }));
}

/** A cursor is only a cursor if both coordinates are real numbers. */
function readCursor(raw: unknown): Point | null {
  if (!raw || typeof raw !== 'object') return null;
  const { x, y } = raw as Point;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/**
 * A viewport is only usable if it has all five fields.
 *
 * `width`/`height` were added after the original three, so a peer on an older
 * build publishes a rectangle of `undefined` size. `MinimapEngine` divided by
 * it and drew `NaN`-sized rectangles — which is to say, nothing at all, in
 * total silence. Rejecting the incomplete shape here means every consumer can
 * assume the fields exist.
 */
function readViewport(raw: unknown): ViewportState | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as ViewportState;
  const ok =
    Number.isFinite(v.x) &&
    Number.isFinite(v.y) &&
    Number.isFinite(v.width) &&
    Number.isFinite(v.height) &&
    Number.isFinite(v.zoom) &&
    v.zoom > 0 &&
    v.width > 0 &&
    v.height > 0;
  return ok ? { x: v.x, y: v.y, width: v.width, height: v.height, zoom: v.zoom } : null;
}

/**
 * Turn raw awareness states into collaborators, dropping ourselves and anyone
 * who has not identified themselves yet.
 *
 * Sorted by client id so the roster order is stable — an unsorted `Map`
 * iteration reorders the avatar row whenever anyone's state updates.
 */
export function readCollaborators(
  states: Map<number, any> | undefined | null,
  myClientId: number | undefined
): Collaborator[] {
  if (!states) return [];

  const out: Collaborator[] = [];
  states.forEach((state: any, clientId: number) => {
    if (clientId === myClientId || !state || !state.user) return;
    const name = typeof state.user.name === 'string' && state.user.name ? state.user.name : 'Guest';
    out.push({
      clientId,
      name,
      color: typeof state.user.color === 'string' ? state.user.color : FALLBACK_COLOR,
      initials: initialsFor(name),
      cursor: readCursor(state.cursor),
      smoothed: null,
      viewport: readViewport(state.viewport),
      activity: ACTIVITY_KINDS.has(state.activity) ? (state.activity as ActivityKind) : null,
      tool: typeof state.tool === 'string' && state.tool ? state.tool : null,
      away: state.status === 'away',
      selection: Array.isArray(state.selection) ? state.selection : [],
      throws: readThrows(state.throws),
      reaction: state.reaction && typeof state.reaction.emoji === 'string' ? state.reaction : null,
    });
  });

  out.sort((a, b) => a.clientId - b.clientId);
  return out;
}

/**
 * What React needs to re-render for.
 *
 * Position is deliberately absent. Awareness fires ~15Hz per peer and a
 * pointer moving is not a change of identity; re-rendering a component tree to
 * move a 20px arrow is how a presence layer starts costing more than the
 * document it decorates. Everything in this string changes when someone joins,
 * leaves, is renamed, goes idle, or crosses onto or off the canvas — a few
 * times a minute, not sixty times a second.
 *
 * `cursor !== null` is in here on purpose. Whether a pointer is *shown* is
 * React's decision, not the frame loop's: when the loop owned visibility, a
 * throttled tab (where frames can be a second apart, or never come) showed an
 * empty room, which is indistinguishable from being alone.
 *
 * `selection` is in here for the same reason from the other direction: remote
 * selection outlines *are* React output, and someone selecting an object is a
 * deliberate act a handful of times a minute, not a stream.
 */
export function rosterSignature(list: Collaborator[]): string {
  return list
    .map(
      (c) =>
        `${c.clientId}:${c.name}:${c.color}:${c.activity ?? ''}:${c.tool ?? ''}:${
          c.away ? 1 : 0
        }:${c.cursor ? 1 : 0}:${c.reaction?.emoji ?? ''}:${c.selection.join(',')}`
    )
    .join('|');
}

/** A per-person phase in [0,1), so ambient pulses do not beat in unison. */
export function phaseFor(clientId: number): number {
  // Golden-ratio conjugate: consecutive client ids land far apart, which is
  // what you want when a room is a handful of people who joined in a row.
  return (clientId * 0.6180339887) % 1;
}

// ---------------------------------------------------------------------------
// Off-screen placement
// ---------------------------------------------------------------------------

export interface EdgePlacement {
  /** Where to draw the marker, in screen pixels. */
  x: number;
  y: number;
  /** Direction from the middle of the screen toward the person, in degrees. */
  angle: number;
}

/**
 * Place a marker on the viewport edge in the direction of an off-screen point.
 *
 * Returns `null` when the point is already comfortably on screen, which is the
 * signal not to draw a marker at all.
 *
 * The old version clamped `x` and `y` independently. That is not the same
 * thing: clamping each axis lands the marker at the corner for anything
 * diagonal, so three people in three different directions off the top-right
 * all pile onto the same corner and none of the arrows point at anyone. This
 * walks the ray from the middle of the screen and takes where it crosses the
 * inset rectangle, so a marker sits on the edge you would actually leave by.
 */
export function edgePlacement(
  target: Point,
  viewport: { width: number; height: number },
  margin = 56
): EdgePlacement | null {
  const halfW = viewport.width / 2;
  const halfH = viewport.height / 2;
  if (halfW <= 0 || halfH <= 0) return null;

  const dx = target.x - halfW;
  const dy = target.y - halfH;

  // The keep-out box the marker sits on. Never let it invert on a tiny window.
  const boundX = Math.max(halfW - margin, halfW * 0.25);
  const boundY = Math.max(halfH - margin, halfH * 0.25);

  if (Math.abs(dx) <= boundX && Math.abs(dy) <= boundY) return null;

  // Scale the ray until it touches the nearer of the two bounds.
  const scale = Math.min(
    Math.abs(dx) > 1e-6 ? boundX / Math.abs(dx) : Infinity,
    Math.abs(dy) > 1e-6 ? boundY / Math.abs(dy) : Infinity
  );
  if (!Number.isFinite(scale)) return null;

  return {
    x: halfW + dx * scale,
    y: halfH + dy * scale,
    angle: (Math.atan2(dy, dx) * 180) / Math.PI,
  };
}

/** "2.4k px away" — distance is only ever a rough sense of how far. */
export function formatDistance(px: number): string {
  const n = Math.round(Math.abs(px));
  if (n < 1000) return `${n}px`;
  if (n < 100000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`;
  return `${Math.round(n / 1000)}k`;
}

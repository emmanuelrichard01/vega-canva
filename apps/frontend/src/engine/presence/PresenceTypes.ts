/**
 * The area of the board someone is looking at.
 *
 * `x`/`y` are the **world** coordinates of the top-left corner; `width`/`height`
 * are the viewport in **screen** pixels, which consumers divide by `zoom` to get
 * its world size. Both halves are needed and only `zoom` used to be stored
 * alongside them, so `MinimapEngine`'s `u.viewport.width / u.viewport.zoom` came
 * out `NaN` and its remote-viewport rectangles silently drew nothing.
 */
export interface ViewportState {
  x: number;
  y: number;
  width: number;
  height: number;
  zoom: number;
}

/**
 * The world point in the middle of someone's screen.
 *
 * `ViewportState` stores the **top-left corner**, because that is what a
 * rectangle needs and the minimap draws rectangles. Everything that *navigates*
 * to a person wants the middle instead — fly to the corner and you land half a
 * screen up and to the left of whatever they are actually looking at.
 *
 * That is not hypothetical: clicking a collaborator's avatar panned to empty
 * canvas, and so did follow mode and the off-screen markers, because three
 * separate call sites each passed the corner straight to a "centre on this
 * point" navigator. One function now, used by all of them.
 *
 * Falls back to the corner when `width`/`height` are missing, which is what a
 * peer running an older build still publishes.
 */
export function viewportCenter(v: ViewportState): { x: number; y: number } {
  const zoom = v.zoom || 1;
  return {
    x: v.x + (v.width ?? 0) / (2 * zoom),
    y: v.y + (v.height ?? 0) / (2 * zoom),
  };
}

export interface CursorState {
  x: number;
  y: number;
}

export interface PresenceState {
  id: string;
  name: string;
  color: string;
  cursor: CursorState | null;
  viewport: ViewportState | null;
  selection: string[];
  tool: string;
  activity: import('./collaborators').ActivityKind | null;
  status: 'online' | 'away';
  reaction?: { emoji: string; timestamp: number } | null;
  /**
   * Whose view this client's camera is locked to, or `null`.
   *
   * Following is a way of *looking*, so it deliberately lives outside the
   * document — but it is worth announcing, and only the follower can announce
   * it. Without this the leader has no way to know anyone is there: they talk
   * over a board while three people watch, or worse, they pan away from what
   * they were showing because nothing told them anyone was looking. "Two
   * people are following you" is made of exactly this field, counted.
   */
  following: number | null;
  /**
   * "I am showing something — come and look."
   *
   * The timestamp is the offer, not a duration: a spotlight goes stale on its
   * own (see `SPOTLIGHT_MS`) so that a presenter who forgets to switch it off,
   * or whose tab is throttled mid-sentence, does not leave a standing summons
   * on everyone else's screen for the rest of the session.
   */
  spotlight?: { at: number } | null;
}

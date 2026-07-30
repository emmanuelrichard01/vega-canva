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
  activity: string | null;
  status: 'online' | 'away';
}

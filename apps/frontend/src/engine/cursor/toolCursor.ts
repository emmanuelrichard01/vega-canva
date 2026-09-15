/**
 * Which cursor a tool wears.
 *
 * The old system replaced the OS pointer with a `rAF`-positioned `<div>`. That
 * is always one frame behind the real pointer, it throws away every cursor
 * accessibility setting the OS has (size, high-contrast, pointer trails), and
 * it dies completely on any surface that isn't the canvas. This module returns
 * a *mode* instead, and `index.css` maps each mode to a real CSS `cursor` — so
 * the compositor draws the pointer, at zero latency, honouring the OS.
 *
 * Splitting mode from appearance is the point: the mode is logic and is tested
 * here, the appearance is design-system material and lives with the tokens.
 *
 * **Read the first paragraph again if you are about to draw a pointer.** A
 * drawn `<div>` was reintroduced after this file was written, rebuilt once for
 * latency, and removed again for the reason stated above — a DOM element is
 * composited with the page and is a frame behind the compositor-drawn OS
 * cursor by construction. The art now lives in `cursorVisual.ts` and
 * `cursorCss.ts` turns it into a `url()` cursor, so this file's mapping is
 * still what decides *which* one, and `index.css` still applies it.
 *
 * Tools already declare `cursor` on the `Tool` interface, and `ToolManager`
 * already has a `getCursor()`. Nothing ever called it, so those declarations
 * were decoration while four other places fought over the real cursor. This is
 * now the one place that decides.
 */

/**
 * The cursor vocabulary. Deliberately small — the previous `CursorStateId`
 * union declared nineteen states of which exactly three were ever set.
 * Every mode here is reachable.
 */
export type CursorMode =
  /** Selecting, moving, and the default for anything unrecognised. */
  | 'pointer'
  /** Hand tool, or Space held down over any tool: an open hand, ready. */
  | 'pan'
  /**
   * The same hand, closed, while the board is actually being dragged.
   *
   * A separate mode rather than a flag on `pan`, because it is the *only*
   * cursor in the vocabulary that answers "is something happening right now"
   * rather than "what would happen if I pressed". Panning is the one gesture
   * with no visible result of its own until the board moves, so the hand
   * closing is the entire acknowledgement that the press landed — without it
   * a pan that has not started yet and one that has look identical.
   */
  | 'grab'
  /** Pen, shapes, and anything else drawn by dragging out a region. */
  | 'draw'
  /** Text entry. */
  | 'text'
  /** Eraser. */
  | 'erase'
  /** Dropping a sticky note. */
  | 'note'
  /** Dropping a comment pin. */
  | 'comment'
  /** Placing an image or an audio clip. */
  | 'place'
  /** Aiming a force field. */
  | 'aim';

/**
 * Every mode, as a value.
 *
 * Exported for the same reason `NODE_TYPES` is: something has to be able to
 * enumerate them at runtime — here, to assert that each one names a fallback
 * keyword, so a mode added without one cannot ship a drawing tool that falls
 * back to an arrow.
 */
export const CURSOR_MODES = [
  'pointer', 'pan', 'grab', 'draw', 'text', 'erase', 'note', 'comment', 'place', 'aim',
] as const satisfies readonly CursorMode[];

/** Tool ids that aim a force field. Mirrors `FORCE_IDS` in `engine/physics/forces.ts`. */
const FORCE_TOOLS = new Set(['magnet', 'repel', 'wind', 'shockwave', 'gravity']);

/**
 * Five tools were missing from this table and fell through to `pointer`.
 *
 * `shape-line`, `shape-arrow`, `connector`, `frame` and `grid` are all drawn by
 * dragging out a region, so every one of them wants the crosshair the `draw`
 * mode carries — and every one of them was showing the select arrow instead,
 * which says the next drag will select something. The default is a safe answer
 * to an unknown tool and a wrong answer to a known one, and the difference is
 * invisible until you notice a tool's cursor never changed.
 *
 * `cursor.test.ts` now asserts every id in `TOOL_SHORTCUTS` is named here, so a
 * tool added to the dock cannot silently inherit the default again.
 */
const BY_TOOL: Record<string, CursorMode> = {
  select: 'pointer',
  'direct-select': 'pointer',
  hand: 'pan',
  pen: 'draw',
  'bezier-pen': 'draw',
  shape: 'draw',
  'shape-rect': 'draw',
  'shape-ellipse': 'draw',
  'shape-triangle': 'draw',
  'shape-hexagon': 'draw',
  'shape-star': 'draw',
  'shape-line': 'draw',
  'shape-arrow': 'draw',
  connector: 'draw',
  frame: 'draw',
  grid: 'draw',
  // A chart is dragged out as a region like the frame and grid above it, so it
  // takes the same crosshair rather than the arrow that promises a selection.
  chart: 'draw',
  // The table tool fell through to `pointer` — the select arrow — which says
  // the next drag selects, when it draws a table whose rows follow the drag.
  // The chart's reasoning exactly, and the same miss as the five above.
  table: 'draw',
  text: 'text',
  eraser: 'erase',
  sticky: 'note',
  comment: 'comment',
  image: 'place',
  audio: 'place',
};

export interface CursorModeInput {
  /** Space pans regardless of the active tool, so it outranks every tool. */
  spacePressed?: boolean;
  /** The board is being dragged right now, by the hand tool or by Space. */
  panning?: boolean;
}

/**
 * The cursor mode for the current tool and modifiers.
 *
 * Space wins over everything: holding it pans no matter which tool is
 * selected, so showing that tool's cursor would be a lie about what the next
 * drag is going to do. That mismatch was a real bug — holding Space with the
 * Shape tool active kept the crosshair while the drag actually panned.
 */
export function cursorModeForTool(
  toolId: string | undefined,
  { spacePressed = false, panning = false }: CursorModeInput = {}
): CursorMode {
  // Checked before everything, including the tool: while the board is being
  // dragged it does not matter what is armed, the hand has the pointer.
  if (panning) return 'grab';
  if (spacePressed) return 'pan';
  if (!toolId) return 'pointer';
  if (FORCE_TOOLS.has(toolId)) return 'aim';
  return BY_TOOL[toolId] ?? 'pointer';
}

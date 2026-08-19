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

/** Tool ids that aim a force field. Mirrors `FORCE_IDS` in `engine/physics/forces.ts`. */
const FORCE_TOOLS = new Set(['magnet', 'repel', 'wind', 'shockwave', 'gravity']);

const BY_TOOL: Record<string, CursorMode> = {
  select: 'pointer',
  hand: 'pan',
  pen: 'draw',
  'bezier-pen': 'draw',
  shape: 'draw',
  'shape-rect': 'draw',
  'shape-ellipse': 'draw',
  'shape-triangle': 'draw',
  'shape-hexagon': 'draw',
  'shape-star': 'draw',
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

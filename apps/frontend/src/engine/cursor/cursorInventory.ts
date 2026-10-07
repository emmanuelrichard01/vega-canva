import { cursorModeForTool } from './toolCursor';
import {
  cursorVisual,
  drawVisual,
  eraserVisual,
  lassoVisual,
  moveVisual,
  portVisual,
  precisionVisual,
  resizeVisual,
  rotateVisual,
  stateVisual,
  type CursorVisual,
} from './cursorVisual';

/**
 * Every tool and pointer state, and what its cursor is.
 *
 * Written down so that "which tools have a cursor" is a fact the test suite
 * checks rather than one a reader reconstructs from five files. Each entry is
 * one of:
 *
 * - `custom`: our art, produced by `art()`.
 * - `none`: no cursor change at all, with the reason.
 *
 * The platform keywords are not entries: each mode names its keyword in
 * `FALLBACK`, which is what a browser that cannot use the art shows, and the
 * test suite asserts every mode has one.
 */
export type CursorDecision = { kind: 'custom'; art: () => CursorVisual } | { kind: 'none' };

export interface InventoryEntry {
  id: string;
  /** The tool id this entry covers, when it is a tool. */
  tool?: string;
  group: 'tool' | 'force' | 'state' | 'handle';
  decision: CursorDecision;
  why: string;
}

const ACCENT = '#F3A024';
const INK_SAMPLE = '#2563EB';

const tool = (id: string, why: string): InventoryEntry => ({
  id,
  tool: id,
  group: 'tool',
  decision: { kind: 'custom', art: () => cursorVisual(cursorModeForTool(id), id, ACCENT) },
  why,
});

const force = (id: string, why: string): InventoryEntry => ({
  id,
  tool: id,
  group: 'force',
  decision: { kind: 'custom', art: () => cursorVisual(cursorModeForTool(id), id, ACCENT) },
  why,
});

const custom = (
  id: string,
  group: InventoryEntry['group'],
  art: () => CursorVisual,
  why: string,
  toolId?: string
): InventoryEntry => ({ id, group, tool: toolId, decision: { kind: 'custom', art }, why });

const none = (id: string, group: InventoryEntry['group'], why: string): InventoryEntry => ({
  id,
  group,
  decision: { kind: 'none' },
  why,
});

export const CURSOR_INVENTORY: readonly InventoryEntry[] = [
  tool('select', 'Arrow: the board default, which every other tool is told apart from.'),
  tool('direct-select', 'Hollow arrow: edits points, which is a different gesture from moving objects.'),
  custom('hand', 'tool', () => cursorVisual('pan', 'hand', ACCENT), 'Open hand at rest; the closed hand swaps in on press.', 'hand'),
  custom('pen', 'tool', () => drawVisual('pen', INK_SAMPLE), 'Fineliner with its tip in the ink it will lay down.', 'pen'),
  custom('marker', 'tool', () => drawVisual('marker', INK_SAMPLE), 'A brush of the pen tool: broad barrel and felt tip.'),
  custom('highlighter', 'tool', () => drawVisual('highlighter', INK_SAMPLE), 'A brush of the pen tool: chisel tip in the highlight colour.'),
  tool('bezier-pen', 'Nib; the pen signs (add, remove, convert) are claimed by the path editor.'),
  custom('eraser', 'tool', () => eraserVisual(20), 'A ring at the real eraser size, hot at its centre.', 'eraser'),
  custom('eraser-lasso', 'tool', () => lassoVisual(), 'Dashed loop on a tail, hot at the tail: the lasso erases what a loop encloses.'),
  tool('text', 'I-beam in a dashed box: a click makes a text box rather than a caret.'),
  tool('sticky', 'Note glyph on the arrow.'),
  tool('shape', 'Crosshair with a shape badge.'),
  tool('shape-rect', 'Rectangle badge.'),
  tool('shape-ellipse', 'Ellipse badge.'),
  tool('shape-triangle', 'Triangle badge.'),
  tool('shape-hexagon', 'Hexagon badge.'),
  tool('shape-star', 'Star badge.'),
  tool('shape-line', 'Line badge: the drag draws a segment.'),
  tool('shape-arrow', 'Arrow badge: the drag draws a segment with a head.'),
  tool('connector', 'Crosshair with the connector badge; the port state is below.'),
  tool('frame', 'Crosshair with the frame badge.'),
  tool('grid', 'Crosshair with the grid badge.'),
  tool('table', 'Crosshair with the table badge.'),
  tool('chart', 'Crosshair with the chart badge.'),
  tool('image', 'Plus-in-frame badge: a click places a picture.'),
  tool('audio', 'Microphone badge; the recording state is below.'),
  tool('link', 'Chain badge: a click places a link card.'),
  tool('code', 'Brackets badge: a drag draws a code block.'),
  tool('comment', 'Speech bubble hot at its tail, which is where the pin lands.'),
  force('magnet', 'Chevrons in, inside the field ring: attract.'),
  force('repel', 'Chevrons out, inside the field ring: repel.'),
  force('wind', 'Streaks to the right: blows objects along the drag.'),
  force('gravity', 'Arrow down: pulls toward the direction chosen.'),
  force('swirl', 'Clockwise turn: rotates objects around the point.'),
  force('shockwave', 'Nested rings: a one-shot burst.'),
  none('icon-place', 'tool', 'Icons are inserted from the browser panel and land in the view; no tool is armed on the board, so the select arrow is correct.'),
  none('zoom', 'tool', 'There is no zoom tool: zoom is the wheel, a pinch, a shortcut or the zoom menu, none of which have a pointer state.'),
  none('measure', 'state', 'Alt-hover measuring is drawn by its own overlay on the board; the pointer stays the arrow.'),
  none('select-behind', 'state', 'The selection outline moving is the feedback; a distinct pointer would only add a state to learn.'),
  custom('duplicate', 'state', () => cursorVisual('pointer', 'alt-duplicate', ACCENT), 'Plus badge on the arrow while Alt is held on the select tool.'),
  custom('connector-port', 'state', () => portVisual(ACCENT), 'A ring closing on the port the connector will snap to.'),
  custom('resize', 'handle', () => resizeVisual(45), 'Double arrow turned to the exact on-screen angle of its handle, so it follows a rotated object.'),
  custom('rotate', 'handle', () => rotateVisual(225), 'Curved double arrow turned to face its corner.'),
  custom('move', 'handle', () => moveVisual(), 'Four-way arrow over an object a drag will move.'),
  custom('precision', 'state', () => precisionVisual(), 'Caps Lock: a gapped crosshair, so the pointer is not in the way of an exact point.'),
  custom('not-allowed', 'state', () => stateVisual('not-allowed'), 'Prohibition badge on the arrow, over pinned or locked objects.'),
  custom('busy', 'state', () => stateVisual('busy'), 'Three dots on the arrow, set through cursorHint.'),
  custom('recording', 'state', () => stateVisual('recording'), 'A record dot on the arrow while a voice note is captured, set through cursorHint.'),
  none('presenting', 'state', 'Hidden after a moment of stillness by watchPresentingCursor, and shown again by any movement.'),
];

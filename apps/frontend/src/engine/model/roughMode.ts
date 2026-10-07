/**
 * Whether an object is drawn by hand, and how hard: the board's choice and the
 * object's own, resolved to one answer.
 *
 * Two settings decide it:
 *
 * - **The board's sketch mode** (`metadata.sketch`): a roughness level, or
 *   nothing. When set, every sketchable object on the board is drawn by hand
 *   at that level unless it says otherwise. It lives in the document, so
 *   everyone in the room and every export sees the same board.
 * - **The object's override**: `appearance.sketch` pins a level, and
 *   `appearance.sketchClean` keeps the object crisp on a sketched board.
 *   Neither set means "follow the board".
 *
 * Every painter (the canvas renderers and the SVG exporter) asks
 * `resolveSketch` and nothing else, so the file and the screen cannot disagree
 * about which objects are sketched.
 *
 * Pure on purpose: no document, no React. `roughBoard.ts` is the live half.
 */

import type { SketchLevel } from './rough';
import { SKETCH_LEVELS } from './rough';

/** The metadata key the board's sketch mode is stored under. */
export const BOARD_SKETCH_KEY = 'sketch';

/** The level a board takes when sketch mode is switched on without one chosen. */
export const DEFAULT_BOARD_SKETCH: SketchLevel = 'medium';

/**
 * The object types the board's sketch mode reaches.
 *
 * Freehand strokes are absent on purpose: a pencil stroke is already drawn by
 * hand, its sketch is chosen when it is drawn (the pencil's nib), and redrawing
 * it from its centreline would throw away its pressure taper and turn a
 * highlighter band into a thin line. Icons, images, text and frames have no
 * outline to go over.
 */
export const BOARD_SKETCH_TYPES: ReadonlySet<string> = new Set(['shape', 'connector', 'sticky', 'table', 'chart']);

/** The board's level as it applies to an object of `type`: null where sketch mode does not reach. */
export function boardSketchFor(type: string, board: SketchLevel | null | undefined): SketchLevel | null {
  return board && BOARD_SKETCH_TYPES.has(type) ? board : null;
}

/** The two appearance fields an object uses to answer for itself. */
export interface SketchChoice {
  sketch?: SketchLevel;
  sketchClean?: boolean;
}

/** The stored board value as a level, or null when sketch mode is off or the value is junk. */
export function parseBoardSketch(value: unknown): SketchLevel | null {
  return typeof value === 'string' && (SKETCH_LEVELS as string[]).includes(value) ? (value as SketchLevel) : null;
}

/**
 * The level this object is drawn at, or undefined for crisp.
 *
 * A pinned level wins, then an explicit Clean, then the board.
 */
export function resolveSketch(
  appearance: SketchChoice | undefined,
  board: SketchLevel | null | undefined
): SketchLevel | undefined {
  if (appearance?.sketch) return appearance.sketch;
  if (appearance?.sketchClean) return undefined;
  return board ?? undefined;
}

/** Where an object's look comes from, for the panel's wording. */
export type SketchSource = 'pinned' | 'clean' | 'board' | 'none';

export function sketchSource(appearance: SketchChoice | undefined, board: SketchLevel | null | undefined): SketchSource {
  if (appearance?.sketch) return 'pinned';
  if (appearance?.sketchClean) return 'clean';
  return board ? 'board' : 'none';
}

/**
 * The appearance patch for one of the override choices.
 *
 * - `clean`: crisp. On a sketched board that has to be said explicitly; on a
 *   clean board it is simply the absence of a level.
 * - `follow`: whatever the board does.
 * - a level: pinned at that level, whatever the board does.
 *
 * Both fields are always written, so a patch never leaves the pair
 * contradicting itself.
 */
/**
 * The patch for the look toggle on one object, or null when nothing changes.
 *
 * Sketch leaves an object that is already sketched as it is (a pinned level
 * stays pinned), follows the board where the board reaches, and otherwise pins
 * the default level.
 */
export function lookPatch(
  look: 'clean' | 'sketch',
  appearance: SketchChoice | undefined,
  board: SketchLevel | null | undefined
): { sketch: SketchLevel | undefined; sketchClean: true | undefined } | null {
  if (look === 'clean') return resolveSketch(appearance, board) || appearance?.sketchClean ? sketchPatch('clean', board) : null;
  if (resolveSketch(appearance, board)) return null;
  return sketchPatch(board ? 'follow' : DEFAULT_BOARD_SKETCH, board);
}

export function sketchPatch(
  choice: 'clean' | 'follow' | SketchLevel,
  board: SketchLevel | null | undefined
): { sketch: SketchLevel | undefined; sketchClean: true | undefined } {
  if (choice === 'follow') return { sketch: undefined, sketchClean: undefined };
  if (choice === 'clean') return { sketch: undefined, sketchClean: board ? true : undefined };
  return { sketch: choice, sketchClean: undefined };
}

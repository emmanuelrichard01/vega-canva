/**
 * How far an arrow key moves the selection.
 *
 * ## Why this is a module and not four lines inside a key handler
 *
 * Nudging was advertised on the help screen — "Arrows: nudge by one unit",
 * "Shift + Arrows: nudge by ten" — and bound nowhere at all. Arrow keys on a
 * canvas are claimed by three different components (the Layers tree moves its
 * cursor, the minimap pans, the replay bar steps through history), so the
 * question of *which* press means "move the selected object" is a real one
 * with a real answer, and it deserves somewhere to be read rather than being
 * reconstructed from a `switch`.
 *
 * The step is in world units, not pixels. A nudge is an alignment gesture —
 * "one more, one more, there" — and if it scaled with zoom the same press
 * would mean a different thing at 40% than at 400%, which is the opposite of
 * what the gesture is for.
 */

/** One press. Deliberately the smallest unit the document has. */
export const NUDGE_STEP = 1;

/** With Shift held. Ten is the convention every editor shares; keep it. */
export const NUDGE_STEP_LARGE = 10;

export interface NudgeDelta {
  dx: number;
  dy: number;
}

/**
 * The movement an arrow keypress means, or `null` if the key is not an arrow.
 *
 * Returning `null` rather than a zero delta matters: the caller uses it to
 * decide whether to call `preventDefault`, and swallowing every key would turn
 * the canvas into a focus trap.
 */
export function nudgeDelta(key: string, shift: boolean): NudgeDelta | null {
  const step = shift ? NUDGE_STEP_LARGE : NUDGE_STEP;
  switch (key) {
    case 'ArrowLeft': return { dx: -step, dy: 0 };
    case 'ArrowRight': return { dx: step, dy: 0 };
    case 'ArrowUp': return { dx: 0, dy: -step };
    case 'ArrowDown': return { dx: 0, dy: step };
    default: return null;
  }
}

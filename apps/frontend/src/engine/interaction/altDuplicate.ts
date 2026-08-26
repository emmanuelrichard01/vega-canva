/**
 * When an Alt-drag becomes a duplicate.
 *
 * One decision, in one place, because it is asked in three: the drag's start
 * (to raise the ghost), each move (to follow Alt being pressed or let go), and
 * the drop (to decide what the gesture actually was). They used to answer it
 * separately and disagreed — holding Alt *before* the drag began set the flag
 * but never raised the ghost, because the move handler's test was "Alt is down
 * and the flag is not", which the start handler had already made false.
 */

/**
 * How far an Alt-drag must travel before it duplicates, **in screen pixels**.
 *
 * ## Why the unit matters
 *
 * It was measured in world units, so the threshold meant something different at
 * every zoom: at 10% a four-unit wobble is four tenths of a pixel of actual hand
 * movement, and Alt-*clicking* an object — which people do constantly, Alt being
 * the modifier for several other gestures — left a copy sitting exactly on top
 * of the original, where the only evidence is the layers panel growing a row.
 * At 500% you had to drag twenty pixels before it would take.
 *
 * The gesture is made by a hand on a screen, so the threshold belongs in the
 * units the hand works in. Four is what the dock editor uses to tell a tap from
 * a drag, and it is well inside the distance anyone would call "I dragged it".
 */
export const ALT_DUPLICATE_SLOP = 4;

/**
 * Whether a drag of `dx, dy` **world** units, at this zoom, is far enough.
 *
 * @param zoom  the camera's scale, so the distance can be judged on screen.
 */
export function travelledEnough(dx: number, dy: number, zoom: number): boolean {
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return Math.hypot(dx, dy) * scale > ALT_DUPLICATE_SLOP;
}

/**
 * Which objects a duplicating drag would copy.
 *
 * The whole selection when the object being dragged is part of a multiple
 * selection, and just that object otherwise — including when it is not selected
 * at all, because dragging an unselected object is a perfectly ordinary way to
 * move one and Alt should not make it silently take the selection with it.
 */
export function duplicationSet(
  objId: string,
  isSelected: boolean,
  selection: readonly string[] | undefined
): string[] {
  return isSelected && selection && selection.length > 1 ? [...selection] : [objId];
}

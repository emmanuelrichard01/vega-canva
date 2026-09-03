import type { CursorMode } from './toolCursor';
import type { CursorVisual } from './cursorVisual';

/**
 * Our own art, as a real CSS cursor.
 *
 * ## Why the drawn element had to go
 *
 * This module exists because of a report that the pointer "lags behind", and
 * the report was right in a way no amount of tuning could have fixed.
 *
 * A drawn pointer is a DOM element, so it is painted **with the page**: the
 * position is written inside the pointer event, the browser composites it on
 * the next frame, and the frame reaches the screen a refresh later. The OS
 * cursor does not go through any of that — the compositor draws it on its own
 * path, ahead of page paint, and on most platforms it is updated between
 * frames entirely. So a drawn cursor trails the real one by at least one
 * frame, permanently, *by construction*.
 *
 * `toolCursor.ts` opens by saying exactly this — "always one frame behind the
 * real pointer" — about the implementation *it* replaced. A drawn pointer was
 * then reintroduced anyway, and this is the second time the same lesson has
 * been paid for. The note is left where it is, because being able to point at
 * it is more useful than being right.
 *
 * A `url()` cursor is drawn by the same compositor path as the arrow the OS
 * ships. It has zero latency, it cannot double up because there is only ever
 * one cursor, it works over every element in the document and over any page
 * the app renders, and it needs no `cursor: none` anywhere — so the failure
 * mode where the suppression outlives the drawing cannot exist.
 *
 * ## What is given up, and why it is the right trade
 *
 * A CSS cursor cannot animate, so the press *dip* is gone. That was a 90ms
 * scale on an element nobody looks at directly, and it was costing a frame of
 * latency on every pointer move to keep. Everything with real meaning
 * survives, because each is a **swap** rather than an animation: the hand
 * still closes on press, the badge still changes with the tool, the Alt badge
 * still appears — all by changing which image is current, which is one CSS
 * property write and free.
 */

/**
 * `url(...) hotspot, fallback`.
 *
 * The fallback keyword is not optional. A data URI can fail to decode, exceed
 * a platform's cursor size limit, or be refused outright under some privacy
 * settings — and a `cursor` declaration the browser cannot use is *dropped*,
 * falling back to whatever it inherits rather than to nothing. Naming a
 * sensible keyword means the worst case is a plain crosshair instead of a
 * drawn one, rather than an arrow over a drawing tool.
 *
 * The hotspot is in the image's own pixel space, which is why `CursorVisual`
 * carries an offset rather than a pre-applied transform: the same number that
 * placed the old element is the number a `url()` cursor wants, negated.
 */
export function cursorCss(visual: CursorVisual, fallback: string): string {
  const uri = `data:image/svg+xml,${encodeURIComponent(visual.svg)}`;
  return `url("${uri}") ${-visual.offsetX} ${-visual.offsetY}, ${fallback}`;
}

/**
 * The keyword to fall back to for each mode.
 *
 * Chosen so a browser that cannot use the image still says the same thing
 * about what the next press will do. This is the whole reason the table is not
 * simply `default` everywhere: a drawing tool that falls back to an arrow is
 * telling the user the drag will select.
 */
export const FALLBACK: Record<CursorMode, string> = {
  pointer: 'default',
  pan: 'grab',
  grab: 'grabbing',
  draw: 'crosshair',
  text: 'text',
  erase: 'crosshair',
  note: 'copy',
  comment: 'copy',
  place: 'copy',
  aim: 'crosshair',
};

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
  const one = `url("${svgUri(visual.svg)}")`;
  const hotspot = `${-visual.offsetX} ${-visual.offsetY}`;
  const set = imageSetSyntax();
  if (set) {
    const two = `url("${svgUri(atScale(visual.svg, 2))}")`;
    return `${set}(${one} 1x, ${two} 2x) ${hotspot}, ${fallback}`;
  }
  return `${one} ${hotspot}, ${fallback}`;
}

const svgUri = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;

/**
 * The same art with its declared size multiplied.
 *
 * The viewBox is untouched, so the drawing is identical; only the raster the
 * browser makes from it is larger. Offered as the 2x candidate, it is shown at
 * the 1x size on a high-density screen and stays crisp instead of being a
 * 28px bitmap scaled up.
 */
export function atScale(svg: string, factor: number): string {
  return svg.replace(/^<svg([^>]*?) width="([0-9.]+)" height="([0-9.]+)"/, (_, pre, w, h) =>
    `<svg${pre} width="${Number(w) * factor}" height="${Number(h) * factor}"`
  );
}

let imageSet: string | null | undefined;

/**
 * Which image-set syntax this browser accepts inside `cursor`, or `null`.
 *
 * Asked once, of the real parser, because a `cursor` value the browser cannot
 * parse is dropped whole and the board would inherit the page arrow. Where
 * neither form parses (or there is no `CSS.supports`, as in tests), the plain
 * `url()` form is used, which every browser takes.
 */
export function imageSetSyntax(): string | null {
  if (imageSet !== undefined) return imageSet;
  imageSet = null;
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return imageSet;
  const probe = (fn: string) =>
    CSS.supports('cursor', `${fn}(url("data:image/svg+xml,%3Csvg%2F%3E") 1x, url("data:image/svg+xml,%3Csvg%2F%3E") 2x) 1 1, auto`);
  if (probe('image-set')) imageSet = 'image-set';
  else if (probe('-webkit-image-set')) imageSet = '-webkit-image-set';
  return imageSet;
}

/** Test seam: forget the probed syntax. */
export function resetImageSetProbe(value?: string | null): void {
  imageSet = value;
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

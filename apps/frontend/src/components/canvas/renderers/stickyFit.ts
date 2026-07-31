import Konva from 'konva';
import {
  fitFontSize,
  overflowsAtMinimum,
  STICKY_LINE_HEIGHT,
} from '../../../engine/model/stickyText';

/**
 * Measuring sticky text, using the thing that will actually draw it.
 *
 * The fitted size has to be identical on the canvas and in the editor overlay,
 * or the words visibly jump the instant you stop typing. The only way to be
 * certain of that is for both to ask the same question of the same measurer —
 * and the only measurer that knows exactly how Konva wraps a line is Konva.
 *
 * An approximation with `ctx.measureText` and a hand-rolled word-wrap would be
 * close, and "close" here means the note reflows under the caret.
 */

/**
 * The note face: a handwriting script, by product decision.
 *
 * `index.html` loads Caveat at **400 and 600 only**, and the renderer asked
 * for `bold` — 700, which is not loaded, so the browser synthesised it by
 * smearing the 400 weight. Faux-bold on a script face thickens the strokes
 * unevenly and fills in the joins; it is why the old notes looked slightly
 * muddy at large sizes. 600 is a real cut and renders as drawn.
 */
export const STICKY_FONT_FAMILY = 'Caveat, cursive';
/** Konva takes the CSS `font-style`/`font-weight` shorthand as one string. */
export const STICKY_FONT_WEIGHT = '600';

/**
 * One offscreen text node, reused.
 *
 * Constructing a `Konva.Text` per measurement allocates on every keystroke,
 * and the fit search performs several measurements each time. This one is
 * never added to a layer, so it is never drawn.
 */
let probe: Konva.Text | null = null;

function measure(text: string, size: number, width: number): number {
  probe ??= new Konva.Text({
    fontFamily: STICKY_FONT_FAMILY,
    fontStyle: STICKY_FONT_WEIGHT,
    lineHeight: STICKY_LINE_HEIGHT,
    wrap: 'word',
  });
  probe.text(text);
  probe.fontSize(size);
  probe.width(width);
  return probe.height();
}

/**
 * Width of one unwrapped word, so the fit can refuse a size that would
 * hard-break it. `width(undefined)` turns wrapping off for the measurement.
 */
function measureWord(word: string, size: number): number {
  probe ??= new Konva.Text({
    fontFamily: STICKY_FONT_FAMILY,
    fontStyle: STICKY_FONT_WEIGHT,
    lineHeight: STICKY_LINE_HEIGHT,
    wrap: 'word',
  });
  probe.text(word);
  probe.fontSize(size);
  probe.width(undefined);
  return probe.getTextWidth();
}

/**
 * Wrapped height of sticky text at a given size, in world pixels.
 *
 * Exported for the editor overlay, which needs it to work out how far to push
 * the first line down — a `<textarea>` has no vertical centring of its own.
 */
export function measureStickyHeight(text: string, size: number, width: number): number {
  return measure(text, size, width);
}

export interface StickyFit {
  fontSize: number;
  /** True when the note is genuinely too full even at the smallest size. */
  overflows: boolean;
}

/**
 * Memoised across renders.
 *
 * A sticky re-renders on selection, on drag, on every presence update touching
 * it — while its text and box are unchanged. Re-running the search each time
 * would lay the text out several times per frame for an answer that has not
 * moved. Bounded, because a board can hold thousands of notes.
 */
const cache = new Map<string, StickyFit>();
const CACHE_LIMIT = 2000;

/**
 * Webfonts arrive after the first paint, and every fitted size measured before
 * they do is wrong.
 *
 * Canvas text measurement uses whatever font is resolvable *at that moment*.
 * Caveat is fetched from Google Fonts, so the first render of a board measures
 * against the fallback cursive — different metrics, different wrap, different
 * answer — and the notes then keep those sizes forever, because the result is
 * cached and nothing re-renders when the font lands. Notes look subtly wrong
 * on a cold load and correct on a warm one, which is the worst way for a bug
 * to present.
 *
 * So: throw the cache away when the fonts settle, and let subscribers know so
 * they re-measure.
 */
let fontEpochValue = 0;
const fontEpochListeners = new Set<() => void>();

export const stickyFontEpoch = {
  get: (): number => fontEpochValue,
  subscribe: (listener: () => void) => {
    fontEpochListeners.add(listener);
    return () => fontEpochListeners.delete(listener);
  },
};

if (typeof document !== 'undefined' && document.fonts?.ready) {
  document.fonts.ready.then(() => {
    cache.clear();
    probe = null;
    fontEpochValue += 1;
    fontEpochListeners.forEach((fn) => fn());
  });
}

export function stickyFit(text: string, boxWidth: number, boxHeight: number): StickyFit {
  // The font epoch is part of the key, not just a signal to callers: an entry
  // measured against the fallback face must never be served after the real one
  // loads, even if a clear were ever missed.
  const key = `${fontEpochValue}|${boxWidth}|${boxHeight}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const options = { text, width: boxWidth, height: boxHeight, measure, measureWord };
  const result: StickyFit = {
    fontSize: fitFontSize(options),
    overflows: overflowsAtMinimum(options),
  };

  // Cheapest possible eviction: once it is full, start again. The alternative
  // is tracking recency per entry, which costs more than re-measuring.
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, result);
  return result;
}

import Konva from 'konva';
import { onFontsChanged } from '../text/fontEpoch';

/**
 * Konva's text measurement, remembered per font and string.
 *
 * `Konva.Text` draws every line by first measuring the letter "M" to place the
 * baseline, which costs a `save`, a font assignment, a `measureText` and a
 * `restore` on a scratch canvas, on every node, every frame. With the whole
 * board in view that was about 15% of the time spent drawing it. The answer
 * depends only on the font string and the text, so it is computed once.
 *
 * Wrapping lines measures the same words again and again for the same reason,
 * and shares the cache. The font string both of them build is remembered per
 * node as well.
 *
 * A face that finishes loading changes what the same font string measures, so
 * the cache empties whenever fonts arrive (`onFontsChanged`), the same signal
 * every other text measurement in the app is keyed on. It is also bounded:
 * past `LIMIT` entries it starts over rather than growing with every string
 * anyone has typed.
 */
type Metrics = ReturnType<Konva.Text['measureSize']>;
type FontMemo = { style: string; variant: string; size: number; family: string; font: string };

const LIMIT = 4000;
const cache = new Map<string, Metrics>();

export function clearTextMeasureCache(): void {
  cache.clear();
}

let installed = false;

export function installTextMeasureCache(): void {
  if (installed) return;
  installed = true;
  const proto = Konva.Text.prototype as unknown as {
    measureSize: (this: Konva.Text, text: string) => Metrics;
    _getContextFont: (this: Konva.Text) => string;
  };
  /**
   * The font string itself, remembered per node until one of its four inputs
   * changes. Konva rebuilds it, normalising the family list, on every draw.
   */
  const contextFont = proto._getContextFont;
  proto._getContextFont = function memoContextFont(this: Konva.Text): string {
    const style = this.fontStyle();
    const variant = this.fontVariant();
    const size = this.fontSize();
    const family = this.fontFamily();
    const holder = this as unknown as { _vegaFont?: FontMemo };
    const memo = holder._vegaFont;
    if (memo && memo.style === style && memo.variant === variant && memo.size === size && memo.family === family) {
      return memo.font;
    }
    const font = contextFont.call(this);
    holder._vegaFont = { style, variant, size, family, font };
    return font;
  };

  const measure = proto.measureSize;
  proto.measureSize = function cachedMeasureSize(this: Konva.Text, text: string): Metrics {
    const key = `${proto._getContextFont.call(this)}\n${text}`;
    let metrics = cache.get(key);
    if (!metrics) {
      metrics = measure.call(this, text);
      if (cache.size >= LIMIT) cache.clear();
      cache.set(key, metrics);
    }
    return metrics;
  };
  onFontsChanged(clearTextMeasureCache);
}

installTextMeasureCache();

import { SKETCH_FONT, SKETCH_FONT_SCALE } from '../chart/chartSketch';
import { approxMeasure, type Measure } from './tableFit';

/** The family `TableRenderer` and `tableSvg` set cells in. */
export const TABLE_FONT = 'Inter, system-ui, -apple-system, sans-serif';

let ctx: CanvasRenderingContext2D | null | undefined;

/**
 * The board's own text measure: the font string `TableRenderer` draws with,
 * sketch mode's hand at its scale included — so a fitted column is exactly as
 * wide as the renderer's ellipsis test needs, and not a character-count guess.
 */
export function tableMeasure(sketch: boolean): Measure {
  if (ctx === undefined) ctx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  const c = ctx;
  if (!c) return approxMeasure;
  const family = sketch ? SKETCH_FONT : TABLE_FONT;
  const k = sketch ? SKETCH_FONT_SCALE : 1;
  return (text, bold, italic, size) => {
    c.font = `${italic ? 'italic ' : ''}${bold || sketch ? 600 : 400} ${size * k}px ${family}`;
    return c.measureText(text).width;
  };
}

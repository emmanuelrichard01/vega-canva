/**
 * The HUD pill, for chrome Konva draws itself.
 *
 * The DOM layer (`components/hud/HudLayer.tsx`) and `hud.css` define the pill;
 * these are the same numbers for the labels that have to live on the canvas
 * because they are attached to lines drawn there: the Alt measurement, the
 * smart guides' spacing, the live grid's gutters. One size, one radius, one
 * type setting, the same tokens, so a distance reads the same wherever it is.
 */

import { chromeToken } from '../interaction/chromeHalo';
import type { HudTone } from './hud';

/** Screen pixels. Mirrors `.hud-pill` in hud.css. */
export const HUD_PILL = {
  height: 20,
  padX: 6,
  radius: 4,
  fontSize: 11,
  fontStyle: '600',
  fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
} as const;

/** The pill and line colours, read off <body> so the theme is honoured. */
export function hudColors(): { object: string; measure: string; ink: string; line: string } {
  return {
    object: chromeToken('--hud-object', '#2563EB'),
    measure: chromeToken('--hud-measure', '#DB2777'),
    ink: chromeToken('--hud-ink', '#FFFFFF'),
    line: chromeToken('--hud-measure-line', '#F0308C'),
  };
}

export function hudFill(tone: HudTone): string {
  const c = hudColors();
  return tone === 'measure' ? c.measure : c.object;
}

let measureCtx: CanvasRenderingContext2D | null | undefined;

/**
 * A label's width in screen pixels at the pill's type setting.
 *
 * Measured, not estimated from a character count: "111" and "888" differ by
 * a third in Inter's proportional figures, and an estimate either crowds one
 * or pads the other.
 */
export function hudPillWidth(text: string): number {
  if (measureCtx === undefined) {
    measureCtx =
      typeof document === 'undefined' ? null : (document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D | null);
  }
  let advance = text.length * 6.4;
  if (measureCtx) {
    measureCtx.font = `${HUD_PILL.fontStyle} ${HUD_PILL.fontSize}px ${HUD_PILL.fontFamily}`;
    advance = measureCtx.measureText(text).width;
  }
  return Math.ceil(advance) + HUD_PILL.padX * 2;
}

/**
 * Where a distance pill goes on its measured span, in screen pixels relative
 * to the span's midpoint.
 *
 * On the line when the span is long enough to show both end caps either side
 * of it, as Figma does. Beside it otherwise (below a horizontal span, right
 * of a vertical one), so a short span is never hidden under its own number.
 */
export function segmentLabelOffset(
  orientation: 'horizontal' | 'vertical',
  spanPx: number,
  pill: { width: number; height: number }
): { dx: number; dy: number; onLine: boolean } {
  const along = orientation === 'horizontal' ? pill.width : pill.height;
  const clearance = 12;
  if (spanPx >= along + clearance * 2) {
    return { dx: -pill.width / 2, dy: -pill.height / 2, onLine: true };
  }
  return orientation === 'horizontal'
    ? { dx: -pill.width / 2, dy: 6, onLine: false }
    : { dx: 6, dy: -pill.height / 2, onLine: false };
}

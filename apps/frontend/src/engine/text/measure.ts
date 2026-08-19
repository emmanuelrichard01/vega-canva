/**
 * The adapter that gives `layout.ts` real glyph advances.
 *
 * Two things live here and nowhere else: the measurement itself, and the fact
 * that a measurement taken before a webfont arrives is wrong.
 *
 * Konva does the measuring rather than a raw `ctx.measureText`, for the same
 * reason `stickyFit` uses a Konva probe: the canvas is what will actually draw
 * these glyphs, and a second measurement engine that agrees "closely" produces
 * text that shifts under the caret the instant you stop typing.
 */

import Konva from 'konva';
import type { Typography } from '../model/schema';
import { konvaFontStyle } from '../../components/canvas/renderers/shared';
import type { TextMeasurer } from './layout';

/**
 * One offscreen text node, reused.
 *
 * A `Konva.Text` per measurement allocates on every keystroke, and laying out
 * a wrapped paragraph measures once per word. This one is never added to a
 * layer, so it is never drawn.
 */
let probe: Konva.Text | null = null;

function probeFor(typography: Typography): Konva.Text {
  probe ??= new Konva.Text({});
  probe.fontFamily(typography.fontFamily);
  probe.fontSize(typography.fontSize);
  probe.fontStyle(konvaFontStyle(typography));
  // Tracking is added by the layout, not here: `getTextWidth` would apply it
  // per line and the layout applies it per run, and having both would double
  // it on every measurement the wrapper takes.
  probe.letterSpacing(0);
  probe.width(undefined);
  return probe;
}

/**
 * A measurer bound to one typography.
 *
 * Cheap to create and not worth caching — the probe behind it is the shared
 * one, so this closure is the only allocation.
 */
export function measurerFor(typography: Typography): TextMeasurer {
  return (text: string) => {
    if (text === '') return 0;
    const p = probeFor(typography);
    p.text(text);
    return p.getTextWidth();
  };
}

/**
 * Webfonts arrive after the first paint, and every layout measured before they
 * do is measured against a fallback face.
 *
 * Canvas measurement uses whatever font is resolvable at that moment, so the
 * first render of a board wraps against the wrong metrics and then keeps the
 * result — text looks subtly wrong on a cold load and correct on a warm one,
 * which is the worst way for a bug to present. The epoch is what lets a
 * consumer re-run its layout when the real face lands.
 *
 * Deliberately the same shape as `stickyFontEpoch`, which solved this first.
 */
let epochValue = 0;
const listeners = new Set<() => void>();

export const textFontEpoch = {
  get: (): number => epochValue,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

if (typeof document !== 'undefined' && document.fonts?.ready) {
  document.fonts.ready.then(() => {
    probe = null;
    epochValue += 1;
    listeners.forEach((fn) => fn());
  });
}

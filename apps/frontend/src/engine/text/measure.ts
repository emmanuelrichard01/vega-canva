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
import { canvasFontFamily, konvaFontStyle } from '../../components/canvas/renderers/shared';
import type { TextMeasurer } from './layout';
import { onFontsChanged, requestFont } from './fontEpoch';

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
  probe.fontFamily(canvasFontFamily(typography.fontFamily));
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
    if (typeof document === 'undefined') {
      // Headless / Node.js test environment fallback when no DOM canvas is available
      return text.length * typography.fontSize * 0.55;
    }
    const p = probeFor(typography);
    p.text(text);
    return p.getTextWidth();
  };
}

/**
 * A measurement taken before a webfont arrives is wrong, and this is how the
 * layout finds out that it has to be redone. The mechanism lives in
 * `fontEpoch`; all this module owes it is dropping the probe, whose bound face
 * is now stale.
 */
onFontsChanged(() => {
  probe = null;
});


/**
 * Ask for a family so it is actually fetched, rather than hoping something in
 * the DOM happens to use it.
 *
 * Canvas is the only consumer of most of these faces, and a canvas is not
 * reliable at triggering the load in time. Translating the family to a font
 * shorthand is the only work here; the deduping and the epoch are `fontEpoch`'s.
 */
export function ensureFontLoaded(family: string | undefined): void {
  if (!family) return;
  requestFont(`16px ${canvasFontFamily(family)}`);
}

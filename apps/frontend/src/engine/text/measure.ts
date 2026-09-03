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
import { ensureFamilyStylesheet } from './fontCatalogue';

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
export function ensureFontLoaded(
  family: string | undefined,
  weight?: number,
  italic?: boolean,
): void {
  if (!family) return;

  /**
   * The weight is part of the request, not decoration on it.
   *
   * This asked for `16px <family>`, which means weight 400 — and for a
   * **static** family that is a different file from the one about to be drawn.
   * Poppins, Libre Baskerville, IBM Plex Mono and the rest ship one file per
   * weight, so text set in Bold had its Regular fetched, measured against the
   * fallback, and laid out at a width the real face never has. Variable
   * families hid it, because for them every weight is the same file.
   *
   * `requestFont` has always taken a full shorthand — its own docstring shows
   * `"600 16px Caveat"` — so this passes through what was already supported.
   */
  const slant = italic ? 'italic ' : '';
  const spec = `${slant}${weight ?? 400} 16px ${canvasFontFamily(family)}`;

  /**
   * The stylesheet **first**, then the face.
   *
   * Most families are fetched on demand now (see `fontCatalogue`), and
   * `document.fonts.load` cannot find a face the page has no `@font-face` rule
   * for yet: it resolves having matched nothing, `requestFont` reads that as
   * "the fallback is what is drawn, so there is nothing to redo", and the
   * epoch never moves. Since `requestFont` records a spec before acting on it,
   * that one wasted attempt then blocks the real one permanently — the face
   * arrives, the text is drawn in it, and the layout keeps the widths of the
   * font it replaced.
   *
   * Doing this here rather than at every call site is what made the whole
   * catalogue lazy without touching the renderers: they already ask for their
   * family on every render, so a document arriving with text in a face this
   * browser has never seen loads it on the first frame that draws it.
   */
  void ensureFamilyStylesheet(family).then(() => requestFont(spec));
}


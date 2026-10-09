/**
 * A text object's letterforms, as one editable path.
 *
 * ## Whose layout wins
 *
 * Two engines could decide where each glyph goes, and they must not both.
 *
 * - **The app's own `layoutText`** already decided where the lines break, where
 *   each line starts for the alignment in force, and where its baseline sits.
 *   That is what is on the canvas, and it is measured with the same Canvas2D
 *   metrics the renderer uses.
 * - **The font** knows how far to advance between two particular glyphs, which
 *   is not a constant: `AV` sits tighter than `AN`, and `fi` may be one glyph.
 *
 * So the lines come from the layout and the advances within a line come from
 * the font. Taking the line breaks from the font's own shaper instead would
 * produce outlines that were *correct* and did not match the object they
 * replaced — text that visibly re-wrapped the instant you converted it, which
 * is the one thing this command must never do.
 *
 * ## What is deliberately not carried over
 *
 * Underline and strikethrough are drawn by the renderer as rectangles, not by
 * the font; a list marker likewise. Outlining is a conversion of *letterforms*,
 * and inventing bars for them here would mean two implementations of the same
 * decoration that could drift apart. They are reported instead, so the caller
 * can tell the user what the conversion will drop.
 */

import { applyTextCase } from '../model/textCase';
import { layoutText, type TextLayout } from './layout';
import { measurerFor } from './measure';
import { glyphContours, outlineToGeometry, type GlyphCommand } from './glyphOutline';
import { loadFont } from './fontBinary';
import type { BezierGeometry, CompoundGeometry, TextNode } from '../model/schema';

/**
 * Named `OutlinedText`, not `TextOutline`: the schema already has a
 * `TextOutline`, and it is the *stroke around* the letterforms rather than the
 * letterforms themselves. Two meanings for one name in one codebase is how a
 * field ends up read by something that wanted the other one.
 */
export interface OutlinedText {
  /** Every letterform, filled as one shape so counters stay holes. */
  geometry: CompoundGeometry;
  /**
   * The same letterforms, one geometry per laid-out line that drew anything,
   * in reading order. What "convert to path" makes of a paragraph: a line is
   * the unit people re-set, nudge and recolour.
   */
  lines: CompoundGeometry[];
  /** Decoration the font could not express, named so it can be reported. */
  dropped: string[];
}

/** The layout the canvas is currently drawing for this node. */
function layoutOf(node: TextNode): TextLayout {
  const t = node.typography;
  return layoutText({
    text: applyTextCase(node.text, t.textCase),
    list: t.list,
    wrap: node.resize === 'width' ? 'none' : 'word',
    width: node.width,
    height: node.resize === 'fixed' ? node.height : undefined,
    fontSize: t.fontSize,
    lineHeight: t.lineHeight,
    letterSpacing: t.letterSpacing,
    paragraphSpacing: t.paragraphSpacing,
    align: t.align,
    verticalAlign: t.verticalAlign,
    ellipsis: node.resize === 'fixed',
    measure: measurerFor(t),
  });
}

/**
 * Turn a text node's glyphs into geometry in the node's own local space.
 *
 * Returns null when there is nothing to draw — an empty box, or a run of
 * spaces. The caller then leaves the text alone rather than replacing it with
 * an object that renders as nothing and cannot be selected.
 *
 * Asynchronous because the font file has to be fetched and parsed; see
 * `fontBinary`. It throws `FontUnavailableError` for a family that cannot be
 * read, which is a sentence fit to show someone.
 */
export async function outlineText(node: TextNode): Promise<OutlinedText | null> {
  const t = node.typography;
  const font = await loadFont(t.fontFamily, t.fontWeight, t.italic);

  const layout = layoutOf(node);
  // Font units to pixels. Reading it from the file rather than assuming 1000 or
  // 2048 is the difference between a correct outline and one at 200% or 49%.
  const scale = t.fontSize / font.unitsPerEm;

  const contours: BezierGeometry[] = [];
  const lines: CompoundGeometry[] = [];

  for (const line of layout.lines) {
    if (!line.text) continue;
    const lineStart = contours.length;

    const baseline = line.y + line.baseline;

    // A justified line is placed word by word, at the layout's own positions;
    // anything else is one run from the line's start.
    const runs: { text: string; x: number; width: number }[] =
      line.words && line.words.length > 0
        ? line.words.map((w) => ({ text: w.text, x: line.x + w.x, width: w.width }))
        : [{ text: line.text, x: line.x, width: line.width }];

    for (const piece of runs) {
      const run = font.layout(piece.text);
      /**
       * Alignment is re-applied with the shaped width.
       *
       * The layout centred or right-aligned the line using the canvas'
       * measurement, and the font's kerned advances sum to a slightly
       * different width. Starting at the layout's `x` regardless would let
       * that difference pile up at one end: a centred heading would come out a
       * pixel or two off centre. So the shaped run keeps the layout's centre
       * (or right edge) instead of its left edge.
       */
      let shaped = 0;
      for (const pos of run.positions) shaped += pos.xAdvance * scale + t.letterSpacing;
      const slack = piece.width - shaped;
      const lone = runs.length === 1;
      const shift = !lone ? 0 : t.align === 'center' ? slack / 2 : t.align === 'right' ? slack : 0;
      let pen = piece.x + shift;

      for (let i = 0; i < run.glyphs.length; i++) {
        const glyph = run.glyphs[i];
        const pos = run.positions[i];
        const commands = glyph.path.commands as GlyphCommand[];
        // A space has an advance and no contours, which is not an error.
        if (commands.length > 0) {
          // GPOS offsets: where a mark sits over its base, or a kerning pair
          // expressed as a shift rather than an advance.
          contours.push(
            ...glyphContours(commands, {
              x: pen + (pos.xOffset ?? 0) * scale,
              y: baseline - (pos.yOffset ?? 0) * scale,
              scale,
            })
          );
        }
        // The kerned advance: fontkit applies the font's `kern`/GPOS pairs.
        pen += pos.xAdvance * scale;
        /**
         * Tracking, added per glyph the way the layout added it per character.
         *
         * `advance()` in `layout.ts` adds `letterSpacing` after every character
         * including the last, which is what Konva does — so the outline has to
         * match that or a tracked line would end up shorter than the box it
         * came out of. A ligature is one glyph where the layout counted two
         * characters; that is under a pixel at any normal tracking and is the
         * price of using real shaping.
         */
        pen += t.letterSpacing;
      }
    }
    const drawn = outlineToGeometry(contours.slice(lineStart));
    if (drawn) lines.push(drawn);
  }

  const geometry = outlineToGeometry(contours);
  if (!geometry) return null;

  const dropped: string[] = [];
  if (t.underline) dropped.push('underline');
  if (t.strikethrough) dropped.push('strikethrough');
  if (t.list) dropped.push('list markers');
  if (t.colorCycle) dropped.push('the colour ramp');
  if (t.highlight) dropped.push('the highlight');
  if (t.glow) dropped.push('the glow');
  if (t.outline) dropped.push('the letterform stroke');

  return { geometry, lines, dropped };
}

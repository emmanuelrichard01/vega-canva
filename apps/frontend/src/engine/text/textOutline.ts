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

  for (const line of layout.lines) {
    if (!line.text) continue;

    // Where the glyphs actually sit: the line's left edge, already resolved
    // from the alignment, and its baseline within its own box.
    let pen = line.x;
    const baseline = line.y + line.baseline;

    const run = font.layout(line.text);
    for (let i = 0; i < run.glyphs.length; i++) {
      const glyph = run.glyphs[i];
      const commands = glyph.path.commands as GlyphCommand[];
      // A space has an advance and no contours, which is not an error.
      if (commands.length > 0) {
        contours.push(...glyphContours(commands, { x: pen, y: baseline, scale }));
      }
      pen += run.positions[i].xAdvance * scale;
      /**
       * Tracking, added per glyph the way the layout added it per character.
       *
       * `advance()` in `layout.ts` adds `letterSpacing` after every character
       * including the last, which is what Konva does — so the outline has to
       * match that or a tracked line would end up shorter than the box it came
       * out of. A ligature is one glyph where the layout counted two
       * characters, which makes the two disagree by one space's worth of
       * tracking on a line containing `fi`. That is under a pixel at any normal
       * tracking and is the price of using real shaping.
       */
      pen += t.letterSpacing;
    }
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

  return { geometry, dropped };
}

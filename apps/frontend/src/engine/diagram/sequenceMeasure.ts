/**
 * The real text measurer for sequence diagrams.
 *
 * `sequence.ts` takes its measurer as a parameter so it stays pure and
 * testable, and defaults to a character-count estimate. That default is fine
 * for a test and wrong for a diagram: it does not know that "Identity
 * provider" is wider than "Single-page app" despite being a character shorter,
 * so boxes come out too small for their names and the words run outside them.
 *
 * This is the one the app uses. It lives in its own module rather than in
 * `sequence.ts` because it reaches for a canvas probe, which is exactly the
 * dependency the layout is kept clear of.
 *
 * ## Why both renderers share it
 *
 * The preview draws SVG and the board draws Konva, and neither can be trusted
 * to wrap a string the same way as the other. So neither of them wraps: the
 * layout decides where the lines break, once, and hands the same `lines` array
 * to both. A preview that broke its text differently from the insert would be
 * showing a diagram nobody is about to get, which is worse than no preview.
 */

import { layoutText } from '../text/layout';
import { measurerFor } from '../text/measure';
import { diagramTypography } from './build';
import type { Measurer } from './sequence';

/**
 * A measurer in the diagram's own face.
 *
 * Sketch mode swaps Inter for Caveat, which is materially narrower, so a
 * diagram measured in the wrong one is wrong by the ratio between them --
 * the same reason `buildDiagram` settles its typography before sizing.
 */
export function sequenceMeasurer(isSketch = false): Measurer {
  const typography = diagramTypography(isSketch);

  return (text, { fontSize, maxWidth }) => {
    if (!text.trim()) return { width: 0, height: fontSize * 1.35, lines: [] };

    const measure = measurerFor({ ...typography, fontSize } as never);
    const common = {
      text,
      fontSize,
      lineHeight: typography.lineHeight,
      letterSpacing: typography.letterSpacing,
      align: 'center' as const,
      measure,
    };

    const laid = maxWidth
      ? layoutText({ ...common, wrap: 'word', width: maxWidth })
      : layoutText({ ...common, wrap: 'none' });

    return {
      width: laid.width,
      height: laid.height,
      lines: laid.lines.map((line) => line.text),
    };
  };
}

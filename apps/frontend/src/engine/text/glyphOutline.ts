/**
 * Glyph outlines, as the document's own bezier geometry.
 *
 * ## What this is for
 *
 * "Convert to path" on a text object has to produce the *real* letterforms —
 * the curves the type designer drew — not a trace of a rasterised bitmap. Those
 * live in the font binary, and this is the step that turns them into something
 * the canvas can store, edit anchor by anchor, and export.
 *
 * ## Three conversions, all of them easy to get subtly wrong
 *
 * 1. **Quadratic to cubic.** TrueType outlines are quadratic; the document
 *    stores cubics. The exact equivalent is `c1 = p0 + 2/3 (q - p0)`,
 *    `c2 = p1 + 2/3 (q - p1)` — not the midpoint, which is the approximation
 *    people reach for and which visibly flattens a bowl.
 * 2. **The y axis turns over.** A font's y grows *upward* from the baseline;
 *    the canvas' grows downward. Every point flips, and so does the sense of
 *    every curve — which is why holes still come out as holes.
 * 3. **Units per em.** Outlines are in font units (2048 for most TrueType
 *    faces, 1000 for most CFF ones), so the scale is `fontSize / unitsPerEm`.
 *    Hard-coding either number is a bug that only shows on the other kind.
 *
 * Kept free of `fontkit` and of the document so it can be tested against a
 * handful of commands with a pencil and paper.
 */

import type { BezierGeometry, BezierSegment, CompoundGeometry } from '../model/schema';

/**
 * One drawing command, in the shape `fontkit` emits.
 *
 * Structural rather than imported: this module does not depend on the font
 * library, and the two would only ever be coupled by this one type.
 */
export interface GlyphCommand {
  command: 'moveTo' | 'lineTo' | 'quadraticCurveTo' | 'bezierCurveTo' | 'closePath';
  args: readonly number[];
}

/** Where a glyph sits, and how big. */
export interface GlyphPlacement {
  /** The pen position: the glyph's origin on the baseline, in node-local pixels. */
  x: number;
  y: number;
  /** `fontSize / unitsPerEm`. */
  scale: number;
}

/**
 * Turn one glyph's commands into closed contours in node-local pixels.
 *
 * A glyph is naturally several contours — an `o` is two, an `i` is two, an `%`
 * is five — so this returns a list. They are all `closed`, because a glyph
 * outline that did not close would fill as a wedge running off to wherever the
 * fill rule decided.
 */
export function glyphContours(
  commands: readonly GlyphCommand[],
  place: GlyphPlacement
): BezierGeometry[] {
  const out: BezierGeometry[] = [];
  let segments: BezierSegment[] = [];

  // Font units to node-local pixels, with the y axis turned over.
  const px = (v: number) => place.x + v * place.scale;
  const py = (v: number) => place.y - v * place.scale;

  /** The pen, in *font* units, because that is what the next command speaks. */
  let cx = 0;
  let cy = 0;

  const flush = () => {
    // Two anchors is a degenerate contour with no area; one is a stray moveTo.
    // Both happen in real fonts (a `.notdef` box, an accent stub) and both fill
    // as nothing, so they are dropped rather than stored.
    if (segments.length > 2) out.push({ kind: 'bezier', segments, closed: true });
    segments = [];
  };

  for (const { command, args } of commands) {
    switch (command) {
      case 'moveTo': {
        flush();
        [cx, cy] = args as [number, number];
        segments.push({ x: px(cx), y: py(cy) });
        break;
      }
      case 'lineTo': {
        const [x, y] = args as [number, number];
        segments.push({ x: px(x), y: py(y) });
        cx = x;
        cy = y;
        break;
      }
      case 'quadraticCurveTo': {
        const [qx, qy, x, y] = args as [number, number, number, number];
        // The exact cubic for a quadratic: each control point two thirds of the
        // way from its own endpoint towards the single quadratic control.
        segments.push({
          x: px(x),
          y: py(y),
          cp1x: px(cx + (2 / 3) * (qx - cx)),
          cp1y: py(cy + (2 / 3) * (qy - cy)),
          cp2x: px(x + (2 / 3) * (qx - x)),
          cp2y: py(y + (2 / 3) * (qy - y)),
        });
        cx = x;
        cy = y;
        break;
      }
      case 'bezierCurveTo': {
        const [c1x, c1y, c2x, c2y, x, y] = args as [number, number, number, number, number, number];
        segments.push({
          x: px(x),
          y: py(y),
          cp1x: px(c1x),
          cp1y: py(c1y),
          cp2x: px(c2x),
          cp2y: py(c2y),
        });
        cx = x;
        cy = y;
        break;
      }
      case 'closePath':
        flush();
        break;
    }
  }

  // A font need not end on `closePath`; the last contour is closed anyway.
  flush();
  return out;
}

/**
 * Every contour of every glyph, as one fillable object.
 *
 * `compound` and not a group of separate paths: the counter of an `o` is a
 * *hole*, and a hole is only a hole when it is filled together with the ring
 * round it under the even-odd rule. Two objects would give a solid ring and a
 * solid disc sitting on top of it, which is the same picture until you change
 * the colour of one.
 *
 * Returns null when there was nothing to draw — a string of spaces, or a run
 * the font has no glyphs for. The caller then leaves the text alone rather than
 * replacing it with an empty object.
 */
export function outlineToGeometry(contours: readonly BezierGeometry[]): CompoundGeometry | null {
  if (contours.length === 0) return null;
  return { kind: 'compound', subpaths: [...contours] };
}

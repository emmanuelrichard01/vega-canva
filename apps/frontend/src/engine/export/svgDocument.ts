import type { ExportBounds } from './bounds';

/**
 * Assembling the finished SVG file.
 *
 * ## Why this is not three lines at the bottom of `SVGExporter`
 *
 * It was, and one of them was missing. `SvgPaintDefs` collects a
 * `<linearGradient>` or `<radialGradient>` for every gradient fill it is asked
 * about and hands back `fill="url(#vg0)"` — and the call to its `markup()`, the
 * method that writes those definitions into the file, **did not exist
 * anywhere**. Every gradient-filled object in every exported SVG referenced a
 * paint server that was not in the document.
 *
 * That failure is invisible in exactly the way that makes it survive: a missing
 * paint reference is not an error in SVG, so the file opened cleanly in every
 * viewer, passed validation, and simply drew those shapes unpainted. Nothing
 * downstream could tell it had happened.
 *
 * So the ordering rule — definitions, then the backdrop, then the artwork —
 * lives in one pure function that takes the collector and is obliged to drain
 * it. A caller cannot now forget the step, because the step is not theirs to
 * remember; and it can be asserted in Node with no canvas, which is the whole
 * reason the arithmetic in this codebase lives outside its components.
 */

/** The part of `SvgPaintDefs` this module needs, so a test can pass a stub. */
export interface PaintDefs {
  markup(): string;
}

export interface SvgDocumentInput {
  bounds: ExportBounds;
  /** The collector the document walk registered its gradients into. */
  defs: PaintDefs;
  /** Resolved background colour, or `null` to leave the file transparent. */
  background: string | null;
  /** One entry per node, already in stacking order. */
  body: string[];
}

/**
 * The order the three layers have to be written in.
 *
 * Definitions first: browsers resolve `url(#id)` references in either
 * direction, but several converters — Illustrator's SVG reader among them —
 * only look backwards, so a forward reference is silently dropped there. Then
 * the backdrop, because it is behind everything by definition. Then the
 * artwork, which is already ordered by z-index.
 */
export function assembleSvg({ bounds, defs, background, body }: SvgDocumentInput): string {
  const backdrop = background
    ? `<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="${background}" />`
    : '';

  const layers = [defs.markup(), backdrop, body.filter(Boolean).join('\n')].filter(Boolean);

  /**
   * `viewBox` and an explicit `width`/`height` together.
   *
   * The viewBox alone makes the file scale to whatever box it is dropped into,
   * which is right for the web and wrong for an editor — Illustrator and Figma
   * both read the intrinsic size to decide the artboard, and without one a
   * board comes in at some default and has to be resized by hand.
   */
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}" width="${bounds.width}" height="${bounds.height}">
${layers.join('\n')}
</svg>`;
}

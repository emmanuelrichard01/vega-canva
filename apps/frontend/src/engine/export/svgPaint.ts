import {
  isGradient,
  paintColor,
  sortedStops,
  withAlpha,
  type Paint,
  type PaintBox,
} from '../model/paint';

/**
 * Gradients in exported SVG.
 *
 * A gradient is not an attribute in SVG, it is an element in `<defs>` that an
 * attribute points at — so emitting one means collecting definitions while
 * walking the document and writing them out at the top. This is that
 * collector.
 *
 * Coordinates are emitted in `userSpaceOnUse`, not `objectBoundingBox`.
 * Bounding-box units look like the natural fit for a model that already stores
 * unit space, but they define a radius against a normalised diagonal rather
 * than against a dimension, so a radial gradient on a wide shape would come
 * out a different size in the SVG than on the canvas. Absolute coordinates
 * cost a multiply here and make the two agree exactly.
 */
export class SvgPaintDefs {
  private readonly defs: string[] = [];
  private seq = 0;

  /**
   * The `fill` attribute value for a paint, registering a gradient if needed.
   *
   * Conic and diamond fall back to their first stop's colour. SVG has no conic
   * gradient in any shipped version, and the alternative — a fan of several
   * hundred `<path>` wedges per shape — would turn a document with a dozen
   * gradients into a file no editor will open. A flat colour that is
   * recognisably the right one is the better failure, and it is recorded in
   * the spec as a format limitation rather than left to be discovered.
   */
  fill(paint: Paint | undefined, box: PaintBox, fallback: string): string {
    if (!paint) return fallback;
    if (!isGradient(paint)) return withAlpha(paint.color || fallback, paint.opacity);

    const stops = sortedStops(paint)
      .map((s) => `<stop offset="${s.offset}" stop-color="${s.color}" stop-opacity="${s.opacity ?? 1}" />`)
      .join('');

    const id = `vg${this.seq++}`;
    const at = (p: { x: number; y: number }) => ({
      x: box.x + p.x * box.width,
      y: box.y + p.y * box.height,
    });

    if (paint.type === 'linear') {
      const from = at(paint.from);
      const to = at(paint.to);
      this.defs.push(
        `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}">${stops}</linearGradient>`
      );
      return `url(#${id})`;
    }

    if (paint.type === 'radial') {
      const centre = at(paint.center);
      const r = Math.max(1, paint.radius * Math.max(box.width, box.height));
      this.defs.push(
        `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${centre.x}" cy="${centre.y}" r="${r}">${stops}</radialGradient>`
      );
      return `url(#${id})`;
    }

    // Rolled back, so the id is not consumed by a definition never written.
    this.seq--;
    return paintColor(paint, fallback);
  }

  /** The `<defs>` block, or an empty string when nothing needed one. */
  markup(): string {
    return this.defs.length ? `<defs>${this.defs.join('')}</defs>` : '';
  }
}

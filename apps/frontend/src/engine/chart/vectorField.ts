/**
 * Slope fields and vector fields: a direction at every point of a grid.
 *
 * ## Why these are one module
 *
 * A slope field draws `dy/dx = f(x, y)` as a short segment at each grid point,
 * and a vector field draws `F(x, y) = ⟨P, Q⟩` as an arrow. They differ in two
 * respects only: a slope has no *magnitude* and no *sign* — it is a direction
 * through the point, not a displacement from it — so its marks are all the same
 * length and carry no head.
 *
 * That is a real distinction and it is the reason a slope field is not merely a
 * vector field of `⟨1, f⟩`. Drawing arrowheads on a slope field asserts a
 * direction of travel that the differential equation does not state: the
 * solution through a point runs both ways, and an arrow says otherwise.
 *
 * ## Normalisation, and what it costs
 *
 * A slope field's segments are all one length, which is what makes the *shape*
 * of the solution family readable — long marks where the slope is steep would
 * turn the interesting regions into a solid block of ink. A vector field keeps
 * its magnitudes, scaled to the cell, because for a vector field magnitude is
 * half the content.
 *
 * The trade is stated rather than hidden: a slope field cannot show you where
 * the slope is large, only where it points. That is what the field is for, and
 * anyone wanting magnitude wants a vector field.
 */

export interface FieldMark {
  /** Grid position, in the function's own units. */
  x: number;
  y: number;
  /** The mark's two ends, already in function units and centred on (x, y). */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Magnitude before normalisation, for colouring. NaN where undefined. */
  magnitude: number;
}

export interface FieldOptions {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  /** Marks per axis. Cost is quadratic, so the caller caps it. */
  density: number;
}

/**
 * A slope field for `dy/dx = f(x, y)`.
 *
 * Every mark is the same length and has no head. The length is a fraction of
 * the cell so the field stays readable at any density: marks that overlap their
 * neighbours read as a texture rather than as directions.
 */
export function slopeField(
  f: (x: number, y: number) => number,
  options: FieldOptions
): FieldMark[] {
  const n = Math.min(60, Math.max(3, Math.round(options.density)));
  const { xMin, xMax, yMin, yMax } = options;
  if (!(xMax > xMin) || !(yMax > yMin)) return [];

  const dx = (xMax - xMin) / n;
  const dy = (yMax - yMin) / n;
  // 0.4 of a cell each way, so a mark spans 80% of its cell and never touches
  // its neighbour.
  const reach = 0.4;

  const out: FieldMark[] = [];

  for (let iy = 0; iy <= n; iy += 1) {
    for (let ix = 0; ix <= n; ix += 1) {
      const x = xMin + ix * dx;
      const y = yMin + iy * dy;
      const slope = f(x, y);
      if (!Number.isFinite(slope)) continue;

      /**
       * The direction is `⟨1, slope⟩` normalised — *in the function's units*,
       * then scaled by the cell in each axis separately.
       *
       * Normalising in function units and then scaling per axis is what makes
       * a slope of 1 draw at 45° on screen when the axes are equal, and lean
       * correctly when they are not. Normalising after the axis scaling would
       * make every mark the same *screen* length but the wrong angle, which is
       * the one thing a slope field may not get wrong.
       */
      const len = Math.hypot(1, slope);
      const ux = 1 / len;
      const uy = slope / len;

      out.push({
        x,
        y,
        x1: x - ux * dx * reach,
        y1: y - uy * dy * reach,
        x2: x + ux * dx * reach,
        y2: y + uy * dy * reach,
        magnitude: Math.abs(slope),
      });
    }
  }

  return out;
}

/**
 * A vector field for `F(x, y) = ⟨P, Q⟩`.
 *
 * Magnitudes are kept and scaled so the longest arrow in the field spans a
 * cell. Scaling by the field's own maximum rather than by a constant is what
 * lets one control work for a field of unit vectors and a field in the
 * thousands, and it is why the returned magnitude is the *unscaled* one — a
 * caller colouring by strength wants the physical value, not the drawing's.
 */
export function vectorField(
  p: (x: number, y: number) => number,
  q: (x: number, y: number) => number,
  options: FieldOptions
): FieldMark[] {
  const n = Math.min(60, Math.max(3, Math.round(options.density)));
  const { xMin, xMax, yMin, yMax } = options;
  if (!(xMax > xMin) || !(yMax > yMin)) return [];

  const dx = (xMax - xMin) / n;
  const dy = (yMax - yMin) / n;

  const raw: Array<{ x: number; y: number; px: number; qy: number; m: number }> = [];
  let peak = 0;

  for (let iy = 0; iy <= n; iy += 1) {
    for (let ix = 0; ix <= n; ix += 1) {
      const x = xMin + ix * dx;
      const y = yMin + iy * dy;
      const px = p(x, y);
      const qy = q(x, y);
      if (!Number.isFinite(px) || !Number.isFinite(qy)) continue;

      const m = Math.hypot(px, qy);
      if (m > peak) peak = m;
      raw.push({ x, y, px, qy, m });
    }
  }

  if (peak === 0) return [];

  const out: FieldMark[] = [];
  for (const v of raw) {
    // Scaled against the field's own peak, so the longest arrow spans 0.9 of a
    // cell whatever units the field is in.
    const k = 0.9 / peak;
    // Drawn from the sample point rather than centred on it: a vector *is* a
    // displacement from where it is measured, and centring it would put half
    // the arrow behind the point it describes.
    out.push({
      x: v.x,
      y: v.y,
      x1: v.x,
      y1: v.y,
      x2: v.x + v.px * k * dx,
      y2: v.y + v.qy * k * dy,
      magnitude: v.m,
    });
  }

  return out;
}

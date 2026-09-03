/**
 * A rectangle's four corner radii.
 *
 * ## Why one field holds both forms
 *
 * The obvious design is `cornerRadius: number` plus `cornerRadii?: [4]` for the
 * independent case, and it is the wrong one for the reason this codebase keeps
 * relearning: it is **two places to store one fact**. A reader has to decide
 * which wins, every reader has to decide the same way, and the day one of them
 * disagrees is the day a shape draws with four different corners in the
 * renderer and one in the exporter. `DATA-MODEL.md` opens with the version of
 * that mistake which cost this project the most — a size living in three
 * places, read with different precedence in six modules.
 *
 * So `Appearance.cornerRadius` is a number **or** a tuple, and everything that
 * reads it goes through `cornerRadiiOf`, which always answers four. That is the
 * shape `localVertices` already uses for the three ways a line can store its
 * run — "one reader answers all forms", so the renderer, the outline, the
 * exporter, the sketcher and the panel cannot disagree about where a corner is.
 *
 * ## Why a tuple and not four named fields
 *
 * Konva's `Rect` takes `[topLeft, topRight, bottomRight, bottomLeft]` natively,
 * and SVG needs the same order to build a path. A tuple in that order is what
 * both want, and naming the four separately would mean an assembly step in
 * every consumer — four more places to put them in the wrong order.
 */

/** Clockwise from the top-left, which is Konva's order and SVG's. */
export type CornerRadii = [number, number, number, number];

export type CornerRadiusValue = number | CornerRadii;

/** Whether a stored value is the four-corner form. */
export function isPerCorner(value: CornerRadiusValue | undefined): value is CornerRadii {
  return Array.isArray(value) && value.length === 4;
}

/**
 * The four radii, whatever form they were stored in.
 *
 * Always four numbers, always non-negative. A caller never has to ask which
 * form it got, which is the entire point.
 */
export function cornerRadiiOf(value: CornerRadiusValue | undefined): CornerRadii {
  if (isPerCorner(value)) {
    return [
      Math.max(0, value[0] || 0),
      Math.max(0, value[1] || 0),
      Math.max(0, value[2] || 0),
      Math.max(0, value[3] || 0),
    ];
  }
  const r = Math.max(0, typeof value === 'number' ? value : 0);
  return [r, r, r, r];
}

/** Whether all four are the same, which is what the link toggle shows. */
export function isUniform(value: CornerRadiusValue | undefined): boolean {
  const [a, b, c, d] = cornerRadiiOf(value);
  return a === b && b === c && c === d;
}

/**
 * The value to store for four radii.
 *
 * Collapses to a plain number when they agree, so a shape that was never given
 * independent corners keeps the simple form — documents stay readable, the
 * common case stays one number, and nothing has to migrate. It is also what
 * makes `isUniform` cheap for every shape that has ever existed.
 */
export function packRadii(radii: CornerRadii): CornerRadiusValue | undefined {
  const [a, b, c, d] = radii.map((n) => Math.max(0, n || 0)) as CornerRadii;
  if (a === b && b === c && c === d) return a === 0 ? undefined : a;
  return [a, b, c, d];
}

/**
 * The radii a box can actually draw, each capped so adjacent corners do not
 * overlap.
 *
 * ## Why this is not simply `min(r, w/2, h/2)`
 *
 * That is the rule for a *uniform* radius and it is too strict once the four
 * differ: a 200×40 box can carry a 40-unit top-left corner perfectly well as
 * long as the top-right one is small, because what actually competes is a
 * **pair sharing an edge**, not each corner against the whole box.
 *
 * This is the same rule SVG's `rx`/`ry` and CSS's `border-radius` both use:
 * take the worst ratio along each edge and scale every radius by it. Doing it
 * per-corner instead produces a shape whose corners are individually legal and
 * whose edges have negative length — which draws as a bow-tie.
 */
export function fitRadii(radii: CornerRadii, width: number, height: number): CornerRadii {
  const [tl, tr, br, bl] = radii.map((n) => Math.max(0, n || 0)) as CornerRadii;
  const w = Math.max(0, width);
  const h = Math.max(0, height);
  const ratio = Math.min(
    1,
    // Each edge, against the pair of corners that share it.
    tl + tr > 0 ? w / (tl + tr) : Infinity,
    bl + br > 0 ? w / (bl + br) : Infinity,
    tl + bl > 0 ? h / (tl + bl) : Infinity,
    tr + br > 0 ? h / (tr + br) : Infinity
  );
  return [tl * ratio, tr * ratio, br * ratio, bl * ratio];
}

/**
 * A rounded rectangle as SVG path data, in the node's own coordinates.
 *
 * Needed because `shapeToPath` and the SVG exporter cannot express four
 * different corners with `rx` — SVG's `<rect>` has one radius per axis and no
 * per-corner form at all. A path is the only way to say it, and having one
 * function say it keeps the exporter and the outline agreeing by construction
 * rather than by two people writing the same arcs.
 */
export function roundedRectPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radii: CornerRadii
): string {
  const [tl, tr, br, bl] = fitRadii(radii, width, height);
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return (
    `M${r(x + tl)} ${r(y)}` +
    `H${r(x + width - tr)}` +
    (tr > 0 ? `A${r(tr)} ${r(tr)} 0 0 1 ${r(x + width)} ${r(y + tr)}` : '') +
    `V${r(y + height - br)}` +
    (br > 0 ? `A${r(br)} ${r(br)} 0 0 1 ${r(x + width - br)} ${r(y + height)}` : '') +
    `H${r(x + bl)}` +
    (bl > 0 ? `A${r(bl)} ${r(bl)} 0 0 1 ${r(x)} ${r(y + height - bl)}` : '') +
    `V${r(y + tl)}` +
    (tl > 0 ? `A${r(tl)} ${r(tl)} 0 0 1 ${r(x + tl)} ${r(y)}` : '') +
    'Z'
  );
}

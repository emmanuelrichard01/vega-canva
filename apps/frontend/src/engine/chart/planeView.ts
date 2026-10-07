/**
 * Settling one axis of a plot's view after a pan or a zoom.
 *
 * The view is written to the document, so it is rounded — otherwise a pan
 * writes `-6.500000000000001` into everybody's undo history. Rounding to a
 * fixed number of decimals collapses the view, though: zoom in far enough and
 * both ends round to the same value, the span is 0, and every later zoom
 * multiplies 0 — the plot is stuck until its view is reset. So the rounding is
 * relative to the span (about four significant digits of it), and the span is
 * held between a floor and a ceiling.
 */
export const MIN_PLANE_SPAN = 1e-9;
export const MAX_PLANE_SPAN = 1e12;

export function settleAxis(lo: number, hi: number): [number, number] {
  const mid = (lo + hi) / 2;
  if (!Number.isFinite(mid)) return [-10, 10];
  let span = hi - lo;
  if (!(span >= MIN_PLANE_SPAN)) span = MIN_PLANE_SPAN;
  if (span > MAX_PLANE_SPAN) span = MAX_PLANE_SPAN;
  const decimals = Math.max(0, Math.min(15, Math.ceil(-Math.log10(span)) + 4));
  const a = Number((mid - span / 2).toFixed(decimals));
  const b = Number((mid + span / 2).toFixed(decimals));
  // Rounding can still meet at the floor; keep the ends apart.
  return b > a ? [a, b] : [a, a + MIN_PLANE_SPAN];
}

export interface PlaneView {
  xMin: number;
  xMax: number;
  yPlotMin: number;
  yPlotMax: number;
}

export function settlePlane(xMin: number, xMax: number, yPlotMin: number, yPlotMax: number): PlaneView {
  const [x0, x1] = settleAxis(xMin, xMax);
  const [y0, y1] = settleAxis(yPlotMin, yPlotMax);
  return { xMin: x0, xMax: x1, yPlotMin: y0, yPlotMax: y1 };
}

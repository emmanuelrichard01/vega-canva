import { chartToSvg } from './chartSvg';
import { chartInkFor } from './chartInk';
import { isPlot, isTwoVariable, type ChartSpec } from './chartTypes';

/**
 * A preset drawn at thumbnail size, by the painter that draws the real thing.
 *
 * ## Why a live preview rather than an icon
 *
 * The gallery listed twenty-nine curves as names and one-line notes, which is
 * the right shape for a *kind* and the wrong one for an instance. "Cassini
 * ovals" and "Lemniscate" are two names; they are also two pictures, and the
 * picture is the whole of what somebody is choosing between. A hand-drawn icon
 * per preset would be twenty-nine more drawings to keep in step with twenty-
 * nine specs — the second-copy problem this codebase keeps paying for.
 *
 * So the thumbnail *is* the chart, laid out by `layoutChart` and painted by
 * `chartToSvg` — the same function the SVG export uses. It cannot drift from
 * what picking the preset produces, because it is produced the same way.
 *
 * ## What is stripped, and why
 *
 * A thumbnail is a silhouette, not a small chart. At 120x68 a title is
 * illegible, an axis is a grey smear and a legend is most of the pixels — all
 * three cost the space the curve needs to be recognisable. So the preview
 * shows the marks and the zero rules and nothing else, which is what makes a
 * rose distinguishable from a cardioid at a glance.
 *
 * ## Cost
 *
 * A contour at its authored resolution is ninety thousand evaluations *per
 * level*, and the gallery holds four of them. Every preview is therefore
 * re-specified at a resolution that suits its size: past about one sample per
 * pixel the extra work cannot be seen, so it is not done. Twenty-nine
 * thumbnails come in comfortably under a frame.
 */

/** The spec a preview is drawn from: the preset's, stripped and cheapened. */
export function thumbSpec(spec: ChartSpec, width: number, height: number): ChartSpec {
  const out: ChartSpec = {
    ...spec,
    // Furniture off. Each of these is illegible at this size and costs the
    // room the marks need.
    title: undefined,
    showLegend: false,
    showGrid: false,
    showValues: false,
    reference: undefined,
    showRoots: false,
    showExtrema: false,
    showDerivative: false,
    fillArea: false,
    riemann: undefined,
  };

  if (isTwoVariable(spec.kind)) {
    // Roughly one cell per two pixels: a marching-squares grid finer than the
    // thumbnail cannot show what it found.
    out.resolution = Math.min(spec.resolution ?? 60, Math.round(Math.min(width, height) / 2));
    if (spec.kind === 'contour') out.levels = Math.min(spec.levels ?? 6, 6);
  } else if (isPlot(spec.kind)) {
    out.samples = Math.min(spec.samples ?? 160, Math.max(64, width * 2));
  }

  return out;
}

/**
 * SVG markup for one preview.
 *
 * Returns the inner markup only — the caller supplies the `<svg>` and its
 * `viewBox`, so the preview scales with its card rather than carrying a fixed
 * size. The ink is passed explicitly rather than read from the DOM because a
 * gallery renders twenty-nine of these in one pass and asking the document for
 * the theme twenty-nine times is twenty-eight more class-list reads than the
 * answer changes in.
 */
export function presetThumbSvg(
  spec: ChartSpec,
  width: number,
  height: number,
  dark: boolean
): string {
  return chartToSvg(thumbSpec(spec, width, height), width, height, {
    // A fixed id, so a preview's sketch — if a preset ever carries one — is
    // stable between renders rather than reseeding as the list scrolls.
    id: `thumb-${spec.kind}`,
    ink: chartInkFor(dark),
  });
}

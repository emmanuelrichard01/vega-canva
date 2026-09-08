import { paintLayout } from './chartSvg';
import { layoutChart, type ChartLayout } from './chartLayout';
import { chartInkFor } from './chartInk';
import { isPlot, isTwoVariable, type ChartSpec } from './chartTypes';

/**
 * A preset drawn at thumbnail size, by the painter that draws the real thing.
 *
 * ## Why a live preview rather than an icon
 *
 * "Cassini ovals" and "Lemniscate" are two names; they are also two pictures,
 * and the picture is the whole of what somebody is choosing between. A
 * hand-drawn icon per preset would be sixty-three more drawings to keep in
 * step with sixty-three specs — the second-copy problem this codebase keeps
 * paying for. So the preview *is* the chart, laid out by `layoutChart` and
 * painted by `paintLayout`, the same pair the SVG export uses.
 *
 * ## The mistake this file used to make
 *
 * It asked the layout engine to fit a real chart into 124x70, and the engine
 * did as it was told. What came back:
 *
 * - **Overlapping text.** Typography is in absolute pixels, as it must be —
 *   an axis tick is 11px because 11px is legible. Five of them in a 70px box
 *   are spaced 3.75px apart and each is 11px tall, so they lie across one
 *   another three deep. That is the "buggy" look: not a bug in any one thing,
 *   just eleven-point type in a seventy-point box.
 * - **Blank cards.** A horizontal bar chart puts its category names down the
 *   left. At 124 wide the gutter for "Email"/"Chat"/"Phone" wanted 117px, the
 *   plot got what was left, the layout collapsed to a zero-size rect and the
 *   card rendered *nothing at all*. `tickets-channel` was an empty box.
 * - **Squashed marks.** Where it did draw, the marks got 40% of the width and
 *   half the height; the rest was gutter, holding the illegible text above.
 *
 * All three are the same error, which is that **a thumbnail is not a small
 * chart**. It is the chart's *silhouette*: the marks, the axis rules, and
 * nothing that has to be read.
 *
 * ## So: lay out big, strip the text, fit what is left
 *
 * 1. Lay out at a **reference size** the engine is designed for, in the card's
 *    aspect. Every gutter it reserves is correctly sized, because at 360 wide
 *    an 11px label *is* small.
 * 2. **Strip every text field from the layout** — not from the spec, from the
 *    laid-out result. Nothing that would be unreadable survives, and this is
 *    the step that also frees the space those labels were holding.
 * 3. **Fit the plot rect to the card.** The marks then fill the frame instead
 *    of hiding in the corner the gutters left them.
 *
 * Step 2 is why step 1 costs nothing: we pay for a correct layout and then
 * throw away the part that made it correct. It is the cheapest way to be sure
 * a card cannot show a shape the real chart does not produce — the alternative
 * is a second layout path for small sizes, which is the second copy again.
 *
 * Strokes are exempted from the fit by `vector-effect: non-scaling-stroke` in
 * the card's CSS, or a 1.5px baseline scaled by 0.3 would come out at half a
 * pixel and a line chart would be a rumour.
 *
 * ## Cost
 *
 * A contour is a marching-squares pass **per level** over a grid, so its cost
 * is in `resolution` and not in pixels. Resolution is therefore clamped
 * against the size the card is *displayed* at, which is the only size that can
 * show the difference — past about one cell per three display pixels the extra
 * work is invisible by construction. Same for a plot's `samples`.
 */

/**
 * The width every preview is laid out at.
 *
 * Chosen as the smallest size where the engine's absolute typography is still
 * in proportion — a chart this wide reserves gutters that look like gutters
 * rather than like half the picture. The height follows the card's aspect, so
 * the plot rect comes out close to the shape it has to be fitted into and the
 * uniform fit below wastes little.
 */
const LAYOUT_WIDTH = 360;
const LAYOUT_MIN_HEIGHT = 150;
const LAYOUT_MAX_HEIGHT = 330;

/** The reference box for a card of this shape. */
export function thumbLayoutBox(width: number, height: number): [number, number] {
  const ratio = height / Math.max(1, width);
  const h = Math.round(LAYOUT_WIDTH * ratio);
  return [LAYOUT_WIDTH, Math.max(LAYOUT_MIN_HEIGHT, Math.min(LAYOUT_MAX_HEIGHT, h))];
}

/**
 * The spec a preview is drawn from: the preset's, stripped and cheapened.
 *
 * `width` and `height` are the size the card is **shown** at, not the size it
 * is laid out at. Sampling density is a question about what the eye can
 * resolve, and the eye is looking at the card.
 */
export function thumbSpec(spec: ChartSpec, width: number, height: number): ChartSpec {
  const out: ChartSpec = {
    ...spec,
    // Furniture off at the source, where it also saves the work of laying it
    // out. What survives this is stripped from the layout instead, below.
    title: undefined,
    subtitle: undefined,
    footnote: undefined,
    xAxisLabel: undefined,
    yAxisLabel: undefined,
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
    // About one cell per three display pixels. A marching-squares grid finer
    // than that cannot show what it found, and a contour is the single most
    // expensive thing in the gallery — four of them were a third of the total.
    out.resolution = Math.min(
      spec.resolution ?? 60,
      Math.max(16, Math.round(Math.min(width, height) / 3))
    );
    if (spec.kind === 'contour') out.levels = Math.min(spec.levels ?? 6, 5);
  } else if (isPlot(spec.kind)) {
    // One sample per display pixel across. Nothing between two adjacent
    // samples can land on a different pixel.
    out.samples = Math.min(spec.samples ?? 160, Math.max(48, Math.round(width)));
  }

  return out;
}

/**
 * The same layout with everything that has to be *read* taken out.
 *
 * Stripped from the layout rather than from the spec because that is where the
 * complete list lives: every one of these fields is somewhere `paintLayout`
 * emits a `<text>`, and a test asserts a silhouette contains none. Add a
 * text-bearing field to `ChartLayout` and that test fails here, which is the
 * point of doing it at this seam.
 *
 * The axis rules stay. `baseline` and `zeroRule` are not furniture — a bar
 * chart without its baseline is bars floating in a box, and on a maths plot
 * the two rules *are* how you read which quadrant a curve is in.
 */
export function silhouette(layout: ChartLayout): ChartLayout {
  return {
    ...layout,
    title: null,
    subtitle: null,
    footnote: null,
    xAxisTitle: null,
    yAxisTitle: null,
    axisLabels: [],
    categoryLabels: [],
    valueLabels: [],
    legend: [],
    colorBar: null,
    donutMetric: null,
    // The band and the rule are shapes; only their labels are text.
    toleranceBand: layout.toleranceBand
      ? { ...layout.toleranceBand, label: undefined }
      : layout.toleranceBand,
    reference: layout.reference ? { ...layout.reference, label: undefined } : null,
  };
}

/**
 * SVG markup for one preview.
 *
 * Returns the inner markup only — the caller supplies the `<svg>` and its
 * `viewBox`, so the preview scales with its card rather than carrying a fixed
 * size. The ink is passed explicitly rather than read from the DOM because a
 * gallery renders sixty-three of these in one pass and asking the document for
 * the theme sixty-three times is sixty-two more class-list reads than the
 * answer changes in.
 */
export function presetThumbSvg(
  spec: ChartSpec,
  width: number,
  height: number,
  dark: boolean
): string {
  const [lw, lh] = thumbLayoutBox(width, height);
  const layout = layoutChart(thumbSpec(spec, width, height), lw, lh);
  const inner = paintLayout(silhouette(layout), {
    // A fixed id, so a preview's sketch — if a preset ever carries one — is
    // stable between renders rather than reseeding as the list scrolls.
    id: `thumb-${spec.kind}`,
    ink: chartInkFor(dark),
  });

  return `<g transform="${fitPlot(layout.plot, width, height)}">${inner}</g>`;
}

/**
 * The transform that puts the plot rect in the middle of the card.
 *
 * Uniform, never stretched: a radar, a pie and a polar rose are circles, and
 * the one thing worse than a small chart is an oval one. A degenerate layout —
 * which is what the old code produced at this size, and could produce again if
 * a kind is added that needs more room than the reference box — falls back to
 * the identity rather than dividing by zero.
 */
function fitPlot(
  plot: { x: number; y: number; width: number; height: number },
  width: number,
  height: number
): string {
  if (plot.width <= 0 || plot.height <= 0) return 'translate(0 0)';

  // A hair of air, so a mark that touches the plot edge does not touch the
  // card's rounded corner.
  const inset = 2;
  const scale = Math.min((width - inset * 2) / plot.width, (height - inset * 2) / plot.height);
  const tx = (width - plot.width * scale) / 2 - plot.x * scale;
  const ty = (height - plot.height * scale) / 2 - plot.y * scale;

  return `translate(${round(tx)} ${round(ty)}) scale(${round(scale)})`;
}

const round = (n: number): number => Math.round(n * 1000) / 1000;

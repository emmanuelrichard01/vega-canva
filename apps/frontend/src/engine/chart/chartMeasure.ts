import Konva from 'konva';

/**
 * How wide a chart label is, measured with the thing that will draw it.
 *
 * `chartLayout.ts` takes a measurer rather than assuming one, and this is the
 * on-screen implementation. The reasoning is `stickyFit`'s, one step milder:
 * the only thing that knows exactly how wide a string is in a given face is
 * the renderer that will draw it, and here the consequence of guessing is an
 * axis gutter that clips `1200` at one end and leaves a stripe of dead space
 * beside `0` at the other.
 *
 * It is milder than the sticky case because charts do not *wrap* — a tick
 * label is one short run — so this measures a single line and nothing here has
 * to reproduce Konva's line breaking.
 *
 * Kept out of `chartLayout.ts` deliberately: that module must keep running in
 * Node with no canvas, which is the only way anything positional gets verified
 * in this project. Importing Konva there would end that, and the layout tests
 * are most of what stands in for a browser.
 */

/** The chart face. Matches the app's UI stack so labels read as chrome. */
export const CHART_FONT_FAMILY = 'Inter, system-ui, -apple-system, sans-serif';

/**
 * One offscreen text node, reused.
 *
 * A chart re-measures on every resize frame and once per tick label, so
 * constructing a `Konva.Text` per call would allocate through a drag. This one
 * is never added to a layer, so it is never drawn.
 */
let probe: Konva.Text | null = null;

export function measureChartText(text: string, fontSize: number, weight = '400'): number {
  // No DOM, no canvas: this is the Node path (tests, or a worker), and the
  // caller's own approximation is the right answer rather than a throw.
  if (typeof document === 'undefined') return text.length * fontSize * 0.55;

  probe ??= new Konva.Text({ text: '', fontFamily: CHART_FONT_FAMILY });

  probe.fontSize(fontSize);
  probe.fontStyle(weight);
  probe.text(text);

  return probe.getTextWidth();
}

/**
 * Drop the cached probe.
 *
 * A font landing after first paint changes every width, and the probe holds
 * the metrics of whatever face was resolved when it was built. `fontEpoch`
 * already tells the app when that happens; this is what a listener calls.
 * Without it a chart laid out against the fallback keeps the fallback's gutter
 * for the life of the page — the same failure `ensureFontLoaded` exists to
 * stop for text objects.
 */
export function resetChartMeasureCache(): void {
  probe = null;
}

import type { ChartLayout, Point } from './chartLayout';

/**
 * What is under the pointer, in a chart's own coordinate space.
 *
 * ## Why this is pure, and in node-local coordinates
 *
 * Invariant 10: there are three coordinate spaces here — world, stage and
 * window — and this codebase has already shipped a floating panel drawn a
 * ruler's width off because a value crossed between two of them without being
 * converted. A hover readout is exactly that shape of feature, so the
 * arithmetic is done in the one space that needs no conversion at all: the
 * node's own, which is what `layoutChart` already produced and what the
 * renderer already draws in. The caller converts the pointer *into* that space
 * once, at the boundary, using Konva's own transform.
 *
 * Being pure is what lets the interesting part — "which bar is nearest, and is
 * the pointer close enough to mean it" — be asserted without a browser.
 */

export interface ChartHitEntry {
  /** The series or category name, whichever the kind is keyed on. */
  name: string;
  value: number;
  color: string;
  /** Already formatted by the caller's rules. */
  text: string;
}

export interface ChartHit {
  /** The category, tick or slice this is about. */
  label: string;
  entries: ChartHitEntry[];
  /** Where the readout should point, in node-local coordinates. */
  anchor: Point;
}

/**
 * How close the pointer has to be, in node units, before a mark answers.
 *
 * Generous, because the alternative is a readout that flickers as the pointer
 * crosses the gap between two bars. A chart is read by sweeping across it, not
 * by aiming at individual marks.
 */
const REACH = 28;

export interface HitOptions {
  /** Formats a value the same way the chart's own labels are formatted. */
  format: (value: number) => string;
  /** Category names, for kinds keyed on them. */
  categories: string[];
  /** Series names, for kinds keyed on those. */
  seriesNames: string[];
  /** Pie and funnel name their categories; everything else names its series. */
  keyedOnCategories: boolean;
}

/**
 * The nearest meaningful mark, or `null` when the pointer is not over the plot.
 *
 * **Bars and dots answer by column, not by mark.** Hovering anywhere in a
 * category's band reports every series at that category, which is what somebody
 * comparing two series actually wants — hovering one bar and being told only
 * about that bar makes the reader do the comparison by memory.
 */
export function chartHitTest(
  layout: ChartLayout,
  point: Point,
  options: HitOptions
): ChartHit | null {
  const { plot } = layout;
  if (plot.width <= 0 || plot.height <= 0) return null;

  // A margin outside the plot, so the readout survives the pointer drifting
  // onto an axis label rather than blinking out at the boundary.
  const inside =
    point.x >= plot.x - REACH &&
    point.x <= plot.x + plot.width + REACH &&
    point.y >= plot.y - REACH &&
    point.y <= plot.y + plot.height + REACH;
  if (!inside) return null;

  // ---- slices: the pointer is inside one wedge or it is not ---------------
  if (layout.slices.length) {
    for (const s of layout.slices) {
      const dx = point.x - s.cx;
      const dy = point.y - s.cy;
      const r = Math.hypot(dx, dy);
      if (r > s.outerRadius || r < s.innerRadius) continue;

      // Normalised into the same twelve-o'clock-clockwise frame the layout
      // used, so the comparison is against the angles it actually produced.
      let a = Math.atan2(dy, dx);
      while (a < s.startAngle) a += Math.PI * 2;
      if (a > s.endAngle) continue;

      return {
        label: options.categories[s.index] ?? `Slice ${s.index + 1}`,
        entries: [
          {
            name: `${Math.round(s.fraction * 100)}%`,
            value: s.value,
            color: s.color,
            text: options.format(s.value),
          },
        ],
        anchor: s.labelAnchor,
      };
    }
    return null;
  }

  // ---- bars: nearest band, then everything in it --------------------------
  if (layout.bars.length) {
    let best: { index: number; distance: number } | null = null;
    for (const b of layout.bars) {
      // Distance along the *category* axis only, which is what makes a whole
      // column answer rather than the individual rectangle under the pointer.
      const horizontal = b.width > b.height * 4 && layout.bars.length > 1;
      const centre = horizontal ? b.y + b.height / 2 : b.x + b.width / 2;
      const along = horizontal ? point.y : point.x;
      const d = Math.abs(along - centre);
      if (!best || d < best.distance) best = { index: b.categoryIndex, distance: d };
    }
    if (!best || best.distance > REACH) return null;

    const inBand = layout.bars.filter((b) => b.categoryIndex === best!.index);
    if (!inBand.length) return null;

    return {
      label: options.categories[best.index] ?? '',
      entries: inBand.map((b) => ({
        name: options.keyedOnCategories
          ? (options.categories[b.categoryIndex] ?? '')
          : (options.seriesNames[b.seriesIndex] ?? ''),
        value: b.value,
        color: b.color,
        text: options.format(b.value),
      })),
      anchor: {
        x: inBand.reduce((a, b) => a + b.x + b.width / 2, 0) / inBand.length,
        y: Math.min(...inBand.map((b) => b.y)),
      },
    };
  }

  // ---- points: the nearest one that carries a value -----------------------
  const valued = layout.dots.filter((d) => Number.isFinite(d.value));
  if (valued.length) {
    let best: (typeof valued)[number] | null = null;
    let bestD = Infinity;
    for (const d of valued) {
      const dist = Math.hypot(d.x - point.x, d.y - point.y);
      if (dist < bestD) {
        bestD = dist;
        best = d;
      }
    }
    if (best && bestD <= REACH) {
      return {
        label: options.categories[best.categoryIndex] ?? '',
        entries: [
          {
            name: options.seriesNames[best.seriesIndex] ?? '',
            value: best.value,
            color: best.color,
            text: options.format(best.value),
          },
        ],
        anchor: { x: best.x, y: best.y },
      };
    }
  }

  return null;
}

/**
 * Where a readout box should sit so it stays inside the chart.
 *
 * Flipped rather than clamped when it would overflow: a box pinned to the edge
 * covers the mark it is describing, which is the one thing it must not do. The
 * same rule the remote-cursor name chips follow at the viewport edge.
 */
export function placeReadout(
  anchor: Point,
  size: { width: number; height: number },
  bounds: { width: number; height: number }
): Point {
  const GAP = 10;
  let x = anchor.x + GAP;
  let y = anchor.y - size.height - GAP;

  if (x + size.width > bounds.width) x = anchor.x - size.width - GAP;
  if (x < 0) x = Math.max(0, Math.min(bounds.width - size.width, anchor.x - size.width / 2));
  if (y < 0) y = anchor.y + GAP;
  if (y + size.height > bounds.height) y = Math.max(0, bounds.height - size.height);

  return { x, y };
}

/**
 * Mermaid pie charts: parsing, and the geometry of a wedge.
 *
 * ## Why a wedge is a bezier path and not a shape
 *
 * The shape vocabulary has no arc. `ShapeGeometry.points` is a *count* — how
 * many sides a regular polygon has — not a list of vertices, so there is no
 * way to say "this outline" with a shape at all, and approximating a circle
 * with a fifty-sided polygon would produce an object nobody could edit
 * sensibly afterwards.
 *
 * A closed `bezier` path is the exact answer instead: two straight runs to and
 * from the centre and a curved run along the rim, filled by
 * `appearance.fill` like any other closed path. It is also *editable* — the
 * anchors are real anchors, so a wedge can be nudged with the pen tool like
 * anything else on the board, which is the whole promise of turning code into
 * objects rather than into a picture.
 *
 * ## Why the arc is split
 *
 * A single cubic cannot describe an arc longer than about a quarter turn
 * without visible error, so every wedge is cut into spans of at most 90° and
 * each gets its own cubic with the standard circular handle length. A 340°
 * slice — one big category and a sliver — is four spans and is round, rather
 * than one cubic bulging somewhere near the middle.
 */

import { estimateText, type Measurer } from './sequence';

/** The type size of a legend row, shared by the layout and both renderers. */
export const PIE_LEGEND_SIZE = 13;
/** The share written on the slice itself. */
export const PIE_SLICE_SIZE = 13;
/** The swatch, the gap after it, and the padding inside the card. */
const SWATCH = 14;
const SWATCH_GAP = 10;
const CARD_PAD = 12;

/** The share as mermaid prints it: one decimal, trailing zeros trimmed. */
export function sharePercent(share: number): string {
  return `${Math.round(share * 1000) / 10}%`;
}

export interface PieSlice {
  label: string;
  value: number;
}

export interface PieChart {
  title: string;
  /** Whether mermaid was asked to print the raw values as well as the shares. */
  showData: boolean;
  slices: PieSlice[];
}

export interface PieParseResult {
  chart: PieChart | null;
  error: string | null;
  errorLine?: number;
  skippedLines: number[];
}

export function looksLikePie(text: string): boolean {
  return /^\s*pie\b/im.test(text);
}

/** `"Label" : 42`, which is the only kind of line a pie body has. */
const SLICE = /^"([^"]*)"\s*:\s*(-?[\d.]+)\s*$/;

export function parsePie(source: string): PieParseResult {
  const skippedLines: number[] = [];
  const lines = source
    .split('\n')
    .map((text, i) => ({ text: text.trim(), lineNum: i + 1 }))
    .filter((l) => l.text.length > 0 && !l.text.startsWith('%%'));

  if (lines.length === 0) return { chart: null, error: null, skippedLines };

  const header = /^pie\b(.*)$/i.exec(lines[0].text);
  if (!header) {
    return {
      chart: null,
      error: 'Start with "pie".',
      errorLine: lines[0].lineNum,
      skippedLines,
    };
  }

  // `pie showData title NETFLIX` — both modifiers are optional and either
  // order of the two words is the only arrangement mermaid actually accepts.
  let rest = header[1].trim();
  let showData = false;
  if (/^showdata\b/i.test(rest)) {
    showData = true;
    rest = rest.slice('showData'.length).trim();
  }
  let title = /^title\b/i.test(rest) ? rest.slice('title'.length).trim() : '';

  const slices: PieSlice[] = [];
  for (const { text, lineNum } of lines.slice(1)) {
    // `title` on its own line is also legal, and is how most examples are laid
    // out when the title is long.
    if (/^title\b/i.test(text)) {
      title = text.slice('title'.length).trim();
      continue;
    }
    const match = SLICE.exec(text);
    if (!match) {
      skippedLines.push(lineNum);
      continue;
    }
    const value = Number(match[2]);
    if (!Number.isFinite(value) || value < 0) {
      return {
        chart: null,
        error: `"${match[2]}" is not a share this can draw. Use a number of zero or more.`,
        errorLine: lineNum,
        skippedLines,
      };
    }
    slices.push({ label: match[1], value });
  }

  if (slices.length === 0) {
    return {
      chart: null,
      error: 'No slices yet. Try "Watching" : 10 — the label in quotes, then a colon and a number.',
      errorLine: lines[0].lineNum,
      skippedLines,
    };
  }

  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (total <= 0) {
    return {
      chart: null,
      error: 'Every slice is zero, so there is no chart to draw.',
      errorLine: lines[0].lineNum,
      skippedLines,
    };
  }

  return { chart: { title: stripQuotes(title), showData, slices }, error: null, skippedLines };
}

function stripQuotes(s: string): string {
  const t = s.trim();
  return (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))
    ? t.slice(1, -1)
    : t;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export interface PieLayoutOptions {
  originX: number;
  originY: number;
  radius: number;
  /** Height of the title band above the chart; zero when there is no title. */
  titleHeight: number;
  /**
   * The narrowest the legend may be, and the widest.
   *
   * It was one fixed number, which is the same bug the sequence layout had:
   * "Reviewing each other's code — 18%" does not fit in 220 units and spilled
   * off the card. The rows are measured now and the card takes the widest of
   * them, between these bounds; a label past the maximum wraps rather than
   * pushing the card off the screen.
   */
  minLegendWidth: number;
  maxLegendWidth: number;
  legendRowHeight: number;
  gap: number;
  measure: Measurer;
}

export const PIE_DEFAULTS: PieLayoutOptions = {
  originX: 0,
  originY: 0,
  radius: 150,
  titleHeight: 44,
  minLegendWidth: 180,
  maxLegendWidth: 420,
  legendRowHeight: 26,
  gap: 32,
  measure: estimateText,
};

export interface Point {
  x: number;
  y: number;
}

export interface PieWedge {
  label: string;
  value: number;
  /** The slice's share of the whole, 0..1. */
  share: number;
  startAngle: number;
  endAngle: number;
  /** The anchors of the closed path, centre first. */
  anchors: Point[];
  /** Cubic controls, one pair per anchor, in the schema's arriving-at form. */
  handles: { cp1: Point; cp2: Point }[];
  /** Where the share is written on the slice itself. */
  centroid: Point;
  /**
   * The share, written on the wedge — or empty when it will not fit.
   *
   * Mermaid writes it on every slice regardless, which is why a mermaid pie
   * with a 1% category has a number lying across two other wedges and off the
   * edge of the chart. The legend already names every slice and gives every
   * share, so a sliver simply does not get one here: the information is not
   * lost, it has moved to where there is room for it.
   *
   * The test is the **chord** at the label's radius, not the angle — a thin
   * wedge of a large pie has more room than a thin wedge of a small one, and
   * the width available is what actually decides whether the text fits.
   */
  sliceLabel: string;
  /** Legend row, in world coordinates. */
  legend: { x: number; y: number; width: number; height: number };
  /**
   * The row's text, as it breaks.
   *
   * Formatted here rather than by each renderer. It was written out twice --
   * once in the builder and once in the preview -- and a string that has to
   * match in two places while the box is measured from only one of them is how
   * the text comes to overflow its card.
   */
  legendLines: string[];
}

export interface PieLayout {
  title: string;
  /**
   * The panel the legend rows sit on.
   *
   * A card rather than loose text, and the reason is contrast. Everything else
   * in a diagram has a surface chosen for it -- a node's label reads against
   * the node's own fill -- but a legend row would sit directly on the board,
   * whose colour is the *viewer's* theme and is not knowable when the objects
   * are written. `canvasInk` covers a line or a lone label; six rows of 13px
   * text want a real background, and a card is both the honest fix and the
   * better-looking one.
   */
  legendCard: { x: number; y: number; width: number; height: number };
  titleBox: { x: number; y: number; width: number; height: number } | null;
  centre: Point;
  radius: number;
  wedges: PieWedge[];
  width: number;
  height: number;
}

/** The circular handle length for an arc of `sweep` radians. */
function handleLength(sweep: number): number {
  // The exact cubic approximation constant: 4/3 · tan(θ/4). At a quarter turn
  // this is the familiar 0.5523 — KAPPA is just this evaluated at 90°.
  return (4 / 3) * Math.tan(sweep / 4);
}

/**
 * A whole pie, laid out.
 *
 * Slices run clockwise from twelve o'clock, which is what mermaid draws and
 * what every reader expects; the first slice in the source is the one at the
 * top, so the order in the code is the order round the rim.
 */
export function layoutPie(chart: PieChart, options: Partial<PieLayoutOptions> = {}): PieLayout {
  const o = { ...PIE_DEFAULTS, ...options };
  const total = chart.slices.reduce((sum, slice) => sum + slice.value, 0) || 1;

  const titleHeight = chart.title ? o.titleHeight : 0;
  const centre = {
    x: o.originX + o.radius,
    y: o.originY + titleHeight + o.radius,
  };

  const legendLeft = o.originX + o.radius * 2 + o.gap;

  /**
   * The rows, measured before anything is placed.
   *
   * The card is as wide as its widest row, so the text cannot spill out of it
   * -- and the *text column* is what is measured, not the row, because the
   * swatch and its gap sit to the left of every line.
   */
  const total0 = total;
  const rowTexts = chart.slices.map((slice) => {
    const share = sharePercent(slice.value / total0);
    return chart.showData
      ? `${slice.label} \u2014 ${slice.value} (${share})`
      : `${slice.label} \u2014 ${share}`;
  });

  const textLeft = SWATCH + SWATCH_GAP;
  const natural = Math.max(
    0,
    ...rowTexts.map((text) => o.measure(text, { fontSize: PIE_LEGEND_SIZE }).width)
  );
  const legendWidth = Math.min(
    o.maxLegendWidth,
    Math.max(o.minLegendWidth, Math.ceil(natural) + textLeft)
  );

  // Measured again at the width it will really get, which is the pass that
  // knows how many lines the cap above just created.
  const wrapped = rowTexts.map(
    (text) =>
      o.measure(text, { fontSize: PIE_LEGEND_SIZE, maxWidth: legendWidth - textLeft }).lines
  );
  // A wrapped row is taller than one line, and the rows below it have to move
  // down or they are written over it.
  const rowHeights = wrapped.map((lines) =>
    Math.max(o.legendRowHeight, lines.length * PIE_LEGEND_SIZE * 1.35 + 10)
  );
  const legendHeight = rowHeights.reduce((sum, h) => sum + h, 0);

  // Centred against the pie, so a three-slice legend does not sit at the top
  // of a tall circle with nothing beside the rest of it.
  const legendTop = centre.y - legendHeight / 2;

  const wedges: PieWedge[] = [];
  // Twelve o'clock. Canvas angles run clockwise from three o'clock, so the
  // start is a quarter turn back.
  let angle = -Math.PI / 2;

  chart.slices.forEach((slice, i) => {
    const share = slice.value / total;
    const sweep = share * Math.PI * 2;
    const startAngle = angle;
    const endAngle = angle + sweep;

    const anchors: Point[] = [{ x: centre.x, y: centre.y }];
    const handles: { cp1: Point; cp2: Point }[] = [];

    /**
     * The rim, in spans of at most a quarter turn.
     *
     * One cubic cannot hold more than that without visible error, and a pie's
     * biggest slice is routinely most of the circle.
     */
    const spans = Math.max(1, Math.ceil(sweep / (Math.PI / 2)));
    const step = sweep / spans;

    const onRim = (a: number): Point => ({
      x: centre.x + Math.cos(a) * o.radius,
      y: centre.y + Math.sin(a) * o.radius,
    });

    // The straight run out to the rim: no curvature, so the controls sit on
    // the line itself.
    const first = onRim(startAngle);
    anchors.push(first);
    handles.push({ cp1: { ...centre }, cp2: { ...first } });

    for (let s = 0; s < spans; s += 1) {
      const a0 = startAngle + step * s;
      const a1 = a0 + step;
      const from = onRim(a0);
      const to = onRim(a1);
      const k = handleLength(step) * o.radius;
      // Tangents at each end, which for a circle are perpendicular to the
      // radius — hence the swapped sine and cosine.
      const cp1 = { x: from.x - Math.sin(a0) * k, y: from.y + Math.cos(a0) * k };
      const cp2 = { x: to.x + Math.sin(a1) * k, y: to.y - Math.cos(a1) * k };
      anchors.push(to);
      handles.push({ cp1, cp2 });
    }

    // And the straight run home, which is the closing segment: in the schema's
    // arriving-at form that is `segments[0]`, filled in by the builder.
    const mid = startAngle + sweep / 2;

    /**
     * Does the share fit on the wedge?
     *
     * Measured against the chord at the label's own radius, which is the width
     * genuinely available there. A slice that cannot hold its own number is
     * left clean and speaks through the legend instead.
     */
    const shareText = sharePercent(share);
    const labelRadius = o.radius * 0.62;
    const chord = 2 * labelRadius * Math.sin(Math.min(Math.PI, sweep) / 2);
    const textWidth = o.measure(shareText, { fontSize: PIE_SLICE_SIZE }).width;
    const fits = chord >= textWidth + 12 && sweep > 0;

    wedges.push({
      label: slice.label,
      value: slice.value,
      share,
      startAngle,
      endAngle,
      anchors,
      handles,
      centroid: {
        x: centre.x + Math.cos(mid) * labelRadius,
        y: centre.y + Math.sin(mid) * labelRadius,
      },
      sliceLabel: fits ? shareText : '',
      legend: {
        x: legendLeft,
        y: legendTop + rowHeights.slice(0, i).reduce((sum, h) => sum + h, 0),
        width: legendWidth,
        height: rowHeights[i],
      },
      legendLines: wrapped[i],
    });

    angle = endAngle;
  });

  const legendCard = {
    x: legendLeft - CARD_PAD,
    y: legendTop - CARD_PAD,
    width: legendWidth + CARD_PAD * 2,
    height: legendHeight + CARD_PAD * 2,
  };

  const bottom = Math.max(centre.y + o.radius, legendCard.y + legendCard.height);
  const top = Math.min(o.originY, legendCard.y);

  return {
    title: chart.title,
    legendCard,
    titleBox: chart.title
      ? { x: o.originX, y: o.originY, width: o.radius * 2, height: titleHeight }
      : null,
    centre,
    radius: o.radius,
    wedges,
    width: legendCard.x + legendCard.width - o.originX,
    height: bottom - top,
  };
}

/** A wedge as an SVG path, for the preview and for any flat renderer. */
export function wedgePath(wedge: PieWedge): string {
  const [centre, ...rim] = wedge.anchors;
  const parts = [`M${round(centre.x)} ${round(centre.y)}`, `L${round(rim[0].x)} ${round(rim[0].y)}`];
  for (let i = 1; i < rim.length; i += 1) {
    const h = wedge.handles[i];
    parts.push(
      `C${round(h.cp1.x)} ${round(h.cp1.y)} ${round(h.cp2.x)} ${round(h.cp2.y)} ${round(rim[i].x)} ${round(rim[i].y)}`
    );
  }
  parts.push('Z');
  return parts.join(' ');
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

import {
  layoutChart,
  approximateMeasure,
  TOLERANCE_FILL_OPACITY,
  type ChartLayout,
  type Measure,
} from './chartLayout';
import type { ChartSpec } from './chartTypes';
import { contrastInk } from '../model/color';
import { rectRing, roughLoop, roughPolyline, seedFor, type SketchLevel } from '../model/rough';
import { currentChartInk, type ChartInk } from './chartInk';
import { hachure, SKETCH_FONT, SKETCH_FONT_SCALE } from './chartSketch';

/**
 * The second painter.
 *
 * `ChartRenderer.tsx` puts a `ChartLayout` on a Konva stage; this puts the
 * same `ChartLayout` into SVG markup. Neither does any arithmetic, and that is
 * the whole design: a chart cannot be one picture on screen and a different
 * one in the exported file, because there is one set of rectangles and both
 * painters are handed it.
 *
 * The rule is worth stating sharply because this file did not exist for two
 * commits, and in that window `SVGExporter` had no `case 'chart'` at all — so
 * a chart exported as **nothing**, silently, in a format that had no way to
 * say so. A missing painter is the same class of fault as a missing renderer:
 * a capability the document declares and one of its consumers ignores.
 *
 * Sketch comes out identical too, and for free: `roughLoop` and
 * `roughPolyline` already return SVG path data, seeded from the node id, so
 * the hand that drew the bars on the canvas is the hand in the file rather
 * than another draw from the same distribution.
 */

/** Enough of the exporter's escaping to be safe on its own. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const FONT = 'Inter, system-ui, -apple-system, sans-serif';

/** SVG's `text-anchor` for one of our alignments, given the box it sits in. */
function anchorFor(align: 'left' | 'center' | 'right'): { anchor: string; dx: number } {
  if (align === 'center') return { anchor: 'middle', dx: 0.5 };
  if (align === 'right') return { anchor: 'end', dx: 1 };
  return { anchor: 'start', dx: 0 };
}

function label(
  text: string,
  x: number,
  y: number,
  width: number,
  align: 'left' | 'center' | 'right',
  fontSize: number,
  fill: string,
  weight = '400',
  font = FONT
): string {
  const { anchor, dx } = anchorFor(align);
  // The layout gives a box and an alignment; SVG wants an anchor point. The
  // conversion is here rather than in the layout because Konva wants the box
  // and would have to undo it.
  const tx = x + width * dx;
  // `dominant-baseline` is deliberately not used: it is inconsistently
  // implemented across renderers, and Konva positions text from its top. The
  // layout's `y` is a top edge, so the baseline is one cap-height down and
  // 0.8em is the reliable approximation of that.
  const ty = y + fontSize * 0.8;
  return `<text x="${tx}" y="${ty}" text-anchor="${anchor}" font-family="${esc(font)}" font-size="${fontSize}" font-weight="${weight}" fill="${fill}">${esc(text)}</text>`;
}

/**
 * An SVG arc path for one slice, matching what Konva's `Arc` draws.
 *
 * Konva takes a rotation and a sweep in degrees; SVG needs the two endpoints
 * and a large-arc flag. Both are derived from the same start and end angles
 * the layout produced, so the quarter turn to twelve o'clock is applied once,
 * upstream, and neither painter re-applies it.
 */
function slicePath(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  start: number,
  end: number
): string {
  const sweep = end - start;
  const at = (a: number, r: number) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as const;

  // A single slice covering the whole circle has no endpoints to draw between
  // — the arc would be degenerate — so it is emitted as two half circles.
  if (sweep >= Math.PI * 2 - 1e-9) {
    const ring = (r: number) =>
      `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} Z`;
    return inner > 0 ? `${ring(outer)} ${ring(inner)}` : ring(outer);
  }

  const large = sweep > Math.PI ? 1 : 0;
  const [x0, y0] = at(start, outer);
  const [x1, y1] = at(end, outer);

  if (inner <= 0) {
    return `M ${cx} ${cy} L ${x0} ${y0} A ${outer} ${outer} 0 ${large} 1 ${x1} ${y1} Z`;
  }
  const [ix1, iy1] = at(end, inner);
  const [ix0, iy0] = at(start, inner);
  return `M ${x0} ${y0} A ${outer} ${outer} 0 ${large} 1 ${x1} ${y1} L ${ix1} ${iy1} A ${inner} ${inner} 0 ${large} 0 ${ix0} ${iy0} Z`;
}

export interface ChartSvgOptions {
  /** Node id, so the sketch seed matches the one on screen exactly. */
  id: string;
  /** A flat area's fill opacity, from the spec; the board's own default otherwise. */
  areaOpacity?: number;
  sketch?: SketchLevel;
  sketchSeed?: number;
  /** Injected so the exporter can measure with a real font when it has one. */
  measure?: Measure;
  /** Overrides the on-screen theme, for a worker with no DOM to ask. */
  ink?: ChartInk;
}

/**
 * A chart as SVG markup, in the node's own coordinate space.
 *
 * The caller wraps it in a `<g transform>` for the node's position and
 * rotation, exactly as it does for every other type — so this function never
 * needs to know where on the board the chart is.
 */
export function chartToSvg(
  spec: ChartSpec,
  width: number,
  height: number,
  options: ChartSvgOptions
): string {
  const layout = layoutChart(spec, width, height, options.measure ?? approximateMeasure);
  return paintLayout(layout, { ...options, areaOpacity: options.areaOpacity ?? spec.areaOpacity });
}

/** Split out so a test can paint a layout it built itself. */
export function paintLayout(layout: ChartLayout, options: ChartSvgOptions): string {
  // The same ink the canvas is using, so an export made while the board is dark
  // is the chart that was on screen rather than a second reading of it.
  const ink: ChartInk = options.ink ?? currentChartInk();
  const out: string[] = [];
  const sketch = options.sketch;
  const seed = seedFor(options.id, options.sketchSeed);
  /**
   * Sketch letters in the hand, a size up. A fill is hatched — a pale wash
   * under strokes — wherever the bar is not a heat cell, so a label placed
   * "on" a hatched mark actually sits on something near the board's colour.
   */
  const font = sketch ? SKETCH_FONT : FONT;
  const scale = sketch ? SKETCH_FONT_SCALE : 1;
  const hatched = Boolean(sketch) && layout.bars.some((b) => b.rounded !== false);
  const lab = (
    text: string,
    x: number,
    y: number,
    width: number,
    align: 'left' | 'center' | 'right',
    fontSize: number,
    fill: string,
    weight = '400'
  ) => label(text, x, y, width, align, fontSize * scale, fill, sketch ? '700' : weight, font);
  const onInk = (on: string | undefined, fallback: string) =>
    on ? (hatched ? ink.ink : contrastInk(on)) : fallback;

  /** A chrome rule: straight when clean, drawn by hand when sketched. */
  const rule = (x1: number, y1: number, x2: number, y2: number, n: number, width: number, opacity = 1) =>
    sketch
      ? `<path d="${roughPolyline([{ x: x1, y: y1 }, { x: x2, y: y2 }], { seed: seed + 900 + n * 7, level: width > 1 ? sketch : 'light', closed: false })}" fill="none" stroke="${ink.chrome}" stroke-width="${width}" stroke-linecap="round" opacity="${opacity}" />`
      : `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${ink.chrome}" stroke-width="${width}"${opacity < 1 ? ` opacity="${opacity}"` : ''} />`;

  layout.gridLines.forEach((g, i) => out.push(rule(g.x1, g.y1, g.x2, g.y2, i, 1, 0.35)));
  // The vertical axis, at the horizontal one's weight — see `zeroRule`.
  if (layout.zeroRule) {
    const z = layout.zeroRule;
    out.push(rule(z.x1, z.y1, z.x2, z.y2, 97, 1.5));
  }
  if (layout.baseline) {
    const b = layout.baseline;
    out.push(rule(b.x1, b.y1, b.x2, b.y2, 98, 1.5));
  }

  /**
   * Radar's rings and spokes, drawn before the data so the data sits on them.
   *
   * Rings are polygons rather than circles: they have to have the same shape
   * as the outline they sit behind, or a value on a ring does not appear to
   * touch it.
   */
  for (const spoke of layout.spokes) {
    out.push(
      `<line x1="${spoke.x1}" y1="${spoke.y1}" x2="${spoke.x2}" y2="${spoke.y2}" stroke="${ink.chrome}" stroke-width="1" opacity="0.35" />`
    );
  }
  for (const ring of layout.rings) {
    out.push(
      `<polygon points="${ring.points.map((p) => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="${ink.chrome}" stroke-width="1" opacity="0.3" />`
    );
  }

  if (layout.toleranceBand) {
    const tb = layout.toleranceBand;
    out.push(
      `<rect x="${layout.plot.x}" y="${tb.y1}" width="${layout.plot.width}" height="${Math.max(1, tb.y2 - tb.y1)}" ` +
        `fill="${tb.color}" fill-opacity="${TOLERANCE_FILL_OPACITY}" />`
    );
  }

  layout.bars.forEach((b, i) => {
    const op = b.opacity ?? 1;
    if (sketch) {
      const d = roughLoop(
        rectRing(b.width, b.height).map((p) => ({ x: p.x + b.x, y: p.y + b.y })),
        { seed: seed + i * 17, level: sketch }
      );
      if (b.rounded === false) {
        // A heat cell's colour *is* its value, so it stays solid.
        out.push(`<path d="${d}" fill="${b.color}" stroke="${b.color}" stroke-width="1.4" opacity="${0.92 * op}" />`);
      } else {
        out.push(`<path d="${d}" fill="${b.color}" fill-opacity="${0.16 * op}" stroke="none" />`);
        out.push(
          `<path d="${hachure(b, seed + i * 17)}" fill="none" stroke="${b.color}" stroke-width="1.1" stroke-linecap="round" opacity="${0.85 * op}" />`
        );
        out.push(`<path d="${d}" fill="none" stroke="${b.color}" stroke-width="1.6" stroke-linejoin="round" opacity="${op}" />`);
      }
    } else {
      const r =
        b.cornerRadius !== undefined
          ? Math.min(b.cornerRadius, Math.min(b.width, b.height) / 2)
          : (b.rounded ?? true)
          ? Math.min(3, b.width / 6)
          : 0;
      const rx = r > 0 ? ` rx="${r}"` : '';
      out.push(
        `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}"${rx} fill="${b.color}"${op < 1 ? ` fill-opacity="${op}"` : ''} />`
      );
    }
  });

  /**
   * Areas, with the same fade the canvas draws.
   *
   * There was no gradient here at all: the renderer faded its fill from the
   * series colour to nothing and the export wrote a flat 22% polygon, so the
   * two disagreed about what the chart looked like. The stops match the
   * renderer's exactly and both now read the flag off the layout.
   *
   * One `<defs>` per area that wants one, keyed by the export's own id, so
   * two charts in one file cannot collide on a gradient name.
   */
  layout.areas.forEach((a, i) => {
    const points = a.polygon.map((p) => `${p.x},${p.y}`).join(' ');
    if (!a.gradient) {
      // The panel's fill opacity, which the board already honoured — the
      // export hard-coded 0.22, so a 60% area drew at 22% in the file.
      out.push(`<polygon points="${points}" fill="${a.color}" opacity="${options.areaOpacity ?? 0.22}" />`);
      return;
    }
    const id = `${options.id}-areafill-${i}`;
    const top = layout.plot.y;
    const bottom = layout.baseline?.y1 ?? layout.plot.y + layout.plot.height;
    out.push(
      `<defs><linearGradient id="${id}" x1="0" y1="${top}" x2="0" y2="${bottom}" gradientUnits="userSpaceOnUse">` +
        `<stop offset="0" stop-color="${a.color}" />` +
        `<stop offset="1" stop-color="rgba(0,0,0,0.02)" />` +
        `</linearGradient></defs>`
    );
    out.push(`<polygon points="${points}" fill="url(#${id})" opacity="0.45" />`);
  });

  layout.runs.forEach((r, i) => {
    if (r.points.length < 2) return;
    const strokeW = r.width ?? 2.5;
    const dash =
      r.style === 'dashed'
        ? ' stroke-dasharray="6 4"'
        : r.style === 'dotted'
        ? ' stroke-dasharray="2 3"'
        : '';
    const runOp = r.opacity !== undefined && r.opacity < 1 ? ` opacity="${r.opacity}"` : '';
    if (sketch) {
      const d = roughPolyline(r.points, { seed: seed + i * 31, level: sketch, closed: false });
      out.push(
        `<path d="${d}" fill="none" stroke="${r.color}" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round"${runOp} />`
      );
    } else {
      out.push(
        `<polyline points="${r.points.map((p) => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="${r.color}" stroke-width="${strokeW}"${dash} stroke-linecap="round" stroke-linejoin="round"${runOp} />`
      );
    }
  });

  for (const d of layout.dots) {
    if (d.shape === 'ring' || d.shape === 'hollow') {
      out.push(`<circle cx="${d.x}" cy="${d.y}" r="${d.radius}" fill="none" stroke="${d.color}" stroke-width="2" />`);
    } else if (d.shape === 'square') {
      out.push(`<rect x="${d.x - d.radius}" y="${d.y - d.radius}" width="${d.radius * 2}" height="${d.radius * 2}" fill="${d.color}" />`);
    } else {
      out.push(`<circle cx="${d.x}" cy="${d.y}" r="${d.radius}" fill="${d.color}" />`);
    }
  }

  for (const s of layout.slices) {
    out.push(
      `<path d="${slicePath(s.cx, s.cy, s.outerRadius, s.innerRadius, s.startAngle, s.endAngle)}" fill="${s.color}" stroke="${ink.sliceEdge}" stroke-width="1.5" fill-rule="evenodd" />`
    );
  }

  for (const b of layout.waterfallBridges ?? []) {
    out.push(
      `<line x1="${b.x1}" y1="${b.y1}" x2="${b.x2}" y2="${b.y2}" stroke="${ink.chrome}" stroke-width="1.2" stroke-dasharray="3 3" opacity="0.65" />`
    );
  }

  for (const h of layout.funnelHulls ?? []) {
    out.push(
      `<polygon points="${h.polygon.map((p) => `${p.x},${p.y}`).join(' ')}" fill="rgba(59, 130, 246, 0.08)" stroke="rgba(59, 130, 246, 0.2)" stroke-width="1" stroke-dasharray="4 4" />`
    );
  }

  if (layout.trendline) {
    const tl = layout.trendline;
    out.push(
      `<line x1="${tl.line[0].x}" y1="${tl.line[0].y}" x2="${tl.line[1].x}" y2="${tl.line[1].y}" stroke="${ink.derived}" stroke-width="1.8" stroke-dasharray="6 4" opacity="0.9" />`
    );
  }

  if (layout.kdeCurve) {
    out.push(
      `<polyline points="${layout.kdeCurve.map((p) => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="${ink.derived}" stroke-width="2.2" opacity="0.9" />`
    );
  }

  for (const sl of layout.streamlines ?? []) {
    out.push(
      `<polyline points="${sl.points.map((p) => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="${ink.derived}" stroke-width="1.8" opacity="0.85" />`
    );
    out.push(
      `<circle cx="${sl.seed.x}" cy="${sl.seed.y}" r="4" fill="${ink.feature}" stroke="${ink.sliceEdge}" stroke-width="1.5" />`
    );
  }

  if (layout.donutMetric) {
    const dm = layout.donutMetric;
    out.push(
      `<text x="${dm.x}" y="${dm.y - 4}" text-anchor="middle" font-size="9" font-weight="600" fill="${ink.chrome}">${dm.label}</text>`
    );
    out.push(
      `<text x="${dm.x}" y="${dm.y + 11}" text-anchor="middle" font-size="12" font-weight="700" fill="${ink.ink}">${dm.value}</text>`
    );
  }

  /**
   * The reference rule, above the marks.
   *
   * Dashed so it reads as an annotation rather than as another series, and
   * drawn last of the geometry so a bar cannot hide the target it missed.
   */
  /**
   * The corridor's boundaries, over the marks.
   *
   * The tint is drawn behind them, further up — over an opaque bar it would
   * shift the bar's colour — but behind is where a bar chart hides it
   * completely, so the part that carries the meaning comes back on top.
   */
  if (layout.toleranceBand) {
    const tb = layout.toleranceBand;
    const right = layout.plot.x + layout.plot.width;
    const bottom = layout.plot.y + layout.plot.height;
    const edge = (y: number) =>
      `<line x1="${layout.plot.x}" y1="${y}" x2="${right}" y2="${y}" stroke="${tb.color}" stroke-width="1.25" stroke-dasharray="4 3" opacity="0.9" />`;
    if (!tb.cropped || tb.y1 > layout.plot.y + 0.5) out.push(edge(tb.y1));
    if (!tb.cropped || tb.y2 < bottom - 0.5) out.push(edge(tb.y2));
    if (tb.label) {
      const l = tb.label;
      out.push(lab(l.text, l.x, l.y, l.width, l.align, l.fontSize, tb.color, '600'));
    }
  }

  if (layout.reference) {
    const r = layout.reference;
    out.push(
      `<line x1="${r.x1}" y1="${r.y1}" x2="${r.x2}" y2="${r.y2}" stroke="${r.color}" stroke-width="1.5"${r.dashed ? ' stroke-dasharray="5 4"' : ''} />`
    );
    if (r.label) {
      out.push(lab(r.label.text, r.label.x, r.label.y, r.label.width, r.label.align, r.label.fontSize, r.color, '600'));
    }
  }

  if (layout.title) {
    const t = layout.title;
    out.push(lab(t.text, t.x, t.y, t.width, t.align, t.fontSize, ink.ink, '600'));
  }
  if (layout.subtitle) {
    const s = layout.subtitle;
    out.push(lab(s.text, s.x, s.y, s.width, s.align, s.fontSize, ink.chrome, '400'));
  }
  if (layout.footnote) {
    const f = layout.footnote;
    out.push(lab(f.text, f.x, f.y, f.width, f.align, f.fontSize, ink.chrome, '400'));
  }
  if (layout.xAxisTitle) {
    const xa = layout.xAxisTitle;
    out.push(lab(xa.text, xa.x - xa.width / 2, xa.y, xa.width, xa.align, xa.fontSize, ink.chrome, '600'));
  }
  if (layout.yAxisTitle) {
    const ya = layout.yAxisTitle;
    out.push(
      `<text x="${ya.x}" y="${ya.y}" transform="rotate(-90 ${ya.x} ${ya.y})" text-anchor="middle" font-family="${esc(font)}" font-size="${ya.fontSize * scale}" font-weight="600" fill="${ink.chrome}">${esc(ya.text)}</text>`
    );
  }
  for (const l of [...layout.axisLabels, ...layout.categoryLabels]) {
    // A name inside a tile — a treemap's, a heat table's — reads against the
    // tile, like a value label does.
    out.push(lab(l.text, l.x, l.y, l.width, l.align, l.fontSize, onInk(l.on, ink.chrome)));
  }
  for (const l of layout.valueLabels) {
    // Against the mark it sits on, or the board when it sits on nothing --
    // the same rule the canvas follows, read from the same field.
    const fill = onInk(l.on, ink.ink);
    out.push(lab(l.text, l.x, l.y, l.width, l.align, l.fontSize, fill, '600'));
  }
  /**
   * The colour scale, from the same stops the canvas uses.
   *
   * Painted before the legend so the two never overlap in z-order the way
   * they would if this were appended last and the layout ever placed them
   * together.
   */
  if (layout.colorBar) {
    const bar = layout.colorBar;
    const id = `${options.id}-colorbar`;
    // y1 at the bottom and y2 at the top, so offset zero is the low end --
    // the same way up as the surface it describes.
    out.push(
      `<defs><linearGradient id="${id}" x1="0" y1="${bar.y + bar.height}" x2="0" y2="${bar.y}" gradientUnits="userSpaceOnUse">` +
        bar.stops
          .map((stop) => `<stop offset="${stop.offset}" stop-color="${stop.color}" />`)
          .join('') +
        `</linearGradient></defs>`
    );
    out.push(
      `<rect x="${bar.x}" y="${bar.y}" width="${bar.width}" height="${bar.height}" rx="2" ` +
        `fill="url(#${id})" stroke="${ink.chrome}" stroke-width="0.5" />`
    );
    for (const tick of bar.ticks) {
      out.push(lab(tick.text, bar.textX, tick.y, 0, 'left', bar.fontSize, ink.ink));
    }
  }

  for (const e of layout.legend) {
    out.push(
      `<rect x="${e.x}" y="${e.y}" width="${e.swatch}" height="${e.swatch}" rx="2" fill="${e.color}" />`
    );
    out.push(lab(e.label, e.textX, e.y - 1, 0, 'left', e.fontSize, ink.ink));
  }

  return out.join('');
}

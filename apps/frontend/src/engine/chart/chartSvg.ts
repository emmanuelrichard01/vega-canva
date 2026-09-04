import { layoutChart, approximateMeasure, type ChartLayout, type Measure } from './chartLayout';
import type { ChartSpec } from './chartTypes';
import { rectRing, roughLoop, roughPolyline, seedFor, type SketchLevel } from '../model/rough';
import { CHART_CHROME, CHART_INK } from './chartInk';

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
  weight = '400'
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
  return `<text x="${tx}" y="${ty}" text-anchor="${anchor}" font-family="${esc(FONT)}" font-size="${fontSize}" font-weight="${weight}" fill="${fill}">${esc(text)}</text>`;
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
  sketch?: SketchLevel;
  sketchSeed?: number;
  /** Injected so the exporter can measure with a real font when it has one. */
  measure?: Measure;
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
  return paintLayout(layout, options);
}

/** Split out so a test can paint a layout it built itself. */
export function paintLayout(layout: ChartLayout, options: ChartSvgOptions): string {
  const out: string[] = [];
  const sketch = options.sketch;
  const seed = seedFor(options.id, options.sketchSeed);

  for (const g of layout.gridLines) {
    out.push(
      `<line x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}" stroke="${CHART_CHROME}" stroke-width="1" opacity="0.35" />`
    );
  }
  if (layout.baseline) {
    const b = layout.baseline;
    out.push(
      `<line x1="${b.x1}" y1="${b.y1}" x2="${b.x2}" y2="${b.y2}" stroke="${CHART_CHROME}" stroke-width="1.5" />`
    );
  }

  layout.bars.forEach((b, i) => {
    if (sketch) {
      const d = roughLoop(
        rectRing(b.width, b.height).map((p) => ({ x: p.x + b.x, y: p.y + b.y })),
        { seed: seed + i * 17, level: sketch }
      );
      out.push(
        `<path d="${d}" fill="${b.color}" stroke="${b.color}" stroke-width="1.4" opacity="0.92" />`
      );
    } else {
      const r = Math.min(3, b.width / 6);
      out.push(
        `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="${r}" fill="${b.color}" />`
      );
    }
  });

  for (const a of layout.areas) {
    out.push(
      `<polygon points="${a.polygon.map((p) => `${p.x},${p.y}`).join(' ')}" fill="${a.color}" opacity="0.22" />`
    );
  }

  layout.runs.forEach((r, i) => {
    if (r.points.length < 2) return;
    if (sketch) {
      const d = roughPolyline(r.points, { seed: seed + i * 31, level: sketch, closed: false });
      out.push(
        `<path d="${d}" fill="none" stroke="${r.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />`
      );
    } else {
      out.push(
        `<polyline points="${r.points.map((p) => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="${r.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />`
      );
    }
  });

  for (const d of layout.dots) {
    out.push(`<circle cx="${d.x}" cy="${d.y}" r="${d.radius}" fill="${d.color}" />`);
  }

  for (const s of layout.slices) {
    out.push(
      `<path d="${slicePath(s.cx, s.cy, s.outerRadius, s.innerRadius, s.startAngle, s.endAngle)}" fill="${s.color}" stroke="#FFFFFF" stroke-width="1.5" fill-rule="evenodd" />`
    );
  }

  if (layout.title) {
    const t = layout.title;
    out.push(label(t.text, t.x, t.y, t.width, t.align, t.fontSize, CHART_INK, '600'));
  }
  for (const l of [...layout.axisLabels, ...layout.categoryLabels]) {
    out.push(label(l.text, l.x, l.y, l.width, l.align, l.fontSize, CHART_CHROME));
  }
  for (const l of layout.valueLabels) {
    out.push(label(l.text, l.x, l.y, l.width, l.align, l.fontSize, CHART_INK, '600'));
  }
  for (const e of layout.legend) {
    out.push(
      `<rect x="${e.x}" y="${e.y}" width="${e.swatch}" height="${e.swatch}" rx="2" fill="${e.color}" />`
    );
    out.push(label(e.label, e.textX, e.y - 1, 0, 'left', e.fontSize, CHART_INK));
  }

  return out.join('');
}

import type { ChartLayout, Point } from './chartLayout';
import { traceMathPlot, type MathTraceInfo } from './chartTrace';
import { currentChartInk, type ChartInk } from './chartInk';
import { mathText } from './mathText';
import { seriesColor } from './chartTypes';

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
  categoryIndex?: number;
  seriesIndex?: number;
  mathTrace?: MathTraceInfo;
  deltaVsTarget?: string;
  pctOfTotal?: string;
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
  /**
   * The ink the chart is being drawn in, when the caller already has it.
   *
   * The renderer resolves this once per frame anyway, so passing it means a
   * hover does not ask the document for the theme on every pointer move.
   */
  ink?: ChartInk;
  /** Formats a value the same way the chart's own labels are formatted. */
  format: (value: number) => string;
  /** Category names, for kinds keyed on them. */
  categories: string[];
  /** Series names, for kinds keyed on those. */
  seriesNames: string[];
  /** Pie and funnel name their categories; everything else names its series. */
  keyedOnCategories: boolean;
  referenceValue?: number;
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
  /**
   * The accent for computed rows, resolved once.
   *
   * It was the literal `#06B6D4`, written out nine times -- and four of those
   * nine were doing a different job: standing in for a curve's own colour when
   * it had none. That fallback was also *wrong*, because `layoutChart` gives
   * an uncoloured curve `seriesColor(undefined, i)`, so the readout's swatch
   * was a cyan the line beside it was not drawn in.
   *
   * Theme-aware now, which the fixed literal could not be: cyan at full
   * strength drops under 3:1 on a white board and the derived rows read as
   * disabled text there.
   */
  const DERIVED_INK = options.ink?.derived ?? currentChartInk().derived;

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

  // ---- 2D plane plots (heatmaps, contours, vector fields, slope fields) ---
  if (layout.mathPlot?.isTwoVariable && layout.mathPlot.curves.length > 0) {
    const { xMin, xMax, yMin, yMax } = layout.mathPlot.domain;
    const xSpan = xMax - xMin;
    const ySpan = yMax - yMin;
    if (xSpan > 0 && ySpan > 0) {
      const clampedX = Math.max(plot.x, Math.min(plot.x + plot.width, point.x));
      const clampedY = Math.max(plot.y, Math.min(plot.y + plot.height, point.y));
      const xVal = xMin + ((clampedX - plot.x) / plot.width) * xSpan;
      const yVal = yMin + ((plot.y + plot.height - clampedY) / plot.height) * ySpan;
      const kind = layout.mathPlot.kind;

      /**
       * The rays the HUD draws from the reading back to the axes.
       *
       * Identical for every two-variable kind, and it was written out inside
       * the two branches that happened to build a trace — which is why the
       * three that did not (`implicit`, `contour`, `heatmap`) had no HUD at
       * all: they computed the value, the gradient and the position, returned
       * a readout, and dropped the geometry on the floor.
       */
      const planeCrosshair = {
        xRay: [
          { x: clampedX, y: clampedY },
          { x: clampedX, y: plot.y + plot.height },
        ] as [Point, Point],
        yRay: [
          { x: clampedX, y: clampedY },
          { x: plot.x, y: clampedY },
        ] as [Point, Point],
      };

      if (kind === 'slopeField') {
        const curve = layout.mathPlot.curves[0];
        const slope = curve ? curve.evaluate(xVal, yVal) : NaN;
        if (Number.isFinite(slope)) {
          const angleRad = Math.atan(slope);
          const angleDeg = (angleRad * 180) / Math.PI;
          const scaleX = plot.width / xSpan;
          const scaleY = plot.height / ySpan;
          const scrAngle = Math.atan(-slope * (scaleY / scaleX));
          const NEEDLE_LEN = 16;
          const cosA = Math.cos(scrAngle);
          const sinA = Math.sin(scrAngle);
          const needle: [Point, Point] = [
            { x: clampedX - NEEDLE_LEN * cosA, y: clampedY - NEEDLE_LEN * sinA },
            { x: clampedX + NEEDLE_LEN * cosA, y: clampedY + NEEDLE_LEN * sinA },
          ];

          return {
            label: `(${Number(xVal.toFixed(2))}, ${Number(yVal.toFixed(2))})`,
            entries: [
              {
                name: 'dy/dx',
                value: slope,
                color: curve.color,
                text: `slope = ${Number(slope.toFixed(3))}`,
              },
              {
                name: 'θ',
                value: angleDeg,
                color: curve.color,
                text: `angle = ${Number(angleDeg.toFixed(1))}°`,
              },
            ],
            anchor: point,
            mathTrace: {
              x: xVal,
              y: yVal,
              screenPoint: { x: clampedX, y: clampedY },
              curveIndex: 0,
              curveColor: curve.color,
              curveName: mathText(curve.source),
              slope,
              tangentSegment: needle,
              crosshair: {
                xRay: [{ x: clampedX, y: clampedY }, { x: clampedX, y: plot.y + plot.height }],
                yRay: [{ x: clampedX, y: clampedY }, { x: plot.x, y: clampedY }],
              },
              fieldVector: {
                u: 1,
                v: slope,
                magnitude: Math.hypot(1, slope),
                angleDeg,
                segment: needle,
              },
            },
          };
        }
      } else if (kind === 'vectorField') {
        const curveP = layout.mathPlot.curves[0];
        const curveQ = layout.mathPlot.curves[1];
        const u = curveP ? curveP.evaluate(xVal, yVal) : 0;
        const v = curveQ ? curveQ.evaluate(xVal, yVal) : 0;
        if (Number.isFinite(u) && Number.isFinite(v)) {
          const mag = Math.hypot(u, v);
          const angleRad = Math.atan2(v, u);
          const angleDeg = (angleRad * 180) / Math.PI;

          const scaleX = plot.width / xSpan;
          const scaleY = plot.height / ySpan;
          const scrAngle = Math.atan2(-v * scaleY, u * scaleX);
          const VEC_LEN = 20;
          const cosA = Math.cos(scrAngle);
          const sinA = Math.sin(scrAngle);
          const needle: [Point, Point] = [
            { x: clampedX - VEC_LEN * 0.3 * cosA, y: clampedY - VEC_LEN * 0.3 * sinA },
            { x: clampedX + VEC_LEN * 0.7 * cosA, y: clampedY + VEC_LEN * 0.7 * sinA },
          ];

          return {
            label: `(${Number(xVal.toFixed(2))}, ${Number(yVal.toFixed(2))})`,
            entries: [
              {
                name: 'F(x,y)',
                value: mag,
                color: curveP?.color ?? seriesColor(undefined, 0),
                text: `⟨${Number(u.toFixed(2))}, ${Number(v.toFixed(2))}⟩`,
              },
              {
                name: '|F|',
                value: mag,
                color: curveP?.color ?? seriesColor(undefined, 0),
                text: `magnitude = ${Number(mag.toFixed(3))}`,
              },
              {
                name: 'θ',
                value: angleDeg,
                color: curveP?.color ?? seriesColor(undefined, 0),
                text: `dir = ${Number(angleDeg.toFixed(1))}°`,
              },
            ],
            anchor: point,
            mathTrace: {
              x: xVal,
              y: yVal,
              screenPoint: { x: clampedX, y: clampedY },
              curveIndex: 0,
              curveColor: curveP?.color ?? seriesColor(undefined, 0),
              curveName: 'F(x,y)',
              slope: u !== 0 ? v / u : Infinity,
              tangentSegment: needle,
              crosshair: {
                xRay: [{ x: clampedX, y: clampedY }, { x: clampedX, y: plot.y + plot.height }],
                yRay: [{ x: clampedX, y: clampedY }, { x: plot.x, y: clampedY }],
              },
              fieldVector: {
                u,
                v,
                magnitude: mag,
                angleDeg,
                segment: needle,
              },
            },
          };
        }
      } else if (kind === 'implicit') {
        const curve = layout.mathPlot.curves[0];
        const fVal = curve ? curve.evaluate(xVal, yVal) : NaN;
        if (Number.isFinite(fVal)) {
          const onCurve = Math.abs(fVal) < 0.08;
          return {
            label: `(${Number(xVal.toFixed(2))}, ${Number(yVal.toFixed(2))})`,
            entries: [
              {
                name: curve.source,
                value: fVal,
                color: curve.color,
                text: `F(x,y) = ${Number(fVal.toFixed(3))}${onCurve ? ' · on the curve' : ''}`,
              },
            ],
            anchor: point,
            mathTrace: {
              x: xVal,
              y: yVal,
              screenPoint: { x: clampedX, y: clampedY },
              curveIndex: 0,
              curveColor: curve.color,
              curveName: mathText(curve.source),
              crosshair: planeCrosshair,
              // Being *on* the curve is the one thing an implicit plot can
              // tell you that the picture cannot: the band where F is near
              // zero is a pixel wide, and the reading is what says you are in
              // it. Marked as a found feature, which is what the badge is for.
              snappedFeature: onCurve
                ? { kind: 'root', x: xVal, y: yVal, label: 'On the curve', badgeText: 'F = 0' }
                : undefined,
            },
          };
        }
      } else {
        // heatmap, contour
        const curve = layout.mathPlot.curves[0];
        if (curve) {
          const zVal = curve.evaluate(xVal, yVal);
          if (Number.isFinite(zVal)) {
            const h = Math.max(1e-5, xSpan * 1e-4);
            const zXPlus = curve.evaluate(xVal + h, yVal);
            const zXMinus = curve.evaluate(xVal - h, yVal);
            const zYPlus = curve.evaluate(xVal, yVal + h);
            const zYMinus = curve.evaluate(xVal, yVal - h);
            const dzdx = (zXPlus - zXMinus) / (2 * h);
            const dzdy = (zYPlus - zYMinus) / (2 * h);
            const gradMag = Math.hypot(dzdx, dzdy);

            return {
              label: `(${Number(xVal.toFixed(2))}, ${Number(yVal.toFixed(2))})`,
              entries: [
                {
                  name: curve.source,
                  value: zVal,
                  color: curve.color,
                  text: `z = ${Number(zVal.toFixed(3))}`,
                },
                ...(Number.isFinite(gradMag)
                  ? [
                      {
                        name: '|∇f|',
                        value: gradMag,
                        color: curve.color,
                        text: `gradient = ${Number(gradMag.toFixed(2))}`,
                      },
                  ]
                  : []),
              ],
              anchor: point,
              mathTrace: {
                x: xVal,
                y: yVal,
                screenPoint: { x: clampedX, y: clampedY },
                curveIndex: 0,
                curveColor: curve.color,
                curveName: mathText(curve.source),
                crosshair: planeCrosshair,
                /**
                 * The gradient, drawn as the needle the field kinds already
                 * use — it points the way the surface climbs, which is the
                 * question a contour map exists to answer and the one a
                 * heatmap's colour can only approximate.
                 */
                fieldVector: Number.isFinite(gradMag) && gradMag > 0
                  ? {
                      u: dzdx,
                      v: dzdy,
                      magnitude: gradMag,
                      angleDeg: (Math.atan2(dzdy, dzdx) * 180) / Math.PI,
                      segment: [
                        { x: clampedX, y: clampedY },
                        {
                          x: clampedX + (dzdx / gradMag) * 18,
                          // Screen y grows downward while the surface's y
                          // grows up, so the drawn needle takes the opposite
                          // sign or it points downhill.
                          y: clampedY - (dzdy / gradMag) * 18,
                        },
                      ] as [Point, Point],
                    }
                  : undefined,
              },
            };
          }
        }
      }
    }
  }

  // ---- 1D math plots: live continuous curve tracer ------------------------
  if (layout.mathPlot && !layout.mathPlot.isTwoVariable && layout.mathPlot.curves.length > 0) {
    const trace = traceMathPlot(layout.plot, layout.mathPlot, point);
    if (trace) {
      const kind = layout.mathPlot.kind;

      if (kind === 'parametric') {
        const tVal = trace.parameterValue ?? 0;
        const tStr = Number(tVal.toFixed(3)).toString();
        const xStr = Number(trace.x.toFixed(3)).toString();
        const yStr = Number(trace.y.toFixed(3)).toString();

        const entries: ChartHitEntry[] = [
          {
            name: 'P(t)',
            value: trace.y,
            color: trace.curveColor,
            text: `(${xStr}, ${yStr})`,
          },
        ];

        if (trace.parametricVelocity) {
          const { vx, vy, speed } = trace.parametricVelocity;
          entries.push({
            name: 'v(t)',
            value: speed,
            color: trace.curveColor,
            text: `⟨${Number(vx.toFixed(2))}, ${Number(vy.toFixed(2))}⟩`,
          });
          entries.push({
            name: '|v|',
            value: speed,
            color: trace.curveColor,
            text: `speed = ${Number(speed.toFixed(3))}`,
          });
        }

        const isVert =
          Math.abs(trace.parametricVelocity?.vx ?? 0) < 1e-4 &&
          Math.abs(trace.parametricVelocity?.vy ?? 0) > 1e-4;
        const slopeStr = Number.isFinite(trace.slope)
          ? `slope = ${Number((trace.slope ?? 0).toFixed(2))}`
          : isVert
            ? 'vertical'
            : 'undefined';

        entries.push({
          name: 'dy/dx',
          value: trace.slope ?? 0,
          color: DERIVED_INK,
          text: slopeStr,
        });

        if (trace.tangentEquation) {
          entries.push({
            name: 'Tangent',
            value: trace.slope ?? 0,
            color: DERIVED_INK,
            text: trace.tangentEquation,
          });
        }

        return {
          label: `t = ${tStr}`,
          entries,
          anchor: trace.screenPoint,
          mathTrace: trace,
        };
      }

      if (kind === 'polarPlot') {
        const degStr = Number((trace.polarAngleDeg ?? 0).toFixed(1)).toString();
        const radStr = Number((trace.polarAngleRad ?? 0).toFixed(3)).toString();
        const rStr = Number((trace.polarRadius ?? 0).toFixed(3)).toString();
        const xStr = Number(trace.x.toFixed(3)).toString();
        const yStr = Number(trace.y.toFixed(3)).toString();

        const entries: ChartHitEntry[] = [
          {
            name: 'r(θ)',
            value: trace.polarRadius ?? 0,
            color: trace.curveColor,
            text: `r = ${rStr}`,
          },
          {
            name: '(x, y)',
            value: trace.y,
            color: trace.curveColor,
            text: `(${xStr}, ${yStr})`,
          },
          {
            name: 'dy/dx',
            value: trace.slope ?? 0,
            color: DERIVED_INK,
            text: Number.isFinite(trace.slope)
              ? `slope = ${Number((trace.slope ?? 0).toFixed(2))}`
              : 'vertical',
          },
        ];

        if (trace.tangentEquation) {
          entries.push({
            name: 'Tangent',
            value: trace.slope ?? 0,
            color: DERIVED_INK,
            text: trace.tangentEquation,
          });
        }

        return {
          label: `θ = ${degStr}° (${radStr} rad)`,
          entries,
          anchor: trace.screenPoint,
          mathTrace: trace,
        };
      }

      // Default 1D Cartesian function: f(x)
      const varName = layout.mathPlot.variable || 'x';
      const slopeStr = Number((trace.slope ?? 0).toFixed(2)).toString();
      const xStr = Number(trace.x.toFixed(3)).toString();
      const yStr = Number(trace.y.toFixed(3)).toString();

      return {
        label: `${varName}: ${xStr}`,
        entries: [
          {
            name: trace.curveName,
            value: trace.y,
            color: trace.curveColor,
            text: `f(${xStr}) = ${yStr}`,
          },
          {
            name: `f'(${varName})`,
            value: trace.slope ?? 0,
            color: trace.curveColor,
            text: `slope = ${slopeStr}`,
          },
          ...(trace.tangentEquation
            ? [
                {
                  name: 'Tangent',
                  value: trace.slope ?? 0,
                  color: DERIVED_INK,
                  text: trace.tangentEquation,
                },
              ]
            : []),
        ],
        anchor: trace.screenPoint,
        mathTrace: trace,
      };
    }
  }

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
        categoryIndex: s.index,
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
  // Guarded on categories: heatmaps and Riemann rectangles emit bars for painting
  // but have no categories. Hit-testing thousands of heatmap cells along a 1D axis
  // is both expensive and produces blank category tooltips.
  if (layout.bars.length && options.categories.length > 0) {
    let best: { index: number; distance: number } | null = null;
    for (const b of layout.bars) {
      // Distance along the *category* axis only, which is what makes a whole
      // column answer rather than the individual rectangle under the pointer.
      //
      // Which axis that is comes from the layout. It was worked out per bar,
      // from whether that bar was four times wider than tall -- so on a
      // waterfall, where a small step is short and wide, the pointer's
      // distance was measured along y for that bar and along x for its
      // neighbours, in the same chart.
      const horizontal = layout.categoryAxis === 'y';
      const centre = horizontal ? b.y + b.height / 2 : b.x + b.width / 2;
      const along = horizontal ? point.y : point.x;
      const d = Math.abs(along - centre);
      if (!best || d < best.distance) best = { index: b.categoryIndex, distance: d };
    }
    if (!best || best.distance > REACH) return null;

    const inBand = layout.bars.filter((b) => b.categoryIndex === best!.index);
    if (!inBand.length) return null;

    let deltaVsTarget: string | undefined;
    if (typeof options.referenceValue === 'number' && Number.isFinite(options.referenceValue)) {
      const firstVal = inBand[0]?.value;
      if (typeof firstVal === 'number') {
        const d = firstVal - options.referenceValue;
        const sign = d > 0 ? '+' : '';
        deltaVsTarget = `${sign}${options.format(d)} vs target`;
      }
    }

    return {
      label: options.categories[best.index] ?? '',
      categoryIndex: best.index,
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
      deltaVsTarget,
    };
  }

  /**
   * ---- columns: one x, every series at it -------------------------------
   *
   * The reading for every cartesian kind that is not bars. It used to be the
   * *dots*, which meant an area chart -- which draws none -- answered
   * nothing: no readout, no highlight, no explanation, on one of the four
   * kinds people use most. A line with its markers switched off had the same
   * hole, and neither said anything was wrong.
   *
   * Reading by column rather than by nearest mark is also the better answer
   * on its own terms: hovering a moment in time to compare the series is what
   * the gesture is for, and picking the single nearest vertex reports one
   * series and hides the rest.
   */
  if (layout.columns.length) {
    const transposed = layout.columns.length > 1 && layout.columns[0].x === layout.columns[1].x;
    const along = (c: (typeof layout.columns)[number]) => (transposed ? c.y : c.x);
    const at = transposed ? point.y : point.x;

    let best: (typeof layout.columns)[number] | null = null;
    let bestD = Infinity;
    for (const column of layout.columns) {
      const d = Math.abs(along(column) - at);
      if (d < bestD) {
        bestD = d;
        best = column;
      }
    }

    if (best && bestD <= REACH && best.entries.length > 0) {
      // The series nearest the pointer *within* the column, so the readout can
      // say which line is being followed and the renderer can lift it.
      let nearest = best.entries[0];
      let nearestD = Infinity;
      for (const entry of best.entries) {
        const d = Math.hypot(entry.x - point.x, entry.y - point.y);
        if (d < nearestD) {
          nearestD = d;
          nearest = entry;
        }
      }

      let deltaVsTarget: string | undefined;
      if (typeof options.referenceValue === 'number' && Number.isFinite(options.referenceValue)) {
        const d = nearest.value - options.referenceValue;
        deltaVsTarget = `${d > 0 ? '+' : ''}${options.format(d)}`;
      }

      return {
        label: options.categories[best.categoryIndex] ?? '',
        categoryIndex: best.categoryIndex,
        seriesIndex: nearest.seriesIndex,
        entries: best.entries.map((entry) => ({
          name: options.seriesNames[entry.seriesIndex] ?? '',
          value: entry.value,
          color: entry.color,
          text: options.format(entry.value),
        })),
        // Anchored on the series being followed rather than on the column's
        // top, so the readout appears beside the value it is describing.
        anchor: { x: nearest.x, y: nearest.y },
        deltaVsTarget,
      };
    }
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
        // Both indices, which this branch never reported -- so hovering a
        // scatter point lit nothing, because every highlight in the renderer
        // keys off exactly these.
        categoryIndex: best.categoryIndex,
        seriesIndex: best.seriesIndex,
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

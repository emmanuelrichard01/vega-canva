import React from 'react';
import { Arc, Circle, Group, Line, Path, Rect, Text } from 'react-konva';
import type { ChartNode } from '../../../engine/model/schema';
import { layoutChart, type ChartLayout, type Measure } from '../../../engine/chart/chartLayout';
import { measureChartText } from '../../../engine/chart/chartMeasure';
import { CHART_CHROME, CHART_INK, CHART_SLICE_EDGE } from '../../../engine/chart/chartInk';
import {
  rectRing,
  roughLoop,
  roughPolyline,
  seedFor,
  type SketchLevel,
} from '../../../engine/model/rough';

/**
 * A chart, drawn from its data.
 *
 * ## This component does no arithmetic
 *
 * Every coordinate comes from `layoutChart`, which is pure and tested in Node.
 * That is not tidiness: the SVG exporter draws charts from the *same* layout,
 * and the one thing this codebase has repeatedly shipped is a picture on
 * screen that differs from the picture in the file — see `isolate.ts` for the
 * export version of the same bug. Two painters reading one layout cannot
 * disagree about where the third bar is.
 *
 * So the rule for editing this file: if you find yourself computing a
 * position, it belongs in `chartLayout.ts` with a test.
 *
 * ## Sketch
 *
 * A sketched chart is drawn with the same pen as every other object —
 * `roughLoop` for bars and slices, `roughPolyline` for runs and rules — seeded
 * from the node id so it is stable across renders, reloads, collaborators and
 * exports. Only the *marks* are sketched. Grid lines and axis labels stay
 * crisp, deliberately: the hand-drawn look is a statement about the data, and
 * a wobbling axis reads as a rendering fault rather than as a style. That is
 * the same division the diagram engine draws between content and chrome.
 */

interface Props {
  node: ChartNode;
}

// Both painters read these from one module, so a chart cannot be drawn in one
// set of greys on screen and another in the file. See `chartInk.ts`.
const CHROME = CHART_CHROME;
const INK = CHART_INK;

export const ChartRenderer: React.FC<Props> = ({ node }) => {
  const sketch = node.appearance?.sketch;

  /**
   * Measured with the real font, so the axis gutter is the width the labels
   * will actually take. The layout takes a measurer for exactly this reason —
   * `approximateMeasure` is close enough for Node and wrong by a few per cent
   * on screen, which is a clipped `1200` at one end and a stripe of dead space
   * at the other.
   */
  const measure = React.useCallback<Measure>(
    (text, fontSize) => measureChartText(text, fontSize),
    []
  );

  const layout = React.useMemo(
    () => layoutChart(node.chart, node.width, node.height, measure),
    [node.chart, node.width, node.height, measure]
  );

  const seed = React.useMemo(
    () => seedFor(node.id, node.appearance?.sketchSeed),
    [node.id, node.appearance?.sketchSeed]
  );

  return (
    <Group listening={false}>
      <Chrome layout={layout} />
      <Marks layout={layout} sketch={sketch} seed={seed} />
      <Labels layout={layout} />
    </Group>
  );
};

/** Grid rules, the zero baseline, and nothing that carries a value. */
const Chrome: React.FC<{ layout: ChartLayout }> = ({ layout }) => (
  <>
    {layout.gridLines.map((g, i) => (
      <Line
        key={`g${i}`}
        points={[g.x1, g.y1, g.x2, g.y2]}
        stroke={CHROME}
        strokeWidth={1}
        opacity={0.35}
        listening={false}
        perfectDrawEnabled={false}
      />
    ))}
    {layout.baseline && (
      <Line
        points={[layout.baseline.x1, layout.baseline.y1, layout.baseline.x2, layout.baseline.y2]}
        stroke={CHROME}
        strokeWidth={1.5}
        listening={false}
        perfectDrawEnabled={false}
      />
    )}
  </>
);

const Marks: React.FC<{
  layout: ChartLayout;
  sketch: SketchLevel | undefined;
  seed: number;
}> = ({ layout, sketch, seed }) => (
  <>
    {layout.bars.map((b, i) =>
      sketch ? (
        <Path
          key={`b${i}`}
          // The pen is handed the bar's own outline, so a sketched bar is the
          // same rectangle the crisp one is — drawn by hand, not approximated
          // by a different shape. `rectRing` is the ring `ShapeRenderer`
          // sketches from, so a bar and a rectangle are drawn by one pen.
          data={roughLoop(
            rectRing(b.width, b.height).map((p) => ({ x: p.x + b.x, y: p.y + b.y })),
            // Each mark gets its own seed offset, or every bar on the chart
            // would carry an identical wobble and read as a repeated texture
            // rather than as a hand.
            { seed: seed + i * 17, level: sketch }
          )}
          fill={b.color}
          stroke={b.color}
          strokeWidth={1.4}
          opacity={0.92}
          listening={false}
          perfectDrawEnabled={false}
        />
      ) : (
        <Rect
          key={`b${i}`}
          x={b.x}
          y={b.y}
          width={b.width}
          height={b.height}
          fill={b.color}
          cornerRadius={Math.min(3, b.width / 6)}
          listening={false}
          perfectDrawEnabled={false}
        />
      )
    )}

    {layout.areas.map((a, i) => (
      <Line
        key={`a${i}`}
        points={flatten(a.polygon)}
        closed
        fill={a.color}
        opacity={0.22}
        listening={false}
        perfectDrawEnabled={false}
      />
    ))}

    {/*
      A single point is a dot rather than a line, and a zero-length segment
      draws as nothing — the run's own dots cover that case, so a one-point
      run is skipped here instead of being drawn empty.
    */}
    {layout.runs.map((r, i) =>
      r.points.length < 2 ? null : sketch ? (
        <Path
          key={`r${i}`}
          // `closed: false` matters: a run is a line, and closing it would
          // draw a stroke back to the first reading.
          data={roughPolyline(r.points, { seed: seed + i * 31, level: sketch, closed: false })}
          stroke={r.color}
          strokeWidth={2.5}
          lineCap="round"
          lineJoin="round"
          listening={false}
          perfectDrawEnabled={false}
        />
      ) : (
        <Line
          key={`r${i}`}
          points={flatten(r.points)}
          stroke={r.color}
          strokeWidth={2.5}
          lineCap="round"
          lineJoin="round"
          listening={false}
          perfectDrawEnabled={false}
        />
      )
    )}

    {layout.dots.map((d, i) => (
      <Circle
        key={`d${i}`}
        x={d.x}
        y={d.y}
        radius={d.radius}
        fill={d.color}
        listening={false}
        perfectDrawEnabled={false}
      />
    ))}

    {layout.slices.map((s, i) => (
      <Arc
        key={`s${i}`}
        x={s.cx}
        y={s.cy}
        innerRadius={s.innerRadius}
        outerRadius={s.outerRadius}
        // Konva takes degrees and measures clockwise from three o'clock; the
        // layout already applied the quarter turn to twelve, so this is a
        // units conversion and nothing else. Doing the turn here as well is
        // how the two painters would come to draw the same pie rotated
        // differently.
        rotation={(s.startAngle * 180) / Math.PI}
        angle={((s.endAngle - s.startAngle) * 180) / Math.PI}
        fill={s.color}
        stroke={CHART_SLICE_EDGE}
        strokeWidth={1.5}
        listening={false}
        perfectDrawEnabled={false}
      />
    ))}
  </>
);

const Labels: React.FC<{ layout: ChartLayout }> = ({ layout }) => (
  <>
    {layout.title && (
      <Text
        text={layout.title.text}
        x={layout.title.x}
        y={layout.title.y}
        width={layout.title.width}
        fontSize={layout.title.fontSize}
        fontStyle="600"
        fill={INK}
        listening={false}
      />
    )}

    {[...layout.axisLabels, ...layout.categoryLabels].map((l, i) => (
      <Text
        key={`t${i}`}
        text={l.text}
        x={l.x}
        y={l.y}
        width={l.width}
        align={l.align}
        fontSize={l.fontSize}
        fill={CHROME}
        listening={false}
      />
    ))}

    {layout.valueLabels.map((l, i) => (
      <Text
        key={`v${i}`}
        text={l.text}
        x={l.x}
        y={l.y}
        width={l.width}
        align={l.align}
        fontSize={l.fontSize}
        fontStyle="600"
        fill={INK}
        listening={false}
      />
    ))}

    {layout.legend.map((e, i) => (
      <React.Fragment key={`l${i}`}>
        <Rect
          x={e.x}
          y={e.y}
          width={e.swatch}
          height={e.swatch}
          fill={e.color}
          cornerRadius={2}
          listening={false}
        />
        <Text
          text={e.label}
          x={e.textX}
          y={e.y - 1}
          fontSize={e.fontSize}
          fill={INK}
          listening={false}
        />
      </React.Fragment>
    ))}
  </>
);

/** Konva wants a flat number array; the layout speaks in points. */
function flatten(points: Array<{ x: number; y: number }>): number[] {
  const out: number[] = [];
  for (const p of points) out.push(p.x, p.y);
  return out;
}

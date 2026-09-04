import React from 'react';
import { Arc, Circle, Group, Line, Path, Rect, Text } from 'react-konva';
import type { ChartNode } from '../../../engine/model/schema';
import { layoutChart, type ChartLayout, type Measure } from '../../../engine/chart/chartLayout';
import type { ChartInk } from '../../../engine/chart/chartInk';
import { measureChartText } from '../../../engine/chart/chartMeasure';
import { ThemeService } from '../../../engine/ThemeService';
import { EXPORT_CHROME } from '../../../engine/export/chrome';
import { currentChartInk } from '../../../engine/chart/chartInk';
import { chartHitTest, placeReadout, type ChartHit } from '../../../engine/chart/chartHitTest';
import { formatValue } from '../../../engine/chart/chartLayout';
import { isRadial } from '../../../engine/chart/chartTypes';
import { canvasPlateFill } from '../../../engine/ThemeService';
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

  /**
   * Re-read on every render rather than memoised: the theme toggle rewrites a
   * class on `body`, which is not something React re-renders for. Every render
   * this component does have already been triggered by something else, and the
   * read is a `classList.contains`.
   */
  const ink = currentChartInk();

  /**
   * What the pointer is over, if anything.
   *
   * Transient by every test in `ARCHITECTURE.md`'s table: nobody else wants to
   * see which bar *I* am hovering, it must never enter the undo history, and it
   * would flicker on every collaborator's screen if it did. So it is component
   * state, not awareness and not the document.
   */
  const [hover, setHover] = React.useState<ChartHit | null>(null);

  const seed = React.useMemo(
    () => seedFor(node.id, node.appearance?.sketchSeed),
    [node.id, node.appearance?.sketchSeed]
  );

  /**
   * The pointer, in the node's own coordinate space.
   *
   * `getRelativePointerPosition` on the group does the whole conversion --
   * world, camera, rotation and the node's own offset -- with Konva's own
   * transform. Doing it by hand from the event's client coordinates is the
   * three-spaces bug in invariant 10, and this is the one call that cannot get
   * it wrong.
   */
  const onMove = (e: any) => {
    const group = e.currentTarget;
    const p = group?.getRelativePointerPosition?.();
    if (!p) return;
    setHover(
      chartHitTest(layout, p, {
        format: (v) => formatValue(v, node.chart),
        categories: node.chart.categories,
        seriesNames: node.chart.series.map((s) => s.name),
        keyedOnCategories: isRadial(node.chart.kind) || node.chart.kind === 'funnel',
      })
    );
  };

  return (
    /*
      Listening, where every other part of this renderer is not.
      A chart's marks are `listening={false}` so the object answers as one thing
      to selection and dragging -- the grid renderer's rule, for the grid
      renderer's reason. The hit rectangle below is the single listener, so a
      hover costs one hit test rather than one per bar.
    */
    <Group onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      {/**
       * The chart's hit area is its **box**, and this rectangle is the whole of
       * it.
       *
       * Two things depend on it, and the first is not optional. Konva hit-tests
       * *drawn pixels*, and every mark below is `listening={false}` so the chart
       * answers as one object rather than as ninety bars — which means without
       * this rectangle the node has no hit area at all. It was not here for the
       * first four commits of this feature, and the consequence was not subtle:
       * a chart could not be selected, dragged, or right-clicked. It drew
       * perfectly and could not be touched.
       *
       * Second, it is the single listener the hover readout hangs off, so
       * moving the pointer across a chart costs one hit test rather than one
       * per mark.
       *
       * Not `fill="transparent"`, and not a small non-zero alpha: an
       * alpha-**zero** fill draws nothing and is hit everywhere, which is the
       * idiom `GridRenderer` established here and the reason its docstring
       * spells it out.
       */}
      <Rect
        x={0}
        y={0}
        width={node.width}
        height={node.height}
        fill="rgba(0,0,0,0)"
        perfectDrawEnabled={false}
      />
      <Chrome layout={layout} ink={ink} />
      <Marks layout={layout} sketch={sketch} seed={seed} ink={ink} />
      <Reference layout={layout} />
      <Labels layout={layout} ink={ink} />
      <Readout hit={hover} node={node} ink={ink} />
    </Group>
  );
};

/**
 * The live readout.
 *
 * ## Drawn in Konva rather than in the DOM
 *
 * Every other floating surface in this app is a DOM element positioned in
 * *window* coordinates, and every one of them has had to learn to add the
 * stage origin -- see invariant 10 and the contextual rail, which was drawn a
 * ruler's width off for as long as it existed. A readout that lives inside the
 * chart's own Konva group is in node-local coordinates by construction: it pans,
 * zooms and rotates with the object for free, and there is no space to convert
 * between and therefore no conversion to get wrong.
 *
 * The trade is that it cannot use the app's CSS. For a small plate with two
 * lines of text that is not a real cost, and `canvasPlateFill` already exists
 * for exactly this -- a surface colour that stays readable over whatever the
 * board is.
 *
 * ## Why it carries `EXPORT_CHROME`
 *
 * It is a hover state. It is on the stage, so a raster capture would find it
 * and put somebody's pointer position into the exported file.
 */
const Readout: React.FC<{ hit: ChartHit | null; node: ChartNode; ink: ChartInk }> = ({
  hit,
  node,
  ink,
}) => {
  if (!hit) return null;

  const ROW = 15;
  const PAD = 8;
  const SWATCH = 7;
  // Measured off the longest row rather than fixed, so a long series name is
  // not clipped and a short one does not sit in a wide empty plate.
  const widest = Math.max(
    measureChartText(hit.label, 11, '600'),
    ...hit.entries.map((e) => measureChartText(`${e.name}  ${e.text}`, 11) + SWATCH + 6)
  );
  const width = Math.min(node.width - 8, widest + PAD * 2);
  const height = PAD * 2 + ROW * (hit.entries.length + (hit.label ? 1 : 0));

  const at = placeReadout(hit.anchor, { width, height }, { width: node.width, height: node.height });
  const plate = canvasPlateFill(ThemeService.isDarkMode());

  return (
    <Group x={at.x} y={at.y} listening={false} name={EXPORT_CHROME}>
      <Rect
        width={width}
        height={height}
        cornerRadius={6}
        fill={plate}
        shadowColor="rgba(0,0,0,0.28)"
        shadowBlur={12}
        shadowOffsetY={3}
        perfectDrawEnabled={false}
      />
      {hit.label && (
        <Text
          text={hit.label}
          x={PAD}
          y={PAD}
          width={width - PAD * 2}
          fontSize={11}
          fontStyle="600"
          fill={ink.ink}
        />
      )}
      {hit.entries.map((e, i) => {
        const y = PAD + (hit.label ? ROW : 0) + i * ROW;
        return (
          <React.Fragment key={i}>
            <Rect x={PAD} y={y + 3} width={SWATCH} height={SWATCH} cornerRadius={2} fill={e.color} />
            <Text text={e.name} x={PAD + SWATCH + 6} y={y} fontSize={11} fill={ink.chrome} />
            <Text
              text={e.text}
              x={PAD}
              y={y}
              width={width - PAD * 2}
              align="right"
              fontSize={11}
              fontStyle="600"
              fill={ink.ink}
            />
          </React.Fragment>
        );
      })}
    </Group>
  );
};

/** Grid rules, the zero baseline, and nothing that carries a value. */
const Chrome: React.FC<{ layout: ChartLayout; ink: ChartInk }> = ({ layout, ink }) => (
  <>
    {layout.gridLines.map((g, i) => (
      <Line
        key={`g${i}`}
        points={[g.x1, g.y1, g.x2, g.y2]}
        stroke={ink.chrome}
        strokeWidth={1}
        opacity={0.35}
        listening={false}
        perfectDrawEnabled={false}
      />
    ))}
    {layout.baseline && (
      <Line
        points={[layout.baseline.x1, layout.baseline.y1, layout.baseline.x2, layout.baseline.y2]}
        stroke={ink.chrome}
        strokeWidth={1.5}
        listening={false}
        perfectDrawEnabled={false}
      />
    )}

    {/*
      Radar's spokes and rings. Rings are polygons rather than circles: they
      have to have the same shape as the outline in front of them, or a value
      sitting on a ring does not appear to touch it.
    */}
    {layout.spokes.map((s, i) => (
      <Line
        key={`sp${i}`}
        points={[s.x1, s.y1, s.x2, s.y2]}
        stroke={ink.chrome}
        strokeWidth={1}
        opacity={0.35}
        listening={false}
        perfectDrawEnabled={false}
      />
    ))}
    {layout.rings.map((r, i) => (
      <Line
        key={`rg${i}`}
        points={flatten(r.points)}
        closed
        stroke={ink.chrome}
        strokeWidth={1}
        opacity={0.3}
        listening={false}
        perfectDrawEnabled={false}
      />
    ))}
  </>
);

/**
 * The reference rule, above the marks.
 *
 * Dashed so it reads as an annotation rather than as another series, and drawn
 * after the geometry so a bar cannot hide the target it missed.
 */
const Reference: React.FC<{ layout: ChartLayout }> = ({ layout }) => {
  const r = layout.reference;
  if (!r) return null;
  return (
    <>
      <Line
        points={[r.x1, r.y1, r.x2, r.y2]}
        stroke={r.color}
        strokeWidth={1.5}
        dash={[5, 4]}
        listening={false}
        perfectDrawEnabled={false}
      />
      {r.label && (
        <Text
          text={r.label.text}
          x={r.label.x}
          y={r.label.y}
          width={r.label.width}
          align={r.label.align}
          fontSize={r.label.fontSize}
          fontStyle="600"
          fill={r.color}
          listening={false}
        />
      )}
    </>
  );
};

const Marks: React.FC<{
  layout: ChartLayout;
  sketch: SketchLevel | undefined;
  seed: number;
  ink: ChartInk;
}> = ({ layout, sketch, seed, ink }) => (
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
        stroke={ink.sliceEdge}
        strokeWidth={1.5}
        listening={false}
        perfectDrawEnabled={false}
      />
    ))}
  </>
);

const Labels: React.FC<{ layout: ChartLayout; ink: ChartInk }> = ({ layout, ink }) => (
  <>
    {layout.title && (
      <Text
        text={layout.title.text}
        x={layout.title.x}
        y={layout.title.y}
        width={layout.title.width}
        fontSize={layout.title.fontSize}
        fontStyle="600"
        fill={ink.ink}
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
        fill={ink.chrome}
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
        fill={ink.ink}
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
          fill={ink.ink}
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

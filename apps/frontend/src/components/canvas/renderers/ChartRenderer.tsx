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
import { isRadial, isPlot, defaultPlotDomain } from '../../../engine/chart/chartTypes';
import { updateChart } from '../../../engine/chart/chartApply';
import { useStore } from '../../../hooks/useStore';
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



/** The four numbers that say which part of the plane is on screen. */
interface PlaneDomain {
  xMin: number;
  xMax: number;
  yPlotMin: number;
  yPlotMax: number;
}

/**
 * Three decimals, which is finer than a pixel at any zoom this supports.
 *
 * Rounding at all is what stops a pan writing `-6.500000000000001` into the
 * document and into everybody's undo history.
 */
const round3 = (v: number) => Number(v.toFixed(3));

/** How long after the last wheel event the zoom is written down. */
const PLANE_SETTLE_MS = 260;

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

  /**
   * The plane while it is being moved, before it is written down.
   *
   * Panning wrote to the document on every pointer move: a CRDT transaction
   * per frame, replicated to everyone in the room and pushed onto the undo
   * stack, so dragging a plot across two units left forty edits behind and
   * forty presses of undo to take back. The same defect the data sheet had,
   * on a gesture that fires far more often than typing does.
   *
   * The draft is local, the layout is drawn from it, and the document is
   * written once when the gesture ends -- so a pan is one edit, and a
   * collaborator sees where it landed rather than every frame on the way.
   */
  const [draftPlane, setDraftPlane] = React.useState<PlaneDomain | null>(null);

  const shownSpec = React.useMemo(
    () => (draftPlane ? { ...node.chart, ...draftPlane } : node.chart),
    [node.chart, draftPlane]
  );

  const layout = React.useMemo(
    () => layoutChart(shownSpec, node.width, node.height, measure),
    [shownSpec, node.width, node.height, measure]
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

  const settleRef = React.useRef<number | null>(null);

  const dragStartRef = React.useRef<{ startX: number; startY: number } & PlaneDomain | null>(null);

  /**
   * Where the plane is now, filled in from the kind's real default.
   *
   * Every one of these read `?? -10`, and no plot opens at -10: a function
   * plot is -6.5 to 6.5 and a two-variable one is -6 to 6. So the first pan
   * or zoom of an untouched plot did not move the view, it *teleported* it --
   * the gesture began from a domain the chart had never been drawn at.
   */
  const planeNow = React.useCallback((): PlaneDomain => {
    const fallback = defaultPlotDomain(node.chart.kind);
    return {
      xMin: node.chart.xMin ?? fallback.xMin ?? -5,
      xMax: node.chart.xMax ?? fallback.xMax ?? 5,
      yPlotMin: node.chart.yPlotMin ?? fallback.yPlotMin ?? -5,
      yPlotMax: node.chart.yPlotMax ?? fallback.yPlotMax ?? 5,
    };
  }, [node.chart]);

  const onPointerDown = (e: any) => {
    if ((node.chart.kind === 'slopeField' || node.chart.kind === 'vectorField') && e.evt.altKey) {
      e.evt.preventDefault();
      e.evt.stopPropagation();
      const group = e.currentTarget;
      const p = group?.getRelativePointerPosition?.();
      if (!p) return;
      const plotW = Math.max(layout.plot.width, 10);
      const plotH = Math.max(layout.plot.height, 10);
      const xMin = node.chart.xMin ?? -5;
      const xMax = node.chart.xMax ?? 5;
      const yMin = node.chart.yPlotMin ?? -5;
      const yMax = node.chart.yPlotMax ?? 5;
      const seedX = Number((xMin + ((p.x - layout.plot.x) / plotW) * (xMax - xMin)).toFixed(3));
      const seedY = Number((yMin + (1 - (p.y - layout.plot.y) / plotH) * (yMax - yMin)).toFixed(3));
      const existing = node.chart.seedPoints || [];
      updateChart(node.id, {
        ...node.chart,
        seedPoints: [...existing, { x: seedX, y: seedY }],
      });
      return;
    }

    if (isPlot(node.chart.kind) && (e.evt.shiftKey || e.evt.button === 1)) {
      if (node.chart.lockPlane) return;
      e.evt.preventDefault();
      e.evt.stopPropagation();
      const group = e.currentTarget;
      const p = group?.getRelativePointerPosition?.();
      if (!p) return;
      dragStartRef.current = { startX: p.x, startY: p.y, ...planeNow() };
    }
  };

  /** The gesture is over: write where it landed, once. */
  const commitPlane = React.useCallback(() => {
    dragStartRef.current = null;
    setDraftPlane((current) => {
      if (current) updateChart(node.id, { ...node.chart, ...current });
      return null;
    });
  }, [node.id, node.chart]);

  const onPointerUp = () => commitPlane();

  /**
   * The pointer, in the node's own coordinate space.
   */
  const onMove = (e: any) => {
    const group = e.currentTarget;
    const p = group?.getRelativePointerPosition?.();
    if (!p) return;

    if (dragStartRef.current && isPlot(node.chart.kind)) {
      if (node.chart.lockPlane) {
        dragStartRef.current = null;
        return;
      }
      const dx = p.x - dragStartRef.current.startX;
      const dy = p.y - dragStartRef.current.startY;
      const xSpan = dragStartRef.current.xMax - dragStartRef.current.xMin;
      const ySpan = dragStartRef.current.yPlotMax - dragStartRef.current.yPlotMin;
      const plotW = Math.max(layout.plot.width, 10);
      const plotH = Math.max(layout.plot.height, 10);
      const dxDomain = -(dx / plotW) * xSpan;
      const dyDomain = (dy / plotH) * ySpan;

      setDraftPlane({
        xMin: round3(dragStartRef.current.xMin + dxDomain),
        xMax: round3(dragStartRef.current.xMax + dxDomain),
        yPlotMin: round3(dragStartRef.current.yPlotMin + dyDomain),
        yPlotMax: round3(dragStartRef.current.yPlotMax + dyDomain),
      });
      return;
    }

    setHover(
      chartHitTest(layout, p, {
        // Already resolved for this frame's drawing; asking the document again
        // per pointer move would be a class-list read per mouse pixel.
        ink,
        format: (v) => formatValue(v, node.chart),
        categories: node.chart.categories,
        seriesNames: node.chart.series.map((s) => s.name),
        keyedOnCategories: isRadial(node.chart.kind) || node.chart.kind === 'funnel',
      })
    );
  };

  const onWheel = (e: any) => {
    if (isPlot(node.chart.kind) && (e.evt.altKey || e.evt.ctrlKey)) {
      if (node.chart.lockPlane) {
        // Plane is locked! Do not zoom the math plane; allow event to bubble for canvas zoom.
        return;
      }
      e.evt.preventDefault();
      e.evt.stopPropagation();
      const group = e.currentTarget;
      const p = group?.getRelativePointerPosition?.();
      if (!p) return;
      const factor = e.evt.deltaY < 0 ? 0.88 : 1.15;
      const { xMin, xMax, yPlotMin, yPlotMax } = draftPlane ?? planeNow();
      const plotW = Math.max(layout.plot.width, 10);
      const plotH = Math.max(layout.plot.height, 10);

      const ratioX = Math.max(0, Math.min(1, (p.x - layout.plot.x) / plotW));
      const ratioY = Math.max(0, Math.min(1, 1 - (p.y - layout.plot.y) / plotH));
      const curX = xMin + ratioX * (xMax - xMin);
      const curY = yPlotMin + ratioY * (yPlotMax - yPlotMin);

      const nextXMin = curX - ratioX * (xMax - xMin) * factor;
      const nextXMax = nextXMin + (xMax - xMin) * factor;
      const nextYMin = curY - ratioY * (yPlotMax - yPlotMin) * factor;
      const nextYMax = nextYMin + (yPlotMax - yPlotMin) * factor;

      /**
       * Drafted like a drag, and settled shortly after the wheel stops.
       *
       * A wheel emits dozens of events per turn and each one was a document
       * write. There is no "wheel end" event to commit on, so the settle is a
       * timer: long enough that one continuous zoom is one edit, short enough
       * that letting go feels like it landed.
       */
      setDraftPlane({
        xMin: round3(nextXMin),
        xMax: round3(nextXMax),
        yPlotMin: round3(nextYMin),
        yPlotMax: round3(nextYMax),
      });
      if (settleRef.current !== null) window.clearTimeout(settleRef.current);
      settleRef.current = window.setTimeout(() => {
        settleRef.current = null;
        commitPlane();
      }, PLANE_SETTLE_MS);
    }
  };

  const onDblClick = () => {
    useStore.getState().setChartDataModalNodeId(node.id);
  };

  return (
    <Group
      onPointerDown={onPointerDown}
      onPointerMove={onMove}
      onPointerUp={onPointerUp}
      onWheel={onWheel}
      onDblClick={onDblClick}
      onPointerLeave={() => {
        // Commits rather than discards: the pointer leaving the chart is the
        // end of the gesture, not a reason to throw away where it got to.
        commitPlane();
        setHover(null);
      }}
    >
      <Rect
        x={0}
        y={0}
        width={node.width}
        height={node.height}
        fill="rgba(0,0,0,0)"
        perfectDrawEnabled={false}
      />
      <Chrome layout={layout} ink={ink} />
      <CategoryBand hit={hover} layout={layout} />
      {/* Under the marks: a guide drawn over the data hides the thing it is
          helping you read. Bars have the band instead — two indicators for
          one pointer is one too many. */}
      {layout.bars.length === 0 && (
        <Crosshair
          hit={hover}
          layout={layout}
          ink={ink}
          bothAxes={Boolean(layout.mathPlot?.isTwoVariable)}
        />
      )}
      <ToleranceBand layout={layout} />
      <Marks
        layout={layout}
        sketch={sketch}
        seed={seed}
        ink={ink}
        hoveredCategoryIndex={hover?.categoryIndex}
        hoveredSeriesIndex={hover?.seriesIndex}
        areaOpacity={node.chart.areaOpacity}
      />
      <MathHUD hit={hover} ink={ink} />
      <Reference layout={layout} />
      <Labels layout={layout} ink={ink} />
      {isPlot(node.chart.kind) && (
        <PlaneChrome
          node={node}
          layout={layout}
          ink={ink}
          isHovered={Boolean(hover)}
          onReset={() => {
            // Cancels any pending settle, so a zoom that was still in flight
            // does not land on top of the reset a moment later.
            if (settleRef.current !== null) window.clearTimeout(settleRef.current);
            settleRef.current = null;
            setDraftPlane(null);
            updateChart(node.id, { ...node.chart, ...defaultPlotDomain(node.chart.kind) });
          }}
        />
      )}
      <Readout hit={hover} node={node} ink={ink} />
    </Group>
  );
};

/**
 * The plane's lock, and the way back to where it started.
 *
 * ## Two controls, because the lock alone was a trap
 *
 * A plot you can pan and zoom is a plot you can get lost in — three seconds of
 * scrolling leaves you at a domain of `147.3` to `152.9` with the curve
 * nowhere on screen, and nothing on the chart says how to get back. The reset
 * lived in the properties panel, which is the one place you are not looking
 * when you have just lost the view. It sits on the chart now, next to the
 * thing that let you lose it.
 *
 * It appears only once the plane has actually been moved, so an untouched
 * plot carries one control rather than two: a "reset" beside a view that is
 * already the default is a button that does nothing, and offering it is how a
 * reader learns to ignore that corner.
 *
 * ## Why not an emoji
 *
 * It was 🔒, which Konva hands to the platform's emoji font: a flat glyph on
 * one machine, a full-colour picture on another, a box on a third — and it
 * cannot take the ink colour, so it ignored the theme entirely. These are
 * drawn from paths at the same weight as every other mark on the chart.
 *
 * ## Where it sits
 *
 * Top-left of the plot, not top-right, because the top-right is where a
 * heatmap's colour bar goes and two things placed at the same corner is a
 * collision waiting for the first surface that has both.
 */
const PlaneChrome: React.FC<{
  node: ChartNode;
  layout: ChartLayout;
  ink: ChartInk;
  /** Shown on hover as well as when locked; a lock is state and must persist. */
  isHovered: boolean;
  onReset: () => void;
}> = ({ node, layout, ink, isHovered, onReset }) => {
  const locked = Boolean(node.chart.lockPlane);
  const plot = layout.plot;
  if (plot.width <= 20 || plot.height <= 20) return null;

  const fallback = defaultPlotDomain(node.chart.kind);
  const moved =
    (node.chart.xMin ?? fallback.xMin) !== fallback.xMin ||
    (node.chart.xMax ?? fallback.xMax) !== fallback.xMax ||
    (node.chart.yPlotMin ?? fallback.yPlotMin) !== fallback.yPlotMin ||
    (node.chart.yPlotMax ?? fallback.yPlotMax) !== fallback.yPlotMax;

  // A locked plane always says so. Everything else is on hover, so a chart at
  // rest is the chart and not the controls.
  if (!locked && !isHovered) return null;

  const SIZE = 20;
  const GAP = 3;
  const x = plot.x + 4;
  const y = plot.y + 4;

  return (
    <Group name={EXPORT_CHROME}>
      <PlaneButton
        x={x}
        y={y}
        size={SIZE}
        ink={ink}
        active={locked}
        label={locked ? 'Unlock the plane' : 'Lock the plane against panning and zooming'}
        onPress={() => updateChart(node.id, { ...node.chart, lockPlane: !locked })}
      >
        <LockGlyph size={SIZE} locked={locked} color={locked ? ink.ink : ink.chrome} />
      </PlaneButton>

      {moved && isHovered && (
        <PlaneButton
          x={x + SIZE + GAP}
          y={y}
          size={SIZE}
          ink={ink}
          active={false}
          label="Put the plane back where it started"
          onPress={onReset}
        >
          <ResetGlyph size={SIZE} color={ink.chrome} />
        </PlaneButton>
      )}
    </Group>
  );
};

/** One square control on the plot, with the hit area and chrome they share. */
const PlaneButton: React.FC<{
  x: number;
  y: number;
  size: number;
  ink: ChartInk;
  active: boolean;
  label: string;
  onPress: () => void;
  children: React.ReactNode;
}> = ({ x, y, size, ink, active, label, onPress, children }) => {
  const press = (e: any) => {
    // The chart under it must not also take the click.
    e.cancelBubble = true;
    onPress();
  };
  return (
    <Group x={x} y={y} onClick={press} onTap={press}>
      <Rect
        width={size}
        height={size}
        cornerRadius={4}
        // The board's own colour rather than a fixed dark wash, so the control
        // reads as sitting on the chart in both themes instead of as a black
        // square on a white one.
        fill={ink.sliceEdge}
        opacity={active ? 0.95 : 0.8}
        stroke={active ? ink.ink : ink.chrome}
        strokeWidth={1}
        perfectDrawEnabled={false}
      />
      {children}
      {/* Named for a screen reader and for the accessibility tree Konva
          exposes; the visual is the glyph. */}
      <Rect width={size} height={size} fill="rgba(0,0,0,0)" name={label} />
    </Group>
  );
};

/** A padlock, drawn rather than typed. Open when the plane is free. */
const LockGlyph: React.FC<{ size: number; locked: boolean; color: string }> = ({
  size,
  locked,
  color,
}) => {
  const cx = size / 2;
  const bodyW = 9;
  const bodyH = 7;
  const bodyY = size / 2 - 1;
  return (
    <>
      <Rect
        x={cx - bodyW / 2}
        y={bodyY}
        width={bodyW}
        height={bodyH}
        cornerRadius={1.5}
        stroke={color}
        strokeWidth={1.3}
        listening={false}
        perfectDrawEnabled={false}
      />
      {/* The shackle: centred when closed, and swung off to one side when
          open, which is how a padlock actually reads as unlocked. */}
      <Arc
        x={locked ? cx : cx + 2.6}
        y={bodyY}
        innerRadius={3}
        outerRadius={3}
        angle={180}
        rotation={180}
        stroke={color}
        strokeWidth={1.3}
        listening={false}
        perfectDrawEnabled={false}
      />
    </>
  );
};

/** A counter-clockwise arrow: the shape "undo" has meant for forty years. */
const ResetGlyph: React.FC<{ size: number; color: string }> = ({ size, color }) => {
  const c = size / 2;
  const r = 5;
  return (
    <>
      <Arc
        x={c}
        y={c}
        innerRadius={r}
        outerRadius={r}
        angle={280}
        rotation={140}
        stroke={color}
        strokeWidth={1.3}
        listening={false}
        perfectDrawEnabled={false}
      />
      <Line
        points={[c - r - 2.2, c - 1.6, c - r, c - 4.4, c - r + 2.6, c - 2.2]}
        stroke={color}
        strokeWidth={1.3}
        lineJoin="round"
        lineCap="round"
        closed={false}
        listening={false}
        perfectDrawEnabled={false}
      />
    </>
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

  const ROW = 16;
  const PAD = 8;
  const SWATCH = 7;
  const feature = hit.mathTrace?.snappedFeature;
  const delta = hit.deltaVsTarget;

  const displayLabel = feature ? `${feature.label} · ${hit.label}` : hit.label;

  const widest = Math.max(
    measureChartText(displayLabel, 11, '600'),
    delta ? measureChartText(`vs target  ${delta}`, 10, '600') + 14 : 0,
    ...hit.entries.map((e) => measureChartText(`${e.name}  ${e.text}`, 11) + SWATCH + 8)
  );
  const width = Math.min(node.width - 8, Math.max(110, widest + PAD * 2));
  const height = PAD * 2 + ROW * (hit.entries.length + (displayLabel ? 1 : 0) + (delta ? 1 : 0));

  const at = placeReadout(hit.anchor, { width, height }, { width: node.width, height: node.height });
  const plate = canvasPlateFill(ThemeService.isDarkMode());

  return (
    <Group x={at.x} y={at.y} listening={false} name={EXPORT_CHROME}>
      <Rect
        width={width}
        height={height}
        cornerRadius={6}
        fill={plate}
        // A hairline as well as a shadow: over a dark heatmap cell the plate
        // and the surface behind it are near enough in value that the shadow
        // alone does not separate them, and the readout melts into the chart.
        stroke={ink.chrome}
        strokeWidth={0.5}
        shadowColor="rgba(0,0,0,0.28)"
        shadowBlur={12}
        shadowOffsetY={3}
        perfectDrawEnabled={false}
      />
      {displayLabel && (
        <Text
          text={displayLabel}
          x={PAD}
          y={PAD}
          width={width - PAD * 2}
          fontSize={11}
          fontStyle="600"
          // A found feature is worth saying loudly -- being exactly on a root
          // is different from being near one -- and the colour is a role now
          // rather than an amber literal that could not follow the theme.
          fill={feature ? ink.feature : ink.ink}
        />
      )}
      {hit.entries.map((e, i) => {
        const y = PAD + (displayLabel ? ROW : 0) + i * ROW;
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
              // Monospaced, so a column of values does not jump sideways as the
              // pointer moves between `1.2` and `11.87` -- which is most of
              // what makes a readout hard to read while it is moving.
              fontFamily={HUD_NUMERIC_FONT}
              fill={ink.ink}
            />
          </React.Fragment>
        );
      })}
      {delta && (
        <Group y={PAD + (displayLabel ? ROW : 0) + hit.entries.length * ROW + 2}>
          {/*
            Direction, not a verdict.

            This was a green pill when the delta was positive and a red one
            when it was negative — which asserts that above target is good.
            For a revenue target it is; for a cost, a latency budget, an error
            rate or a headcount cap it is exactly backwards, and the chart has
            no way to know which it is looking at. Colouring it anyway is the
            interface inventing a judgement and then stating it confidently.

            So the sign is said in the number, an arrow says which way, and the
            emphasis is the reference line's own colour — the thing the delta
            is measured against, which is the one association that is always
            true.
          */}
          <Text
            text="vs target"
            x={PAD}
            y={1}
            fontSize={10}
            fill={ink.chrome}
          />
          <Text
            text={`${delta.startsWith('-') ? '▼' : '▲'} ${delta}`}
            x={PAD}
            y={1}
            width={width - PAD * 2}
            align="right"
            fontSize={10}
            fontStyle="600"
            fontFamily={HUD_NUMERIC_FONT}
            fill={ink.derived}
          />
        </Group>
      )}
    </Group>
  );
};

/**
 * The face numbers in the readout are set in.
 *
 * A stack rather than one name, because Konva hands this straight to the 2D
 * context and an unavailable family falls back to the browser's default
 * proportional face — which is the failure this is here to avoid.
 */
const HUD_NUMERIC_FONT =
  'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

/**
 * Category column highlight band behind bars when hovered.
 */
const CategoryBand: React.FC<{ hit: ChartHit | null; layout: ChartLayout }> = ({ hit, layout }) => {
  if (hit?.categoryIndex === undefined) return null;
  const bars = layout.bars.filter((b) => b.categoryIndex === hit.categoryIndex);
  if (bars.length === 0) return null;

  const isHorizontal = layout.plot.height > 0 && bars[0].height < bars[0].width;
  if (isHorizontal) {
    const minY = Math.min(...bars.map((b) => b.y)) - 2;
    const maxY = Math.max(...bars.map((b) => b.y + b.height)) + 2;
    return (
      <Rect
        x={layout.plot.x}
        y={minY}
        width={layout.plot.width}
        height={maxY - minY}
        fill="rgba(128, 128, 128, 0.08)"
        cornerRadius={4}
        listening={false}
        perfectDrawEnabled={false}
      />
    );
  }

  const minX = Math.min(...bars.map((b) => b.x)) - 3;
  const maxX = Math.max(...bars.map((b) => b.x + b.width)) + 3;
  return (
    <Rect
      x={minX}
      y={layout.plot.y}
      width={maxX - minX}
      height={layout.plot.height}
      fill="rgba(128, 128, 128, 0.08)"
      cornerRadius={4}
      listening={false}
      perfectDrawEnabled={false}
    />
  );
};

/**
 * Tolerance Corridor / Band behind marks.
 */
const ToleranceBand: React.FC<{ layout: ChartLayout }> = ({ layout }) => {
  const tb = layout.toleranceBand;
  if (!tb) return null;
  const bandHeight = Math.max(1, tb.y2 - tb.y1);
  const color = tb.color ?? '#10B981';
  return (
    <Group listening={false}>
      <Rect
        x={layout.plot.x}
        y={tb.y1}
        width={layout.plot.width}
        height={bandHeight}
        fill={color}
        opacity={0.12}
        perfectDrawEnabled={false}
      />
      <Line
        points={[layout.plot.x, tb.y1, layout.plot.x + layout.plot.width, tb.y1]}
        stroke={color}
        strokeWidth={1}
        dash={[3, 3]}
        opacity={0.6}
        perfectDrawEnabled={false}
      />
      <Line
        points={[layout.plot.x, tb.y2, layout.plot.x + layout.plot.width, tb.y2]}
        stroke={color}
        strokeWidth={1}
        dash={[3, 3]}
        opacity={0.6}
        perfectDrawEnabled={false}
      />
      {tb.label && (
        <Text
          text={tb.label}
          x={layout.plot.x + 6}
          y={tb.y1 + 4}
          width={layout.plot.width}
          fontSize={9}
          fontStyle="600"
          fill={color}
          listening={false}
        />
      )}
    </Group>
  );
};

/**
 * Live Math HUD: crosshair rays, tangent line segment, tracer bead, and root/extremum badges.
 */
const MathHUD: React.FC<{ hit: ChartHit | null; ink: ChartInk }> = ({ hit, ink }) => {
  const trace = hit?.mathTrace;
  if (!trace) return null;

  const feature = trace.snappedFeature;
  const badgeColor =
    feature?.kind === 'root' || (feature?.kind as string) === 'pole'
      ? '#F59E0B'
      : feature?.kind === 'extremum' || (feature?.kind as string) === 'cusp'
        ? '#F97316'
        : (feature?.kind as string) === 'tangent'
          ? '#10B981'
          : feature?.kind === 'intersection'
            ? '#06B6D4'
            : '#A855F7';

  const badgeText = feature?.badgeText || feature?.label || '';
  const badgeW = Math.max(68, measureChartText(badgeText, 9, '600') + 16);
  const badgeX = trace.screenPoint.x - badgeW / 2;
  const badgeY =
    trace.screenPoint.y - 28 < 16 ? trace.screenPoint.y + 12 : trace.screenPoint.y - 28;

  const beadColor = feature ? badgeColor : trace.curveColor || '#06B6D4';

  return (
    <Group listening={false} name={EXPORT_CHROME}>
      {/* Polar origin / pole marker */}
      {trace.polarRadius !== undefined && trace.crosshair.xRay[0] && (
        <Circle
          x={trace.crosshair.xRay[0].x}
          y={trace.crosshair.xRay[0].y}
          radius={3.5}
          stroke={ink.chrome}
          strokeWidth={1.5}
          fill="transparent"
          perfectDrawEnabled={false}
        />
      )}

      {/* Vertical crosshair ray (or polar radial ray) */}
      <Line
        points={[
          trace.crosshair.xRay[0].x,
          trace.crosshair.xRay[0].y,
          trace.crosshair.xRay[1].x,
          trace.crosshair.xRay[1].y,
        ]}
        stroke={trace.polarRadius !== undefined ? '#8B5CF6' : ink.chrome}
        strokeWidth={trace.polarRadius !== undefined ? 1.5 : 1}
        dash={trace.polarRadius !== undefined ? [4, 3] : [3, 3]}
        opacity={trace.polarRadius !== undefined ? 0.8 : 0.55}
        perfectDrawEnabled={false}
      />
      {/* Horizontal crosshair ray */}
      <Line
        points={[
          trace.crosshair.yRay[0].x,
          trace.crosshair.yRay[0].y,
          trace.crosshair.yRay[1].x,
          trace.crosshair.yRay[1].y,
        ]}
        stroke={ink.chrome}
        strokeWidth={1}
        dash={[3, 3]}
        opacity={0.55}
        perfectDrawEnabled={false}
      />

      {/* Tangent line segment */}
      {trace.tangentSegment && (
        <Line
          points={[
            trace.tangentSegment[0].x,
            trace.tangentSegment[0].y,
            trace.tangentSegment[1].x,
            trace.tangentSegment[1].y,
          ]}
          stroke="#06B6D4"
          strokeWidth={1.5}
          dash={[4, 4]}
          opacity={0.85}
          perfectDrawEnabled={false}
        />
      )}

      {/* Field directional needle for slope / vector fields */}
      {trace.fieldVector && (
        <>
          <Line
            points={[
              trace.fieldVector.segment[0].x,
              trace.fieldVector.segment[0].y,
              trace.fieldVector.segment[1].x,
              trace.fieldVector.segment[1].y,
            ]}
            stroke="#06B6D4"
            strokeWidth={2}
            perfectDrawEnabled={false}
          />
          <Circle
            x={trace.fieldVector.segment[1].x}
            y={trace.fieldVector.segment[1].y}
            radius={2.5}
            fill="#06B6D4"
            perfectDrawEnabled={false}
          />
        </>
      )}

      {/* Tracer bead halo & bead */}
      <Circle
        x={trace.screenPoint.x}
        y={trace.screenPoint.y}
        radius={7}
        fill={feature ? `${badgeColor}33` : 'rgba(6, 182, 212, 0.25)'}
        perfectDrawEnabled={false}
      />
      <Circle
        x={trace.screenPoint.x}
        y={trace.screenPoint.y}
        radius={3.5}
        fill={beadColor}
        stroke="#FFFFFF"
        strokeWidth={1.5}
        perfectDrawEnabled={false}
      />

      {/* Snapped feature ring & badge */}
      {feature && (
        <>
          <Circle
            x={trace.screenPoint.x}
            y={trace.screenPoint.y}
            radius={11}
            stroke={badgeColor}
            strokeWidth={1.5}
            dash={[3, 2]}
            perfectDrawEnabled={false}
          />
          <Rect
            x={badgeX}
            y={badgeY}
            width={badgeW}
            height={18}
            cornerRadius={4}
            fill="#1E293B"
            stroke={badgeColor}
            strokeWidth={1}
            shadowColor="rgba(0,0,0,0.3)"
            shadowBlur={6}
            shadowOffsetY={2}
            perfectDrawEnabled={false}
          />
          <Text
            text={badgeText}
            x={badgeX}
            y={badgeY + 4}
            width={badgeW}
            align="center"
            fontSize={9}
            fontStyle="600"
            fill={badgeColor}
          />
        </>
      )}
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
        dash={r.dashed ? [5, 4] : undefined}
        listening={false}
        perfectDrawEnabled={false}
      />
      {r.label && (
        <Group listening={false}>
          <Rect
            x={r.label.x - 4}
            y={r.label.y - 2}
            width={r.label.width + 8}
            height={r.label.fontSize + 4}
            cornerRadius={3}
            fill="rgba(15, 23, 42, 0.65)"
            stroke={r.color}
            strokeWidth={0.8}
            perfectDrawEnabled={false}
          />
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
        </Group>
      )}
    </>
  );
};

/**
 * The pointer, cast onto the plot.
 *
 * ## Why this was the missing half
 *
 * A bar chart answered the pointer by lighting its category band, and every
 * *continuous* kind answered with nothing at all: a plate of numbers appeared
 * beside the cursor and nothing on the chart said which x it had been read
 * at. On a line of forty readings, or anywhere on a plot, that gap is the
 * difference between a readout you trust and one you have to check.
 *
 * ## One line or two
 *
 * A cartesian chart gets the vertical only. Its readout is about a *column* --
 * every series at one x -- so a horizontal line would point at a y that
 * belongs to only one of the values listed, and would imply the reading was
 * about that one.
 *
 * A two-variable plot gets both, because there the reading genuinely is about
 * a point: `F(x, y)` at one place on the plane, and both coordinates are in
 * the readout.
 *
 * ## Weight
 *
 * Its own quiet ink, below the marks in z-order and dashed. At the gridlines'
 * weight it reads as another gridline; solid and dark it competes with the
 * data it exists to help you read.
 */
const Crosshair: React.FC<{
  hit: ChartHit | null;
  layout: ChartLayout;
  ink: ChartInk;
  /** Both axes, for the plots whose reading is a point rather than a column. */
  bothAxes: boolean;
}> = ({ hit, layout, ink, bothAxes }) => {
  if (!hit) return null;
  const plot = layout.plot;
  const { x, y } = hit.anchor;
  // Outside the drawing area the hairline would run over the axis labels,
  // which is where the pointer is when it has left the data behind.
  if (x < plot.x || x > plot.x + plot.width) return null;

  return (
    <Group listening={false} name={EXPORT_CHROME}>
      <Line
        points={[x, plot.y, x, plot.y + plot.height]}
        stroke={ink.crosshair}
        strokeWidth={1}
        dash={[3, 3]}
        perfectDrawEnabled={false}
      />
      {bothAxes && y >= plot.y && y <= plot.y + plot.height && (
        <Line
          points={[plot.x, y, plot.x + plot.width, y]}
          stroke={ink.crosshair}
          strokeWidth={1}
          dash={[3, 3]}
          perfectDrawEnabled={false}
        />
      )}
    </Group>
  );
};

/**
 * How present a run is, given which series the pointer is reading.
 *
 * Nothing hovered leaves every run at full strength; hovering one pushes the
 * others back far enough to read past without hiding them -- a chart where
 * the unfocused series vanish is one that answers a different question every
 * time the pointer moves.
 */
function runFocus(hovered: number | undefined, seriesIndex: number): number {
  if (hovered === undefined) return 1;
  return hovered === seriesIndex ? 1 : 0.28;
}

const Marks: React.FC<{
  layout: ChartLayout;
  sketch: SketchLevel | undefined;
  seed: number;
  ink: ChartInk;
  hoveredCategoryIndex?: number;
  /**
   * Which series the readout is about, when it is about one.
   *
   * Bars, dots and slices already dimmed their neighbours on hover; runs and
   * areas did not, so a chart of six lines gave no indication at all which of
   * the six the numbers beside the pointer belonged to. That is the case
   * where the feedback matters most, because six lines is exactly when you
   * cannot tell by looking.
   */
  hoveredSeriesIndex?: number;
  areaOpacity?: number;
}> = ({ layout, sketch, seed, ink, hoveredCategoryIndex, hoveredSeriesIndex, areaOpacity }) => (
  <>
    {layout.bars.map((b, i) => {
      const isDimmed = hoveredCategoryIndex !== undefined && b.categoryIndex !== hoveredCategoryIndex;
      const cornerR =
        b.cornerRadius !== undefined
          ? Math.min(b.cornerRadius, Math.min(b.width, b.height) / 2)
          : (b.rounded ?? true)
          ? Math.min(3, b.width / 6)
          : 0;
      return sketch ? (
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
          opacity={isDimmed ? 0.32 : 0.92}
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
          cornerRadius={cornerR}
          opacity={isDimmed ? 0.32 : 1}
          listening={false}
          perfectDrawEnabled={false}
        />
      );
    })}

    {layout.areas.map((a, i) => (
      <Line
        key={`a${i}`}
        points={flatten(a.polygon)}
        closed
        fill={a.gradient ? undefined : a.color}
        fillLinearGradientStartPoint={a.gradient ? { x: 0, y: layout.plot.y } : undefined}
        fillLinearGradientEndPoint={
          a.gradient ? { x: 0, y: layout.baseline?.y1 ?? (layout.plot.y + layout.plot.height) } : undefined
        }
        fillLinearGradientColorStops={a.gradient ? [0, a.color, 1, 'rgba(0,0,0,0.02)'] : undefined}
        // One expression, because two `opacity` props on one element is the
        // second silently winning.
        opacity={
          (a.gradient ? 0.45 : (areaOpacity ?? 0.22)) *
          (hoveredSeriesIndex !== undefined && a.seriesIndex !== hoveredSeriesIndex ? 0.4 : 1)
        }
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
          strokeWidth={r.width ?? 2.5}
          opacity={runFocus(hoveredSeriesIndex, r.seriesIndex)}
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
          // The focused run also thickens slightly. Opacity alone is not
          // enough to pick one line out of six that cross each other -- the
          // eye follows weight before it follows value.
          strokeWidth={
            (r.width ?? 2.5) * (hoveredSeriesIndex === r.seriesIndex ? 1.35 : 1)
          }
          opacity={runFocus(hoveredSeriesIndex, r.seriesIndex)}
          dash={r.style === 'dashed' ? [6, 4] : r.style === 'dotted' ? [2, 3] : undefined}
          lineCap="round"
          lineJoin="round"
          listening={false}
          perfectDrawEnabled={false}
        />
      )
    )}

    {layout.dots.map((d, i) => {
      const isDimmed = hoveredCategoryIndex !== undefined && d.categoryIndex !== hoveredCategoryIndex;
      const isFocused = hoveredCategoryIndex !== undefined && d.categoryIndex === hoveredCategoryIndex;
      const r = isFocused ? d.radius * 1.35 : d.radius;
      if (d.shape === 'ring' || d.shape === 'hollow') {
        return (
          <Circle
            key={`d${i}`}
            x={d.x}
            y={d.y}
            radius={r}
            fill="transparent"
            stroke={d.color}
            strokeWidth={2}
            opacity={isDimmed ? 0.32 : 1}
            listening={false}
            perfectDrawEnabled={false}
          />
        );
      }
      if (d.shape === 'square') {
        return (
          <Rect
            key={`d${i}`}
            x={d.x - r}
            y={d.y - r}
            width={r * 2}
            height={r * 2}
            fill={d.color}
            opacity={isDimmed ? 0.32 : 1}
            listening={false}
            perfectDrawEnabled={false}
          />
        );
      }
      return (
        <Circle
          key={`d${i}`}
          x={d.x}
          y={d.y}
          radius={r}
          fill={d.color}
          opacity={isDimmed ? 0.32 : 1}
          listening={false}
          perfectDrawEnabled={false}
        />
      );
    })}

    {layout.slices.map((s, i) => {
      const isDimmed = hoveredCategoryIndex !== undefined && s.index !== hoveredCategoryIndex;
      return (
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
          opacity={isDimmed ? 0.32 : 1}
          listening={false}
          perfectDrawEnabled={false}
        />
      );
    })}

    {/* Waterfall horizontal dashed connector bridges */}
    {layout.waterfallBridges?.map((b, i) => (
      <Line
        key={`wb${i}`}
        points={[b.x1, b.y1, b.x2, b.y2]}
        stroke={ink.chrome}
        strokeWidth={1.2}
        dash={[3, 3]}
        opacity={0.65}
        listening={false}
        perfectDrawEnabled={false}
      />
    ))}

    {/* Funnel connecting trapezoidal hulls between stages */}
    {layout.funnelHulls?.map((h, i) => (
      <Line
        key={`fh${i}`}
        points={flatten(h.polygon)}
        closed
        fill="rgba(59, 130, 246, 0.08)"
        stroke="rgba(59, 130, 246, 0.2)"
        strokeWidth={1}
        dash={[4, 4]}
        listening={false}
        perfectDrawEnabled={false}
      />
    ))}

    {/* Scatter / Bubble Linear Regression Trendline */}
    {layout.trendline && (
      <Group listening={false} name={EXPORT_CHROME}>
        <Line
          points={[
            layout.trendline.line[0].x,
            layout.trendline.line[0].y,
            layout.trendline.line[1].x,
            layout.trendline.line[1].y,
          ]}
          stroke="#F59E0B"
          strokeWidth={1.8}
          dash={[6, 4]}
          opacity={0.9}
          perfectDrawEnabled={false}
        />
        <Rect
          x={layout.trendline.line[1].x - 65}
          y={layout.trendline.line[1].y - 18}
          width={60}
          height={16}
          cornerRadius={3}
          fill="rgba(15, 23, 42, 0.75)"
          stroke="#F59E0B"
          strokeWidth={0.8}
          perfectDrawEnabled={false}
        />
        <Text
          text={layout.trendline.label}
          x={layout.trendline.line[1].x - 65}
          y={layout.trendline.line[1].y - 16}
          width={60}
          align="center"
          fontSize={10}
          fontStyle="600"
          fill="#F59E0B"
          perfectDrawEnabled={false}
        />
      </Group>
    )}

    {/* Histogram Gaussian KDE curve */}
    {layout.kdeCurve && (
      <Line
        points={flatten(layout.kdeCurve)}
        stroke="#06B6D4"
        strokeWidth={2.2}
        opacity={0.9}
        listening={false}
        perfectDrawEnabled={false}
      />
    )}

    {/* Field RK4 Streamlines and seed handles */}
    {layout.streamlines?.map((sl, i) => (
      <React.Fragment key={`sl${i}`}>
        <Line
          points={flatten(sl.points)}
          stroke="#38BDF8"
          strokeWidth={1.8}
          opacity={0.85}
          listening={false}
          perfectDrawEnabled={false}
        />
        <Circle
          x={sl.seed.x}
          y={sl.seed.y}
          radius={4}
          fill="#F59E0B"
          stroke="#FFFFFF"
          strokeWidth={1.5}
          shadowColor="rgba(245, 158, 11, 0.6)"
          shadowBlur={6}
          listening={false}
          perfectDrawEnabled={false}
        />
      </React.Fragment>
    ))}

    {/* Donut central metric display */}
    {layout.donutMetric && (
      <Group listening={false} name={EXPORT_CHROME}>
        <Circle
          x={layout.donutMetric.x}
          y={layout.donutMetric.y}
          radius={Math.min(36, layout.plot.width * 0.16)}
          fill="rgba(15, 23, 42, 0.65)"
          stroke="rgba(255, 255, 255, 0.1)"
          strokeWidth={1}
          perfectDrawEnabled={false}
        />
        <Text
          text={layout.donutMetric.label}
          x={layout.donutMetric.x - 40}
          y={layout.donutMetric.y - 15}
          width={80}
          align="center"
          fontSize={9}
          fontStyle="600"
          fill={ink.chrome}
          perfectDrawEnabled={false}
        />
        <Text
          text={layout.donutMetric.value}
          x={layout.donutMetric.x - 45}
          y={layout.donutMetric.y - 2}
          width={90}
          align="center"
          fontSize={12}
          fontStyle="700"
          fill={ink.ink}
          perfectDrawEnabled={false}
        />
      </Group>
    )}
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

    {layout.subtitle && (
      <Text
        text={layout.subtitle.text}
        x={layout.subtitle.x}
        y={layout.subtitle.y}
        width={layout.subtitle.width}
        fontSize={layout.subtitle.fontSize}
        fill={ink.chrome}
        listening={false}
      />
    )}

    {layout.footnote && (
      <Text
        text={layout.footnote.text}
        x={layout.footnote.x}
        y={layout.footnote.y}
        width={layout.footnote.width}
        fontSize={layout.footnote.fontSize}
        fill={ink.chrome}
        listening={false}
      />
    )}

    {layout.xAxisTitle && (
      <Text
        text={layout.xAxisTitle.text}
        x={layout.xAxisTitle.x - layout.xAxisTitle.width / 2}
        y={layout.xAxisTitle.y}
        width={layout.xAxisTitle.width}
        align={layout.xAxisTitle.align}
        fontSize={layout.xAxisTitle.fontSize}
        fontStyle="600"
        fill={ink.chrome}
        listening={false}
      />
    )}

    {layout.yAxisTitle && (
      <Text
        text={layout.yAxisTitle.text}
        x={layout.yAxisTitle.x}
        y={layout.yAxisTitle.y}
        rotation={-90}
        fontSize={layout.yAxisTitle.fontSize}
        fontStyle="600"
        fill={ink.chrome}
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

    {/* The colour scale. Same stops, same ticks, same way up as the export. */}
    {layout.colorBar && (
      <>
        <Rect
          x={layout.colorBar.x}
          y={layout.colorBar.y}
          width={layout.colorBar.width}
          height={layout.colorBar.height}
          cornerRadius={2}
          stroke={ink.chrome}
          strokeWidth={0.5}
          // Bottom to top, so offset zero is the low end of the ramp.
          fillLinearGradientStartPoint={{ x: 0, y: layout.colorBar.y + layout.colorBar.height }}
          fillLinearGradientEndPoint={{ x: 0, y: layout.colorBar.y }}
          fillLinearGradientColorStops={layout.colorBar.stops.flatMap((stop) => [
            stop.offset,
            stop.color,
          ])}
          listening={false}
        />
        {layout.colorBar.ticks.map((tick, i) => (
          <Text
            key={`cb${i}`}
            text={tick.text}
            x={layout.colorBar!.textX}
            y={tick.y - layout.colorBar!.fontSize}
            fontSize={layout.colorBar!.fontSize}
            fill={ink.ink}
            listening={false}
          />
        ))}
      </>
    )}

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

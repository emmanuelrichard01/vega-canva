import React from 'react';
import { Ellipse, Group, Line, Path, Rect, Text } from 'react-konva';
import type { GridNode } from '../../../engine/model/schema';
import { gridCellsOf } from '../../../engine/grid/gridNode';
import { roundPolygon } from '../../../engine/grid/gridLayout';
import { cellGeometry } from '../../../engine/grid/gridBuild';
import { shapeOutline } from '../../../engine/model/shapeOutline';
import { contourData } from '../../../engine/model/pathGeometry';
import {
  cellLabel,
  cellPaint,
  labelInk,
  LABEL_INSET,
  LABEL_SIZE,
  type GridStyle,
  type StyledCell,
} from '../../../engine/grid/gridStyle';

/**
 * A grid, drawn from its recipe.
 *
 * ## Why this does not reuse `ShapeRenderer`
 *
 * It would be the obvious move — a grid is n shapes, and there is a component
 * that draws a shape. But `ShapeRenderer` carries the full appearance stack:
 * gradient fills resolved through a hook, aligned strokes drawn as a clipped
 * second copy, backdrop blur, inner shadow, spread shadow, sketch rendering, a
 * label. Mounting forty of those is forty subscriptions and several hundred
 * Konva nodes for an object that has one fill, one stroke width and no text.
 *
 * A grid's modules are also deliberately *uniform*: they share a stroke, an
 * opacity and a shape set by definition, because that is what makes them a grid
 * rather than forty shapes that happen to be near each other. Per-cell
 * appearance is not a feature this type withholds, it is the feature it trades
 * away — and `explodeGrid` is how you buy it back.
 *
 * The geometry still comes from `shapeOutline`, which is what the shape
 * renderer, the exporter and the panel swatches all draw from, so a hexagon
 * module is the same hexagon everywhere.
 */

interface Props {
  node: GridNode;
}

/** One module. Split out so React can key it and skip the untouched ones. */
const Cell: React.FC<{ cell: StyledCell; style: GridStyle }> = ({ cell, style }) => {
  // Resolved in `gridStyle`, which is also what the SVG exporter asks. The
  // branch used to live here *and* there, in two copies that shared three
  // colour literals and nothing else.
  const resolved = cellPaint(cell, style);

  const paint = {
    fill: resolved.fill,
    stroke: resolved.strokeWidth > 0 ? resolved.stroke : undefined,
    strokeWidth: resolved.strokeWidth > 0 ? resolved.strokeWidth : undefined,
    // No module is its own hit target -- the backdrop below takes every click,
    // so the grid answers as one object -- and skipping the hit graph for forty
    // shapes is most of what makes a dense grid cheap to draw.
    listening: false,
    perfectDrawEnabled: false,
  };

  /**
   * A cell that knows its own silhouette draws that, and the shape picker does
   * not apply to it.
   *
   * The mapping below answers "which of the six module shapes is this", and a
   * ring sector is none of them: it is a shape the *arrangement* produced.
   * Rounding is applied to the polygon rather than handed to a primitive,
   * because there is no primitive to hand it to -- the fillet is geometry, cut
   * by the layout's own rounder, so the canvas, the SVG export and the panel
   * swatch curve identically.
   */
  if (cell.outline) {
    return (
      <Line
        x={cell.x}
        y={cell.y}
        points={roundPolygon(cell.outline, cell.radius).flatMap((p) => [p.x, p.y])}
        closed
        {...paint}
      />
    );
  }

  const geo = cellGeometry(cell);
  const outline = shapeOutline({
    geometry: geo as never,
    width: cell.width,
    height: cell.height,
    appearance: { cornerRadius: cell.radius },
  });

  switch (outline.kind) {
    case 'rect':
      return <Rect x={cell.x} y={cell.y} width={outline.width} height={outline.height} cornerRadius={outline.radius} {...paint} />;
    case 'ellipse':
      return <Ellipse x={cell.x + outline.cx} y={cell.y + outline.cy} radiusX={outline.rx} radiusY={outline.ry} {...paint} />;
    case 'polygon':
      return (
        <Line
          x={cell.x}
          y={cell.y}
          points={outline.points.flatMap((p) => [p.x, p.y])}
          closed
          {...paint}
        />
      );
    case 'bezier':
      return <Path x={cell.x} y={cell.y} data={contourData(outline.geometry)} {...paint} />;
    default:
      return null;
  }
};

export const GridRenderer: React.FC<Props> = React.memo(({ node }) => {
  const { width, height, grid } = node;

  /**
   * Laid out once per change, not once per frame.
   *
   * A drag re-renders this component on every pointer move; without the memo
   * that is a full `layoutGrid` — seeded shuffles, per-column scaling, the lot —
   * forty times a second to produce an identical answer, because a move does
   * not change the box's *size* and the layout does not depend on where the box
   * is. The three values destructured above are exactly what it reads, which is
   * why they are the dependency list and why `x`/`y` are not in it.
   */
  const cells = React.useMemo(
    () => gridCellsOf({ width, height, grid }),
    [width, height, grid]
  );

  const { opacity } = grid.style;

  return (
    <Group opacity={opacity}>
      {/**
       * The grid's hit area is its **box**, not its modules.
       *
       * Hit-testing the modules themselves would be the strict reading -- you
       * cannot grab a rectangle by its transparent corner anywhere else on this
       * canvas -- and it is the wrong call here. A grid is a scaffold you
       * reposition constantly, its gutters are by design most of its surface at
       * low density, and a scaffold you have to aim at is a scaffold you fight.
       * Frames and sections work this way in every tool that has them, for the
       * same reason.
       *
       * The cost is that the gutters shadow whatever sits directly beneath the
       * grid in the stack. Z-order still decides, so anything placed *on* the
       * grid stays reachable, which is the case that actually comes up.
       */}
      <Rect
        x={0}
        y={0}
        width={width}
        height={height}
        // Not `fill="transparent"`: Konva hit-tests the drawn pixels, and a
        // shape with no fill at all has none to test. An alpha-zero fill draws
        // nothing and is hit everywhere.
        fill="rgba(0,0,0,0)"
        perfectDrawEnabled={false}
      />
      {cells.map((cell) => (
        <Cell key={cell.index} cell={cell} style={grid.style} />
      ))}
      {/*
        Labels last, so they sit over every module rather than under the ones
        drawn after them. Which cells get named -- and what they are named --
        is `cellLabel`'s answer, shared with the exporter.
      */}
      {grid.style.showLabels &&
        cells.map((cell) => {
          const label = cellLabel(cell);
          if (label === null) return null;
          return (
            <Text
              key={`lbl-${cell.index}`}
              x={cell.x + LABEL_INSET}
              y={cell.y + LABEL_INSET}
              text={label}
              fontSize={LABEL_SIZE}
              fontFamily="Inter, sans-serif"
              fontStyle="600"
              fill={labelInk(grid.style)}
              opacity={0.85}
              listening={false}
              perfectDrawEnabled={false}
            />
          );
        })}
    </Group>
  );
});

GridRenderer.displayName = 'GridRenderer';

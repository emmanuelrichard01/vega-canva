import React from 'react';
import { GridDropHighlight, GridEditOverlay, useGridEditEntry } from './GridEditOverlay';
import { useGridEditMode, useSelectionMirror, useTrackPreview } from '../../../engine/grid/gridEditMode';
import { useStore } from '../../../hooks/useStore';
import { ThemeService } from '../../../engine/ThemeService';
import { Ellipse, Group, Line, Path, Rect, Text } from 'react-konva';
import { useCameraZoom } from '../../../engine/useCameraZoom';
import type Konva from 'konva';
import { cellIndexAt } from '../../../engine/grid/gridSlot';
import { isCellFree } from '../../../engine/grid/gridSlotApply';
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
  // A track border being dragged in Edit cells re-lays the grid live, from a
  // preview that is never written until the pointer lets go.
  const preview = useTrackPreview(node.id);
  const width = preview?.width ?? node.width;
  const height = preview?.height ?? node.height;
  const grid = preview?.grid ?? node.grid;

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
  const editing = useGridEditMode().gridId === node.id;
  const enterEditMode = useGridEditEntry(node);
  /**
   * One double-click, one meaning per spot. On an empty module it types into
   * that module: `ObjectRenderer` creates a text object adopted into the slot,
   * exactly what dropping one there would make (see `addTextToCell`). Anywhere
   * else on the grid (a gutter, the margin, a module that already holds
   * something) it opens Edit cells. It used to do both at once on an empty
   * module: open the cell editor and a caption, then close the editor again
   * when the caption took the selection.
   */
  const enterEdit = React.useCallback(
    (e?: Konva.KonvaEventObject<Event>) => {
      const local = e?.target?.getRelativePointerPosition?.();
      const cell = local ? cellIndexAt(cells, local) : null;
      if (cell !== null && isCellFree(node.id, cell)) return;
      enterEditMode();
    },
    [cells, node.id, enterEditMode]
  );

  return (
    <>
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
        onDblClick={enterEdit}
        onDblTap={enterEdit}
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
    {/* Chrome sits outside the opacity group so it reads at full strength. */}
    <GridDropHighlight node={node} cells={cells} />
    {!editing && <SelectedSlotOutline gridId={node.id} cells={cells} />}
    {editing && <GridEditOverlay node={node} cells={cells} />}
    </>
  );
});

GridRenderer.displayName = 'GridRenderer';

/**
 * The module that holds a selected object, outlined.
 *
 * Text in a cell is a real text object adopted into that module, and its
 * selection box is exactly the module's box, so on its own a selected caption
 * and a picked module look the same. This draws the module as a quiet dashed
 * frame *outside* the object's selection box, which reads as "this object,
 * sitting in this cell" -- while a picked module in Edit cells is a tinted
 * fill with headers lit, which reads as "this cell". Neutral ink, never the
 * accent: it is context, not a second selection.
 */
const SelectedSlotOutline: React.FC<{ gridId: string; cells: readonly StyledCell[] }> = ({ gridId, cells }) => {
  const selected = useSelectionMirror();
  // A string, so the outline re-renders when the answer changes, not on every edit.
  const key = useStore((st) =>
    selected
      .map((id) => (st.objects[id] as { gridSlot?: { gridId: string; cell: number } } | undefined)?.gridSlot)
      .filter((slot) => slot?.gridId === gridId)
      .map((slot) => slot!.cell)
      .join(',')
  );
  useStore((st) => st.darkTheme);
  const zoom = useCameraZoom();
  if (key === '') return null;
  const held = new Set(key.split(',').map(Number));
  // Clear of the selection handles, so it reads as a second, outer frame.
  const pad = 9 / zoom;
  const ink = ThemeService.isDarkMode() ? 'rgba(250, 250, 250, 0.6)' : 'rgba(17, 24, 39, 0.5)';
  return (
    <>
      {cells
        .filter((c) => held.has(c.index))
        .map((c) => (
          <Rect
            key={`slot-${c.index}`}
            x={c.x - pad}
            y={c.y - pad}
            width={c.width + pad * 2}
            height={c.height + pad * 2}
            cornerRadius={c.radius + pad}
            stroke={ink}
            strokeWidth={1 / zoom}
            dash={[4 / zoom, 3 / zoom]}
            listening={false}
            perfectDrawEnabled={false}
          />
        ))}
    </>
  );
};

import React from 'react';
import { Group, Rect, Shape } from 'react-konva';
import type { TableNode } from '../../../engine/model/schema';
import { layoutTable } from '../../../engine/table/tableLayout';
import { paintMeasure } from '../../../engine/table/tableMeasure';
import { ensureTableRegistry, registryVersion, subscribeRegistry } from '../../../engine/table/tableRegistry';
import { hasCrossRefs, hasVolatile } from '../../../engine/table/tableFormula';
import { buildSketch, paintTable, primsCache } from '../../../engine/table/tableCanvas';
import { drawnHeight } from '../../../engine/table/tableApply';
import { effectiveSpec, subscribeViews, viewsVersion } from '../../../engine/table/tableView';
import { subscribeNothing, subscribeVolatile, volatileEpoch } from '../../../engine/table/tableVolatile';
import { seedFor } from '../../../engine/model/rough';
import { useSketchLevel } from '../../../engine/model/roughBoard';

/**
 * A table on the board.
 *
 * ## One shape, not a node per cell
 *
 * A table of a thousand rows and eight columns is eight thousand strings. As
 * Konva `Text` nodes that is eight thousand objects in the scene graph — each
 * with its own hit canvas, cache and transform — and the board stops being
 * interactive long before the table is large. Drawn in one `sceneFunc` it is
 * eight thousand `fillText` calls on a canvas, which is what a canvas is for.
 *
 * What each cell draws comes from the paint plan (`tablePaint.ts`), built the
 * first time the cell is on screen and kept for the layout's life — text
 * fitted, pills placed, stars counted — so a frame only paints, and only the
 * cells the stage can see (`tableCanvas.ts`).
 *
 * The board keeps drawing every cell while the table's editor is open; the
 * editor overlays interaction (selection, the input) and nothing else, so the
 * cells look the same open and closed.
 *
 * ## Whose view
 *
 * The table is drawn through this person's own sort and filter
 * (`tableView.ts`). A filter of theirs hides rows from them alone, so the
 * node keeps the size everyone shares and the drawn table ends where its rows
 * do.
 *
 * ## Sketch
 *
 * The same treatment the chart takes: rules drawn by hand, fills hatched over
 * a wash, text lettered in the sketch face. The cells, their text and their
 * order are the layout's, unchanged.
 */

ensureTableRegistry();

export const TableRenderer: React.FC<{ node: TableNode }> = ({ node }) => {
  // A table whose formulas read another table redraws when that one changes.
  const crossVersion = React.useSyncExternalStore(
    subscribeRegistry,
    () => (hasCrossRefs(node.table) ? registryVersion() : 0),
    () => 0
  );
  // TODAY and NOW: the shared minute timer, only while this table uses them.
  const volatile = hasVolatile(node.table);
  const minute = React.useSyncExternalStore(volatile ? subscribeVolatile : subscribeNothing, volatileEpoch, () => 0);
  const viewVersion = React.useSyncExternalStore(subscribeViews, viewsVersion, () => 0);
  const spec = React.useMemo(
    () => effectiveSpec(node.id, node.table),
    // viewVersion: the person's own view lives outside the node.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [node.id, node.table, viewVersion]
  );
  const height = drawnHeight(node, spec);
  const layout = React.useMemo(
    () => layoutTable(spec, node.width, height),
    // crossVersion and minute: dependencies the table cannot see in its own spec.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spec, node.width, height, crossVersion, minute]
  );
  const sketch = useSketchLevel(node.appearance);
  const seed = React.useMemo(() => seedFor(node.id, node.appearance?.sketchSeed), [node.id, node.appearance?.sketchSeed]);
  const sketchPaths = React.useMemo(
    () => (sketch && typeof Path2D !== 'undefined' ? buildSketch(layout, seed, sketch) : null),
    [layout, seed, sketch]
  );
  const prims = React.useMemo(() => primsCache(layout, paintMeasure(Boolean(sketch)), Boolean(sketch)), [layout, sketch]);

  const draw = React.useCallback(
    (ctx: CanvasRenderingContext2D) => paintTable(ctx, layout, { sketch, sketchPaths, prims }),
    [layout, sketch, sketchPaths, prims]
  );

  return (
    <Group>
      {/* The hit area: the table is one object to select and drag. */}
      <Rect width={node.width} height={node.height} fill="rgba(0,0,0,0)" perfectDrawEnabled={false} />
      <Shape
        listening={false}
        perfectDrawEnabled={false}
        sceneFunc={(context) => draw((context as unknown as { _context: CanvasRenderingContext2D })._context)}
      />
    </Group>
  );
};

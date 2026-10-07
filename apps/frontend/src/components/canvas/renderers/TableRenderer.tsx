import React from 'react';
import { Group, Rect, Shape } from 'react-konva';
import type { TableNode } from '../../../engine/model/schema';
import { layoutTable, type TableLayout } from '../../../engine/table/tableLayout';
import { cellPrims, type Prim } from '../../../engine/table/tablePaint';
import { paintMeasure } from '../../../engine/table/tableMeasure';
import { ensureTableRegistry, registryVersion, subscribeRegistry } from '../../../engine/table/tableRegistry';
import { hasCrossRefs } from '../../../engine/table/tableFormula';
import { roughPolyline, seedFor, type SketchLevel } from '../../../engine/model/rough';
import { hachure, SKETCH_FONT, SKETCH_FONT_SCALE } from '../../../engine/chart/chartSketch';

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
 * What each cell draws comes from the paint plan (`tablePaint.ts`), built once
 * per layout — text fitted, pills placed, stars counted — so a frame only
 * paints, and only the rows the stage can see.
 *
 * The board keeps drawing every cell while the table's editor is open; the
 * editor overlays interaction (selection, the input) and nothing else, so the
 * cells look the same open and closed.
 *
 * ## Sketch
 *
 * The same treatment the chart takes: rules drawn by hand, fills hatched over
 * a wash, text lettered in the sketch face. The cells, their text and their
 * order are the layout's, unchanged.
 */

ensureTableRegistry();

const FONT = 'Inter, system-ui, -apple-system, sans-serif';

interface SketchPaths {
  segments: Array<{ path: Path2D; color: string; width: number }>;
  hatches: Array<Path2D | null>;
  frame: Path2D | null;
}

function buildSketch(layout: TableLayout, seed: number, level: SketchLevel): SketchPaths {
  return {
    segments: layout.segments.map((s, i) => ({
      path: new Path2D(roughPolyline([{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }], { seed: seed + i * 13, level, closed: false })),
      color: s.color,
      width: s.width * 1.2,
    })),
    hatches: layout.cells.map((c, i) =>
      c.fill ? new Path2D(hachure({ x: c.x, y: c.y, width: c.w, height: c.h }, seed + i * 7, 7)) : null
    ),
    frame:
      layout.frame.width > 0
        ? new Path2D(
            roughPolyline(
              [
                { x: 0, y: 0 },
                { x: layout.width, y: 0 },
                { x: layout.width, y: layout.height },
                { x: 0, y: layout.height },
                { x: 0, y: 0 },
              ],
              { seed: seed + 999, level, closed: false }
            )
          )
        : null,
  };
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

const pathCache = new Map<string, Path2D>();
function pathOf(d: string): Path2D {
  let p = pathCache.get(d);
  if (!p) {
    if (pathCache.size > 5000) pathCache.clear();
    p = new Path2D(d);
    pathCache.set(d, p);
  }
  return p;
}

function paint(ctx: CanvasRenderingContext2D, p: Prim, family: string, sketch: boolean) {
  switch (p.t) {
    case 'rect':
      roundRectPath(ctx, p.x, p.y, p.w, p.h, p.r ?? 0);
      if (p.fill) {
        ctx.globalAlpha = p.opacity ?? 1;
        ctx.fillStyle = p.fill;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (p.stroke) {
        ctx.strokeStyle = p.stroke;
        ctx.lineWidth = p.sw ?? 1;
        ctx.stroke();
      }
      return;
    case 'path': {
      const path = pathOf(p.d);
      if (p.fill) {
        ctx.fillStyle = p.fill;
        ctx.fill(path);
      }
      if (p.stroke) {
        ctx.strokeStyle = p.stroke;
        ctx.lineWidth = p.sw ?? 1;
        ctx.lineJoin = 'round';
        ctx.stroke(path);
      }
      return;
    }
    case 'text': {
      ctx.font = `${p.italic ? 'italic ' : ''}${p.bold || sketch ? 600 : 400} ${p.size}px ${family}`;
      ctx.fillStyle = p.fill;
      ctx.textAlign = p.anchor === 'middle' ? 'center' : p.anchor === 'end' ? 'right' : 'left';
      ctx.fillText(p.s, p.x, p.y + 0.5);
      if (p.underline) {
        const w = ctx.measureText(p.s).width;
        const x0 = p.anchor === 'middle' ? p.x - w / 2 : p.anchor === 'end' ? p.x - w : p.x;
        ctx.fillRect(x0, p.y + p.size * 0.52, w, Math.max(0.8, p.size * 0.07));
      }
      return;
    }
  }
}

export const TableRenderer: React.FC<{ node: TableNode }> = ({ node }) => {
  // A table whose formulas read another table redraws when that one changes.
  const crossVersion = React.useSyncExternalStore(
    subscribeRegistry,
    () => (hasCrossRefs(node.table) ? registryVersion() : 0),
    () => 0
  );
  const layout = React.useMemo(
    () => layoutTable(node.table, node.width, node.height),
    // crossVersion: a dependency the table cannot see in its own spec.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [node.table, node.width, node.height, crossVersion]
  );
  const sketch = node.appearance?.sketch;
  const seed = React.useMemo(() => seedFor(node.id, node.appearance?.sketchSeed), [node.id, node.appearance?.sketchSeed]);
  const sketchPaths = React.useMemo(
    () => (sketch && typeof Path2D !== 'undefined' ? buildSketch(layout, seed, sketch) : null),
    [layout, seed, sketch]
  );
  const prims = React.useMemo(() => {
    const measure = paintMeasure(Boolean(sketch));
    const k = sketch ? SKETCH_FONT_SCALE : 1;
    return layout.cells.map((cell) => ({ y: cell.y, h: cell.h, prims: cellPrims(cell, layout, { measure, fontScale: k }) }));
  }, [layout, sketch]);

  const draw = React.useCallback(
    (ctx: CanvasRenderingContext2D) => {
      const { width: w, height: h } = layout;
      const radius = sketch ? 0 : layout.frame.radius;

      ctx.save();
      if (layout.frame.fill !== 'transparent') {
        roundRectPath(ctx, 0, 0, w, h, radius);
        ctx.fillStyle = layout.frame.fill;
        ctx.fill();
      }
      roundRectPath(ctx, 0, 0, w, h, radius);
      ctx.clip();

      // Only the rows the stage can see. The transform maps node space to
      // screen space, so the inverse of the stage's top and bottom edges gives
      // the node-space rows that are visible.
      const m = ctx.getTransform();
      const scaleY = Math.hypot(m.b, m.d) || 1;
      const topY = (-m.f) / scaleY;
      const bottomY = (ctx.canvas.height / (window.devicePixelRatio || 1) - m.f) / scaleY;
      const visible = (y: number, hh: number) => y + hh >= topY - 2 && y <= bottomY + 2;

      layout.cells.forEach((c, i) => {
        if (!c.fill || !visible(c.y, c.h)) return;
        if (sketchPaths) {
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = c.fill;
          ctx.fillRect(c.x, c.y, c.w, c.h);
          ctx.globalAlpha = 0.9;
          const hatch = sketchPaths.hatches[i];
          if (hatch) {
            ctx.strokeStyle = c.fill;
            ctx.lineWidth = 1;
            ctx.stroke(hatch);
          }
          ctx.globalAlpha = 1;
        } else {
          ctx.fillStyle = c.fill;
          ctx.fillRect(c.x, c.y, c.w, c.h);
        }
      });

      ctx.lineCap = 'round';
      if (sketchPaths) {
        for (const s of sketchPaths.segments) {
          ctx.strokeStyle = s.color;
          ctx.lineWidth = s.width;
          ctx.stroke(s.path);
        }
      } else {
        for (const s of layout.segments) {
          if (!visible(Math.min(s.y1, s.y2), Math.abs(s.y2 - s.y1))) continue;
          ctx.strokeStyle = s.color;
          ctx.lineWidth = s.width;
          ctx.beginPath();
          ctx.moveTo(s.x1, s.y1);
          ctx.lineTo(s.x2, s.y2);
          ctx.stroke();
        }
      }

      const family = sketch ? SKETCH_FONT : FONT;
      ctx.textBaseline = 'middle';
      for (const cell of prims) {
        if (!cell.prims.length || !visible(cell.y, cell.h)) continue;
        for (const p of cell.prims) paint(ctx, p, family, Boolean(sketch));
      }
      ctx.restore();

      if (layout.frame.width > 0) {
        ctx.strokeStyle = layout.frame.color;
        if (sketchPaths?.frame) {
          ctx.lineWidth = 1.6;
          ctx.stroke(sketchPaths.frame);
        } else {
          ctx.lineWidth = 1;
          roundRectPath(ctx, 0, 0, w, h, radius);
          ctx.stroke();
        }
      }
    },
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

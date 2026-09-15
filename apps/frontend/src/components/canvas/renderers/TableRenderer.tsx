import React from 'react';
import { Group, Rect, Shape } from 'react-konva';
import type { TableNode } from '../../../engine/model/schema';
import { layoutTable, type TableLayout } from '../../../engine/table/tableLayout';
import { roughPolyline, seedFor, type SketchLevel } from '../../../engine/model/rough';
import { hachure, SKETCH_FONT, SKETCH_FONT_SCALE } from '../../../engine/chart/chartSketch';
import { useStore } from '../../../hooks/useStore';

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
 * Only the cells that fall inside the stage are painted, found from the
 * layout's row height with arithmetic rather than a search — so a long table
 * off to one side costs nothing while you work elsewhere.
 *
 * ## Sketch
 *
 * The same treatment the chart takes: rules drawn by hand, fills hatched over
 * a wash, text lettered in the sketch face. The cells, their text and their
 * order are the layout's, unchanged.
 */

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

/** Text cut to a width with an ellipsis, measured with the real font. */
function fitText(ctx: CanvasRenderingContext2D, text: string, room: number): string {
  if (room <= 4) return '';
  if (ctx.measureText(text).width <= room) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid) + '…').width <= room) lo = mid;
    else hi = mid - 1;
  }
  return lo <= 0 ? '' : `${text.slice(0, lo).trimEnd()}…`;
}

function roundRectPath(ctx: CanvasRenderingContext2D, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(w, 0, w, h, r);
  ctx.arcTo(w, h, 0, h, r);
  ctx.arcTo(0, h, 0, 0, r);
  ctx.arcTo(0, 0, w, 0, r);
  ctx.closePath();
}

export const TableRenderer: React.FC<{ node: TableNode }> = ({ node }) => {
  const layout = React.useMemo(
    () => layoutTable(node.table, node.width, node.height),
    [node.table, node.width, node.height]
  );
  const sketch = node.appearance?.sketch;
  const seed = React.useMemo(() => seedFor(node.id, node.appearance?.sketchSeed), [node.id, node.appearance?.sketchSeed]);
  const sketchPaths = React.useMemo(
    () => (sketch && typeof Path2D !== 'undefined' ? buildSketch(layout, seed, sketch) : null),
    [layout, seed, sketch]
  );
  // While the cells are open on the board the overlay shows them; the
  // canvas copy steps back so the two never draw the same words twice.
  const editing = useStore((s) => s.tableEditNodeId === node.id);

  const draw = React.useCallback(
    (ctx: CanvasRenderingContext2D) => {
      const { width: w, height: h } = layout;
      const radius = sketch ? 0 : layout.frame.radius;

      ctx.save();
      if (layout.frame.fill !== 'transparent') {
        roundRectPath(ctx, w, h, radius);
        ctx.fillStyle = layout.frame.fill;
        ctx.fill();
      }
      roundRectPath(ctx, w, h, radius);
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

      if (!editing) {
        const fs = layout.fontSize * (sketch ? SKETCH_FONT_SCALE : 1);
        const family = sketch ? SKETCH_FONT : FONT;
        ctx.textBaseline = 'middle';
        for (const c of layout.cells) {
          if (!c.text && !c.sort && !c.filtered) continue;
          if (!visible(c.y, c.h)) continue;
          ctx.font = `${c.italic ? 'italic ' : ''}${c.bold || sketch ? 600 : 400} ${fs}px ${family}`;
          ctx.fillStyle = c.color;
          const mark = c.sort || c.filtered ? fs * 0.9 : 0;
          const room = c.w - layout.padX * 2 - mark;
          const text = fitText(ctx, c.text, room);
          const cy = c.y + c.h / 2 + 0.5;
          if (text) {
            if (c.align === 'center') {
              ctx.textAlign = 'center';
              ctx.fillText(text, c.x + c.w / 2, cy);
            } else if (c.align === 'right') {
              ctx.textAlign = 'right';
              ctx.fillText(text, c.x + c.w - layout.padX - mark, cy);
            } else {
              ctx.textAlign = 'left';
              ctx.fillText(text, c.x + layout.padX, cy);
            }
          }
          // The view's state, on the column it applies to: a sort arrow, or
          // a dot for a filter — so a table showing four of forty rows says so.
          if (c.sort) {
            const ax = c.x + c.w - layout.padX - mark / 2;
            const s = fs * 0.28;
            ctx.beginPath();
            if (c.sort === 'asc') {
              ctx.moveTo(ax - s, cy + s * 0.6);
              ctx.lineTo(ax + s, cy + s * 0.6);
              ctx.lineTo(ax, cy - s * 0.8);
            } else {
              ctx.moveTo(ax - s, cy - s * 0.6);
              ctx.lineTo(ax + s, cy - s * 0.6);
              ctx.lineTo(ax, cy + s * 0.8);
            }
            ctx.closePath();
            ctx.fill();
          } else if (c.filtered) {
            ctx.beginPath();
            ctx.arc(c.x + c.w - layout.padX - mark / 2, cy, fs * 0.18, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.restore();

      if (layout.frame.width > 0) {
        ctx.strokeStyle = layout.frame.color;
        if (sketchPaths?.frame) {
          ctx.lineWidth = 1.6;
          ctx.stroke(sketchPaths.frame);
        } else {
          ctx.lineWidth = 1;
          roundRectPath(ctx, w - 0, h - 0, radius);
          ctx.stroke();
        }
      }
    },
    [layout, sketch, sketchPaths, editing]
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

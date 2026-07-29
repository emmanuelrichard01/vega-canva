import { nanoid } from 'nanoid';
import type { Tool, ToolContext } from './Tool';
import * as React from 'react';
import { getStroke } from 'perfect-freehand';
import { Path } from 'react-konva';

function getSvgPathFromStroke(stroke: number[][]) {
  if (!stroke.length) return '';
  const d = stroke.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ['M', ...stroke[0], 'Q']
  );
  d.push('Z');
  return d.join(' ');
}

export class PenTool implements Tool {
  id = 'pen';
  cursor = 'crosshair';

  static currentColor = '#1F2937';
  static currentSize = 6;

  private isDrawing = false;
  private points: {x: number, y: number}[] = [];

  onPointerDown(ctx: ToolContext, e: any) {
    const pos = this.getPointerPos(ctx, e);
    if (!pos) return;
    this.isDrawing = true;
    this.points = [pos];
    ctx.setOverlayState?.({ type: 'pen', points: [...this.points] });
  }

  onPointerMove(ctx: ToolContext, e: any) {
    if (!this.isDrawing) return;
    const pos = this.getPointerPos(ctx, e);
    if (!pos) return;
    this.points.push(pos);
    ctx.setOverlayState?.({ type: 'pen', points: [...this.points] });
  }

  onPointerUp(ctx: ToolContext) {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    ctx.setOverlayState?.(null);

    if (this.points.length >= 2) {
      const strokePoints = getStroke(this.points.map(p => [p.x, p.y]), {
        size: PenTool.currentSize,
        thinning: 0.5,
        smoothing: 0.5,
        streamline: 0.5,
      });

      // Storing the svgPath in absolute canvas coordinates (with x/y always 0)
      // meant every freehand stroke reported a phantom 100x100 bounding box to
      // anything that reads obj.width/height (marquee-select, the eraser, the
      // minimap) — a scribble spanning half the canvas would still register
      // as "at the origin, 100x100" for hit-testing. Normalize to the actual
      // bounds and store the path relative to them, matching every other
      // object type's (x, y) + relative-content convention.
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of this.points) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      }
      const pad = PenTool.currentSize; // the stroke itself extends ~size/2 beyond the raw points
      minX -= pad; minY -= pad; maxX += pad; maxY += pad;

      const svgPath = getSvgPathFromStroke(strokePoints.map(([x, y]) => [x - minX, y - minY]));
      // The outline blob (svgPath) is what renders, but it's a filled polygon
      // traced around the stroke — not the stroke itself, so there's no way
      // to tell where along it you clicked. Keeping the original centerline
      // points (relative to the same origin) is what lets the Eraser cut an
      // actual gap in a freehand stroke instead of only being able to delete
      // the whole thing.
      const centerline = this.points.map(p => ({ x: p.x - minX, y: p.y - minY }));

      ctx.editor.createNode({
        id: nanoid(),
        type: 'path',
        x: minX,
        y: minY,
        width: Math.max(1, maxX - minX),
        height: Math.max(1, maxY - minY),
        geometry: {
          kind: 'freehand',
          svgPath,
          points: centerline,
          strokeSize: PenTool.currentSize,
        },
        // perfect-freehand emits a filled outline polygon, not a stroked line.
        appearance: { fill: [{ type: 'solid', color: PenTool.currentColor, opacity: 1 }] },
      });
    }
    
    this.points = [];
  }

  onDeactivate(ctx: ToolContext) {
    // Switching tools mid-stroke (e.g. a keyboard shortcut while still
    // dragging) left the in-progress preview permanently stuck on screen —
    // nothing else clears overlayState, and this tool only ever cleared it
    // from onPointerUp. BezierPenTool already resets on deactivate; this one
    // didn't.
    this.isDrawing = false;
    this.points = [];
    ctx.setOverlayState?.(null);
  }

  renderOverlay(ctx: ToolContext, overlayState: any) {
    if (overlayState?.type === 'pen' && overlayState.points) {
      const strokePoints = getStroke(overlayState.points.map((p: any) => [p.x, p.y]), {
        size: PenTool.currentSize,
        thinning: 0.5,
        smoothing: 0.5,
        streamline: 0.5,
      });
      const pathData = getSvgPathFromStroke(strokePoints);
      
      return (
        <Path
          data={pathData}
          fill={PenTool.currentColor}
          listening={false}
        />
      );
    }
    return null;
  }

  private getPointerPos(ctx: ToolContext, e: any) {
    const stage = e.target.getStage();
    const pos = stage?.getPointerPosition();
    if (!pos) return null;
    return {
      x: (pos.x - ctx.camera.x) / ctx.camera.zoom,
      y: (pos.y - ctx.camera.y) / ctx.camera.zoom
    };
  }
}

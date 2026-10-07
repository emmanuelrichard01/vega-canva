import React from 'react';
import type { TableLayout } from '../../engine/table/tableLayout';
import type { Prim } from '../../engine/table/tablePaint';
import { paintTable, type SketchPaths } from '../../engine/table/tableCanvas';
import type { SketchLevel } from '../../engine/model/rough';

/**
 * Frozen rows (or columns) pinned to the top (or left) of the free board while
 * the table runs past it.
 *
 * Painted on a canvas of its own by the board's painter (`tableCanvas.ts`),
 * from the same layout and the same cached cell paint — and only the frozen
 * tracks: a 2,000-row table's frozen header is one row of drawing, not a
 * whole table rendered to SVG text and parsed again on every frame.
 *
 * A band of frozen rows carries its own row labels in the gutter beside it,
 * over the gutter of whatever rows have scrolled underneath, so the header
 * never stands next to some other row's number.
 */
export const FrozenBand: React.FC<{
  axis: 'rows' | 'cols';
  layout: TableLayout;
  prims: (i: number) => Prim[];
  sketch?: SketchLevel;
  sketchPaths: SketchPaths | null;
  zoom: number;
  /** Where the band sits on screen, and how much of the table it shows (table px). */
  left: number;
  top: number;
  extent: number;
  /** Labels for the frozen rows, shown in the band's own gutter. */
  rowLabels?: Array<{ top: number; height: number; label: string }>;
  onPointerDown: (e: React.PointerEvent) => void;
  portal: Record<string, string>;
}> = ({ axis, layout, prims, sketch, sketchPaths, zoom, left, top, extent, rowLabels, onPointerDown, portal }) => {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const w = axis === 'rows' ? layout.width : extent;
  const h = axis === 'rows' ? extent : layout.height;
  const cssW = w * zoom;
  const cssH = h * zoom;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  React.useLayoutEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, 0, 0);
    ctx.clearRect(0, 0, w, h);
    paintTable(ctx, layout, { sketch, sketchPaths, prims, region: { x0: 0, y0: 0, x1: w, y1: h } });
  }, [layout, prims, sketch, sketchPaths, zoom, w, h, cssW, cssH, dpr]);

  return (
    <div
      className="tbled-band"
      data-axis={axis}
      style={{ left, top, width: cssW, height: cssH, '--inv': 1 / zoom } as React.CSSProperties}
      onPointerDown={onPointerDown}
      {...portal}
    >
      <canvas ref={ref} style={{ width: cssW, height: cssH }} aria-hidden="true" />
      {rowLabels && (
        <div className="tbled-band__gutter" aria-hidden="true" style={{ height: cssH }}>
          {rowLabels.map((r) => (
            <span key={r.label} className="tbled-band__label" style={{ top: r.top * zoom, height: r.height * zoom }}>
              {r.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

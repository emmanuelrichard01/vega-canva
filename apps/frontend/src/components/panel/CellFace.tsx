import React from 'react';
import { pointsAttribute, shapeOutline } from '../../engine/model/shapeOutline';
import { contourData } from '../../engine/model/pathGeometry';
import type { ShapeNode } from '../../engine/model/schema';
import type { CellShape } from '../../engine/grid/gridStyle';
import { MAX_ROUNDING } from '../../engine/grid/gridStyle';

/**
 * A single module, drawn as the board would draw it.
 *
 * ## Why the shape picker draws modules and not glyphs
 *
 * It drew six abstract outlines: a square, a circle, a triangle. They identify
 * the *shape* and nothing else, which is the smaller half of the question. What
 * a module actually looks like is the shape **plus the corner radius, plus the
 * stroke** — and those live in two steppers below the picker, so the only way
 * to see the combination was to look at the board, adjust, and look again.
 *
 * Drawing the real thing folds three controls into one answer: raise the radius
 * and the swatches round, add a stroke and they outline. The picker stops being
 * a list of shapes and becomes a preview of the decision.
 *
 * `shapeOutline` is the same geometry the exporter draws from, so a swatch
 * cannot claim a shape the canvas declines to produce — the failure the
 * variations picker shipped with, and worth not repeating one panel away.
 */

const SHAPE_GEOMETRY: Record<CellShape, { kind: ShapeNode['geometry']['kind']; points?: number }> = {
  rect: { kind: 'rect' },
  ellipse: { kind: 'ellipse' },
  triangle: { kind: 'polygon', points: 3 },
  diamond: { kind: 'polygon', points: 4 },
  hexagon: { kind: 'polygon', points: 6 },
  star: { kind: 'star', points: 5 },
};

interface Props {
  shape: CellShape;
  size: number;
  fill: string;
  /** Corner radius in board units, scaled to the swatch the same way a cell is. */
  radius?: number;
  /** How big the real cell is, so the radius reads at the right proportion. */
  cellSize?: number;
  strokeColor?: string;
  strokeWidth?: number;
  opacity?: number;
}

export const CellFace: React.FC<Props> = ({
  shape,
  size,
  fill,
  radius = 0,
  cellSize,
  strokeColor,
  strokeWidth = 0,
  opacity = 1,
}) => {
  /**
   * The radius as a *proportion* of the module, not as pixels.
   *
   * A 12px radius on a 30px swatch is a pill; on the 120px module it stands for
   * it is a soft corner. Scaling it by the ratio between them is what makes the
   * swatch a preview rather than a caricature — and it is clamped by the same
   * rule the real cell uses, so a swatch can never round further than the thing
   * it represents.
   */
  const box = size - strokeWidth;
  const scaled = cellSize && cellSize > 0 ? (radius / cellSize) * box : radius;
  const rounded = Math.min(scaled, box * MAX_ROUNDING);

  const outline = shapeOutline({
    geometry: SHAPE_GEOMETRY[shape] as ShapeNode['geometry'],
    width: box,
    height: box,
    appearance: { cornerRadius: rounded },
  });

  const paint = {
    fill,
    stroke: strokeWidth > 0 ? strokeColor : undefined,
    strokeWidth: strokeWidth > 0 ? Math.max(1, strokeWidth * 0.5) : undefined,
  };

  const inner = (() => {
    switch (outline.kind) {
      case 'rect':
        return <rect x={0} y={0} width={outline.width} height={outline.height} rx={outline.radius} {...paint} />;
      case 'ellipse':
        return <ellipse cx={outline.cx} cy={outline.cy} rx={outline.rx} ry={outline.ry} {...paint} />;
      case 'polygon':
        return <polygon points={pointsAttribute(outline.points)} {...paint} />;
      case 'bezier':
        return <path d={contourData(outline.geometry)} {...paint} />;
      default:
        return null;
    }
  })();

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} opacity={opacity} aria-hidden focusable="false">
      <g transform={`translate(${strokeWidth / 2} ${strokeWidth / 2})`}>{inner}</g>
    </svg>
  );
};

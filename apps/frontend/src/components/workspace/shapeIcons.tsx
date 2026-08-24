import React from 'react';

/**
 * Shape glyphs, defined once.
 *
 * These lived twice in ToolWorkspace: once in `renderShapeIcon()` to show which
 * shape is armed on the dock button, and again, character for character, in the
 * flyout that picks it. Two copies of the same path data means the armed icon
 * and the menu icon can drift apart, and adding a sixth shape meant remembering
 * to add it in both places.
 *
 * Hand-authored rather than pulled from lucide-react because lucide has no
 * triangle or hexagon primitive, and because these read as *geometry* — the one
 * category of SVG the craft floor keeps first-class. They inherit `currentColor`
 * and take their size from the caller, so they behave like any other icon.
 */

import { heartAnchors, squircleAnchors } from '../../engine/model/shapeOutline';
import { fromAnchors, pathData } from '../../engine/model/pathGeometry';
import type { ShapePreset } from './shapePresetTypes';

interface ShapeIconProps {
  kind: ShapePreset;
  size?: number;
}

/** One stroke weight across the whole set, so no shape reads heavier than its neighbours. */
const STROKE = 2;

/**
 * The heart glyph, from the same anchors the canvas draws.
 *
 * Inset by the stroke weight so the outline sits inside the 24-unit box the
 * rest of the set uses, rather than being clipped at the tip.
 */
const heartGlyph = pathData(
  fromAnchors(
    heartAnchors(24 - STROKE * 2, 24 - STROKE * 2).map((a) => ({
      x: a.x + STROKE,
      y: a.y + STROKE,
      inX: (a.inX ?? a.x) + STROKE,
      inY: (a.inY ?? a.y) + STROKE,
      outX: (a.outX ?? a.x) + STROKE,
      outY: (a.outY ?? a.y) + STROKE,
    })),
    true
  )
);

/**
 * The squircle glyph, from the same continuous-curvature anchors the canvas draws.
 */
const squircleGlyph = pathData(
  fromAnchors(
    squircleAnchors(24 - STROKE * 2, 24 - STROKE * 2).map((a) => ({
      x: a.x + STROKE,
      y: a.y + STROKE,
      inX: (a.inX ?? a.x) + STROKE,
      inY: (a.inY ?? a.y) + STROKE,
      outX: (a.outX ?? a.x) + STROKE,
      outY: (a.outY ?? a.y) + STROKE,
    })),
    true
  )
);

/** The regular polygon glyphs, generated so the set cannot drift by hand. */
function polygonGlyph(sides: number): React.ReactNode {
  const pts = Array.from({ length: sides }, (_, i) => {
    const a = (i * 2 * Math.PI) / sides - Math.PI / 2;
    return `${(12 + 10 * Math.cos(a)).toFixed(2)} ${(12 + 10 * Math.sin(a)).toFixed(2)}`;
  });
  return <polygon points={pts.join(' ')} />;
}

const PATHS: Record<ShapePreset, React.ReactNode> = {
  rect: <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />,
  ellipse: <circle cx="12" cy="12" r="10" />,
  squircle: <path d={squircleGlyph} />,
  triangle: polygonGlyph(3),
  pentagon: polygonGlyph(5),
  hexagon: polygonGlyph(6),
  octagon: polygonGlyph(8),
  star: (
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  ),
  // Generated from the shape's own curve rather than drawn by hand, the way
  // the polygon glyphs are. A hand-authored heart here would be a second
  // heart, and the one people compare against the canvas.
  heart: <path d={heartGlyph} />,
  line: <path d="M4 20 L20 4" />,
  arrow: <path d="M4 20 L20 4 M20 4 L13 5 M20 4 L19 11" />,
};



export const ShapeIcon: React.FC<ShapeIconProps> = ({ kind, size = 18 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={STROKE}
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {PATHS[kind]}
  </svg>
);

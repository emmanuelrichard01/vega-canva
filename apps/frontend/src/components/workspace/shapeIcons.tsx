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

import { heartAnchors } from '../../engine/model/shapeOutline';
import { fromAnchors, pathData } from '../../engine/model/pathGeometry';
import type { ShapeKind } from '../../engine/model/schema';

/**
 * What the dock offers, which is not the same list as `ShapeKind`.
 *
 * A polygon is one kind with a side count, and nobody wants to draw a
 * rectangle and then type "3". So the dock offers the side counts people
 * actually reach for as named presets, each of which creates a polygon.
 * `ShapeKind` describes the document; this describes the menu.
 */
export type ShapePreset =
  | 'rect'
  | 'ellipse'
  | 'triangle'
  | 'pentagon'
  | 'hexagon'
  | 'octagon'
  | 'star'
  | 'heart'
  | 'line'
  | 'arrow';

/** The kind and side count each preset creates. */
export const PRESET_GEOMETRY: Record<ShapePreset, { kind: ShapeKind; points?: number }> = {
  rect: { kind: 'rect' },
  ellipse: { kind: 'ellipse' },
  triangle: { kind: 'polygon', points: 3 },
  pentagon: { kind: 'polygon', points: 5 },
  hexagon: { kind: 'polygon', points: 6 },
  octagon: { kind: 'polygon', points: 8 },
  star: { kind: 'star', points: 5 },
  heart: { kind: 'heart' },
  line: { kind: 'line' },
  arrow: { kind: 'arrow' },
};

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

/**
 * The shapes the Shape seat offers.
 *
 * `line` and `arrow` are **not** here, and that is the point: they are still
 * `shape` nodes in the document — the model is right — but they are not the
 * same *gesture*. Every entry below is drawn by dragging a box; a line is drawn
 * click-move-click, has two ends rather than four corners, and is edited by its
 * endpoints instead of a bounding box. Sitting them in a grid of rectangles
 * implied a similarity the tools do not have.
 *
 * They have their own dock seat now, paired the way the pencil and the pen are.
 */
export const SHAPE_KINDS: ShapePreset[] = [
  'rect',
  'ellipse',
  'triangle',
  'pentagon',
  'hexagon',
  'octagon',
  'star',
  'heart',
];

/** The two open runs, which share a seat and switch between each other. */
export const LINE_KINDS: ShapePreset[] = ['line', 'arrow'];

export const SHAPE_LABELS: Record<ShapePreset, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  triangle: 'Triangle',
  pentagon: 'Pentagon',
  hexagon: 'Hexagon',
  octagon: 'Octagon',
  star: 'Star',
  heart: 'Heart',
  line: 'Line',
  arrow: 'Arrow',
};

/** `shape-rect` etc. — the ids the ToolManager already registers. */
export const shapeToolId = (preset: ShapePreset) => `shape-${preset}`;

/**
 * Every preset, across both dock seats.
 *
 * `SHAPE_KINDS` is what the Shape *seat* offers, which stopped being the same
 * thing as "presets that exist" when line and arrow moved to their own seat.
 * Resolving a tool id against the seat's list meant `shape-line` resolved to
 * null — so nothing knew a line was armed, and the Shape seat lit up instead.
 */
export const ALL_SHAPE_PRESETS: ShapePreset[] = [...SHAPE_KINDS, ...LINE_KINDS];

/** The armed preset for a tool id, or null when the active tool is not a shape. */
export function shapeKindFromToolId(toolId: string): ShapePreset | null {
  const kind = toolId.startsWith('shape-') ? toolId.slice('shape-'.length) : null;
  return kind && (ALL_SHAPE_PRESETS as string[]).includes(kind) ? (kind as ShapePreset) : null;
}

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

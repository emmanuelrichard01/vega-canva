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
  line: { kind: 'line' },
  arrow: { kind: 'arrow' },
};

interface ShapeIconProps {
  kind: ShapePreset;
  size?: number;
}

/** One stroke weight across the whole set, so no shape reads heavier than its neighbours. */
const STROKE = 2;

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
  line: <path d="M4 20 L20 4" />,
  arrow: <path d="M4 20 L20 4 M20 4 L13 5 M20 4 L19 11" />,
};

export const SHAPE_KINDS: ShapePreset[] = [
  'rect',
  'ellipse',
  'triangle',
  'pentagon',
  'hexagon',
  'octagon',
  'star',
  'line',
  'arrow',
];

export const SHAPE_LABELS: Record<ShapePreset, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  triangle: 'Triangle',
  pentagon: 'Pentagon',
  hexagon: 'Hexagon',
  octagon: 'Octagon',
  star: 'Star',
  line: 'Line',
  arrow: 'Arrow',
};

/** `shape-rect` etc. — the ids the ToolManager already registers. */
export const shapeToolId = (preset: ShapePreset) => `shape-${preset}`;

/** The armed preset for a tool id, or null when the active tool is not a shape. */
export function shapeKindFromToolId(toolId: string): ShapePreset | null {
  const kind = toolId.startsWith('shape-') ? toolId.slice('shape-'.length) : null;
  return kind && (SHAPE_KINDS as string[]).includes(kind) ? (kind as ShapePreset) : null;
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

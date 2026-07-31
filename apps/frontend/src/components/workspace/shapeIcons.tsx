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

export type ShapeKind = 'rect' | 'ellipse' | 'triangle' | 'hexagon' | 'star';

interface ShapeIconProps {
  kind: ShapeKind;
  size?: number;
}

/** One stroke weight across the whole set, so no shape reads heavier than its neighbours. */
const STROKE = 2;

const PATHS: Record<ShapeKind, React.ReactNode> = {
  rect: <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />,
  ellipse: <circle cx="12" cy="12" r="10" />,
  triangle: <path d="M12 3L21 20H3L12 3Z" />,
  hexagon: <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2" />,
  star: (
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  ),
};

export const SHAPE_KINDS: ShapeKind[] = ['rect', 'ellipse', 'triangle', 'hexagon', 'star'];

export const SHAPE_LABELS: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  triangle: 'Triangle',
  hexagon: 'Hexagon',
  star: 'Star',
};

/** `shape-rect` etc. — the ids the ToolManager already registers. */
export const shapeToolId = (kind: ShapeKind) => `shape-${kind}`;

/** The armed shape for a tool id, or null when the active tool is not a shape. */
export function shapeKindFromToolId(toolId: string): ShapeKind | null {
  const kind = toolId.startsWith('shape-') ? toolId.slice('shape-'.length) : null;
  return kind && (SHAPE_KINDS as string[]).includes(kind) ? (kind as ShapeKind) : null;
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

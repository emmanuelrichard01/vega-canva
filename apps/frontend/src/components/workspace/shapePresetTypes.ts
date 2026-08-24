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
  | 'squircle'
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
  squircle: { kind: 'squircle' },
  triangle: { kind: 'polygon', points: 3 },
  pentagon: { kind: 'polygon', points: 5 },
  hexagon: { kind: 'polygon', points: 6 },
  octagon: { kind: 'polygon', points: 8 },
  star: { kind: 'star', points: 5 },
  heart: { kind: 'heart' },
  line: { kind: 'line' },
  arrow: { kind: 'arrow' },
};

/**
 * The shapes the Shape seat offers.
 *
 * `line` and `arrow` are not here: they have their own dock seat.
 */
export const SHAPE_KINDS: ShapePreset[] = [
  'rect',
  'ellipse',
  'squircle',
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
  squircle: 'Squircle',
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
 */
export const ALL_SHAPE_PRESETS: ShapePreset[] = [...SHAPE_KINDS, ...LINE_KINDS];

/** The armed preset for a tool id, or null when the active tool is not a shape. */
export function shapeKindFromToolId(toolId: string): ShapePreset | null {
  const kind = toolId.startsWith('shape-') ? toolId.slice('shape-'.length) : null;
  return kind && (ALL_SHAPE_PRESETS as string[]).includes(kind) ? (kind as ShapePreset) : null;
}

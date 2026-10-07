/**
 * Knobs drawn on a shape for its parametric fields: a parallelogram's slant, a
 * cylinder's rim, a block arrow's head, a document's wave.
 *
 * Each handle is two functions over the node's own box: where the knob sits
 * for a value, and what value a pointer at some local point means. The knob
 * sits on the feature it controls, so dragging it moves that feature under the
 * pointer, the way Lucidchart's and Visio's control points do.
 *
 * Values are clamped and stepped through the same `SHAPE_PARAMS` entry the
 * panel and the normalizer read, so a handle cannot store a value the panel
 * would show differently.
 */

import type { Point, ShapeGeometry, ShapeKind } from '../schema';
import { SHAPE_PARAMS, clampParam, type ShapeParamField } from '../shapeParams';
import { param } from './params';
import { KEY_HOLE_OFFSET, keyLayout, keyPoint, multiDocumentStep, type KeyLayout } from './contours';

export interface ParamHandle {
  field: ShapeParamField;
  /** What the knob is for, as a tooltip and an accessible name. */
  label: string;
  /**
   * Both take the whole geometry as well, for a knob whose place depends on the
   * shape's other dials: a key's hole sits in a bow whose size is a dial too.
   */
  position(w: number, h: number, value: number, geometry?: ShapeGeometry): Point;
  value(w: number, h: number, p: Point, geometry?: ShapeGeometry): number;
}

/** Slant and taper: the knob sits on whichever edge is the short one. */
const signedTopBottom = (field: ShapeParamField, label: string): ParamHandle => ({
  field,
  label,
  position: (w, h, v) => (v >= 0 ? { x: v * w, y: 0 } : { x: -v * w, y: h }),
  value: (w, h, p) => (p.y < h / 2 ? p.x / w : -p.x / w),
});

const HANDLES: Partial<Record<ShapeKind, readonly ParamHandle[]>> = {
  parallelogram: [signedTopBottom('skew', 'Slant')],
  trapezoid: [signedTopBottom('inset', 'Taper')],
  chevron: [{ field: 'indent', label: 'Notch', position: (w, h, v) => ({ x: v * w, y: h / 2 }), value: (w, _h, p) => p.x / w }],
  preparation: [{ field: 'indent', label: 'Point', position: (w, _h, v) => ({ x: v * w, y: 0 }), value: (w, _h, p) => p.x / w }],
  banner: [{ field: 'indent', label: 'Swallowtail', position: (w, h, v) => ({ x: v * w, y: h / 2 }), value: (w, _h, p) => p.x / w }],
  display: [{ field: 'indent', label: 'Ends', position: (w, _h, v) => ({ x: v * w, y: 0 }), value: (w, _h, p) => p.x / w }],
  arrow_block: [
    { field: 'indent', label: 'Head', position: (w, _h, v) => ({ x: w - v * w, y: 0 }), value: (w, _h, p) => (w - p.x) / w },
  ],
  manual_input: [{ field: 'indent', label: 'Slope', position: (_w, h, v) => ({ x: 0, y: v * h }), value: (_w, h, p) => p.y / h }],
  off_page: [
    { field: 'indent', label: 'Point', position: (_w, h, v) => ({ x: 0, y: h * (1 - v) }), value: (_w, h, p) => 1 - p.y / h },
  ],
  card: [
    {
      field: 'indent',
      label: 'Corner cut',
      position: (w, h, v) => ({ x: v * Math.min(w, h), y: 0 }),
      value: (w, h, p) => p.x / Math.min(w, h),
    },
  ],
  loop_limit: [
    {
      field: 'indent',
      label: 'Chamfer',
      position: (w, h, v) => ({ x: v * Math.min(w, h), y: 0 }),
      value: (w, h, p) => p.x / Math.min(w, h),
    },
  ],
  stored_data: [
    { field: 'indent', label: 'Curve', position: (w, h, v) => ({ x: w - v * w, y: h / 2 }), value: (w, _h, p) => (w - p.x) / w },
  ],
  direct_access_storage: [
    { field: 'rimRatio', label: 'End', position: (w, h, v) => ({ x: w - 2 * v * w, y: h / 2 }), value: (w, _h, p) => (w - p.x) / (2 * w) },
  ],
  cylinder: [{ field: 'rimRatio', label: 'Rim', position: (w, h, v) => ({ x: w / 2, y: 2 * v * h }), value: (_w, h, p) => p.y / (2 * h) }],
  database: [{ field: 'rimRatio', label: 'Rim', position: (w, h, v) => ({ x: w / 2, y: 2 * v * h }), value: (_w, h, p) => p.y / (2 * h) }],
  document: [{ field: 'waveHeight', label: 'Wave', position: (w, h, v) => ({ x: w / 2, y: h - v * h }), value: (_w, h, p) => (h - p.y) / h }],
  multi_document: [
    {
      field: 'waveHeight',
      label: 'Wave',
      position: (w, h, v) => {
        const d = multiDocumentStep(w, h);
        return { x: (w - 2 * d) / 2, y: h - v * (h - 2 * d) };
      },
      value: (w, h, p) => {
        const d = multiDocumentStep(w, h);
        return (h - p.y) / (h - 2 * d);
      },
    },
  ],
  punched_tape: [{ field: 'waveHeight', label: 'Wave', position: (w, h, v) => ({ x: w / 2, y: v * h }), value: (_w, h, p) => p.y / h }],
  cross: [
    {
      field: 'armRatio',
      label: 'Arm width',
      position: (w, h, v) => ({ x: w / 2 - (v * Math.min(w, h)) / 2, y: 0 }),
      value: (w, h, p) => ((w / 2 - p.x) * 2) / Math.min(w, h),
    },
  ],
  key: [
    {
      field: 'innerRatio',
      label: 'Hole',
      // On the hole's rim, on the axis away from the blade, so the knob rides
      // the edge it moves.
      position: (w, h, v, g) => {
        const k = keyFor(w, h, g);
        return keyPoint(k, -(KEY_HOLE_OFFSET + v) * k.bow, 0);
      },
      value: (w, h, p, g) => {
        const k = keyFor(w, h, g);
        const out = -((p.x - k.cx) * k.ux + (p.y - k.cy) * k.uy) / k.r;
        return out - KEY_HOLE_OFFSET;
      },
    },
  ],
  donut: [{ field: 'innerRatio', label: 'Hole', position: (w, h, v) => ({ x: w / 2 + (v * w) / 2, y: h / 2 }), value: (w, _h, p) => (p.x - w / 2) / (w / 2) }],
};

/** A key's layout for its box, with the bow the geometry asks for. */
function keyFor(w: number, h: number, g: ShapeGeometry | undefined): KeyLayout {
  return keyLayout(w, h, param(g ?? { kind: 'key' }, 'bowRatio'));
}

/** The handles a kind offers. Empty for kinds with no on-canvas dial. */
export function paramHandles(kind: ShapeKind): readonly ParamHandle[] {
  return HANDLES[kind] ?? [];
}

/** A pointer at `p` as a stored value: mapped, clamped and snapped to the dial's step. */
export function handleValue(geometry: ShapeGeometry, handle: ParamHandle, w: number, h: number, p: Point): number {
  const declared = SHAPE_PARAMS[geometry.kind]?.params.find((d) => d.field === handle.field);
  const raw = handle.value(w, h, p, geometry);
  if (!declared || !Number.isFinite(raw)) return param(geometry, handle.field);
  const stepped = Math.round(raw / (declared.step / 5)) * (declared.step / 5);
  return clampParam(declared, stepped);
}

/** Where the knob sits for the geometry as stored (or as dragged). */
export function handlePosition(geometry: ShapeGeometry, handle: ParamHandle, w: number, h: number): Point {
  return handle.position(w, h, param(geometry, handle.field), geometry);
}

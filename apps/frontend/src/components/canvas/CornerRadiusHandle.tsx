import React, { useMemo, useState } from 'react';
import { Circle, Group, Line } from 'react-konva';
import type Konva from 'konva';
import { updateNode } from '../../engine/document';
import { EXPORT_CHROME } from '../../engine/export/chrome';
import { flattenPath } from '../../engine/model/pathGeometry';
import { shapeToPath } from '../../engine/model/shapeToPath';
import type { Point, ShapeNode } from '../../engine/model/schema';
import { isRoundableTurn } from '../../engine/model/roundCorners';
import { liveTransformStore, useLiveTransform } from '../../engine/model/liveTransformStore';
import { claimCursor } from '../../engine/cursor/cursorOverride';
import { cornerRadiiOf, type CornerRadiusValue } from '../../engine/model/cornerRadii';

/**
 * The live value, when it is the single-number form.
 *
 * This handle drags *one* radius, so a live per-corner value is not something
 * it can show — and there is never one, because the handle is the only thing
 * that writes a live radius. Narrowing rather than collapsing keeps that true
 * rather than quietly averaging four corners into a drag.
 */
const asNumber = (v: CornerRadiusValue | undefined): number | undefined =>
  typeof v === 'number' ? v : undefined;

interface Props {
  node: ShapeNode;
  /** World units per screen pixel, so the knob stays one size at any zoom. */
  stageScale: number;
}

const ACCENT = '#3B82F6';
/** Screen size of the knob, a touch smaller than a transformer anchor. */
const KNOB = 9;
/** How far from the corner the knob rests when the radius is zero, in screen px. */
const REST_INSET = 15;

/** A corner found on the shape: where it is, and which way is "inward". */
interface Corner {
  point: Point;
  /** Unit vector along the bisector, pointing into the shape. */
  inward: Point;
  /** How far the knob may travel before the corner is as round as it can be. */
  reach: number;
}

/**
 * Where a shape's corners are, and which way each one opens.
 *
 * All coordinates are in the shape's own local space (origin at top-left,
 * x right, y down), because that is what `shapeToPath` produces and what
 * the Konva group's rotation will transform to world space.
 *
 * The outline is flattened and walked; a vertex counts as a corner when the
 * direction changes sharply enough — the same test `roundCorners` uses, and it
 * has to be, or the knob would appear on a corner the rounder declines to
 * round. Curves contribute nothing, which is why a circle has no knob and a
 * heart has exactly one, at its tip.
 */
function cornersOf(node: ShapeNode): Corner[] {
  let pts: Point[];
  try {
    pts = flattenPath(shapeToPath(node));
  } catch {
    return [];
  }
  if (pts.length < 3) return [];

  const out: Corner[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i += 1) {
    const previous = pts[(i - 1 + n) % n];
    const here = pts[i];
    const next = pts[(i + 1) % n];

    const a = { x: here.x - previous.x, y: here.y - previous.y };
    const b = { x: next.x - here.x, y: next.y - here.y };
    const la = Math.hypot(a.x, a.y);
    const lb = Math.hypot(b.x, b.y);
    if (la < 1e-6 || lb < 1e-6) continue;

    const cos = Math.min(1, Math.max(-1, (a.x * b.x + a.y * b.y) / (la * lb)));
    // The rounder's own judgement, imported rather than restated. A knob on a
    // corner the rounder declines is an affordance for nothing — worse than no
    // affordance, because the only way to discover it is to drag it and watch
    // the shape not change. Nearly-straight junctions are not corners, and
    // needle-sharp ones cannot be filleted without erasing the point that
    // makes the shape recognisable.
    if (!isRoundableTurn(Math.acos(cos))) continue;

    // The bisector of the two edges, pointing into the shape. Built from the
    // *reversed* incoming edge and the outgoing one, which is what makes it
    // bisect the interior angle rather than the exterior one.
    const ua = { x: -a.x / la, y: -a.y / la };
    const ub = { x: b.x / lb, y: b.y / lb };
    const bx = ua.x + ub.x;
    const by = ua.y + ub.y;
    const lbis = Math.hypot(bx, by);
    // A perfect reversal — a spike doubling back on itself — has no bisector.
    if (lbis < 1e-6) continue;

    out.push({
      point: here,
      inward: { x: bx / lbis, y: by / lbis },
      reach: Math.min(la, lb) * 0.45,
    });
  }
  return out;
}

/**
 * The corner radius as a knob you drag, the way Illustrator and Photoshop do it.
 *
 * ## Real-Time Live Transform Tracking
 *
 * Subscribes to `useLiveTransform(node.id)`. When the shape is dragged across
 * the canvas by `ObjectRenderer`, or resized/rotated by `SelectionTransformer`,
 * the handle receives live coordinates at 60fps and moves in perfect lockstep
 * with the shape instead of lagging or staying stuck until mouseup.
 *
 * ## Rotation invariance & Centre-Pivot
 *
 * `ObjectRenderer` positions each node with centre-pivot rotation:
 * `<Group x={node.x + cx} y={node.y + cy} offsetX={cx} offsetY={cy} rotation={node.rotation}>`.
 *
 * This handle is a sibling mounted by `Canvas.tsx` and replicates the same
 * centre-pivot transform using the live values, keeping shape-local corner
 * calculations perfectly aligned.
 */
export const CornerRadiusHandle: React.FC<Props> = ({ node, stageScale }) => {
  const liveTransform = useLiveTransform(node.id);
  const [liveRadius, setLiveRadius] = useState<number | null>(null);

  const xPos = liveTransform?.x ?? node.x;
  const yPos = liveTransform?.y ?? node.y;
  const width = liveTransform?.width ?? node.width;
  const height = liveTransform?.height ?? node.height;
  const rotation = liveTransform?.rotation ?? node.rotation ?? 0;

  // Corners are measured on the *unrounded* shape, incorporating live width/height
  const corners = useMemo(
    () =>
      cornersOf({
        ...node,
        width,
        height,
        rotation,
        appearance: { ...(node.appearance ?? {}), cornerRadius: 0 },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [node.geometry, width, height, rotation]
  );

  const corner = useMemo(() => {
    if (corners.length === 0) return null;
    // Nearest the top-left of the box: predictable, and out of the way of the
    // transformer's rotate handles, which cluster at the outside of the box.
    return corners.reduce((best, c) => (c.point.x + c.point.y < best.point.x + best.point.y ? c : best));
  }, [corners]);

  if (!corner) return null;

  /**
   * The knob's own corner sets its travel, not the tightest corner on the shape.
   */
  const max = corner.reach;
  const radius = Math.min(
    liveRadius ?? asNumber(liveTransform?.cornerRadius) ?? cornerRadiiOf(node.appearance?.cornerRadius)[0],
    max
  );

  // Clamped so the resting position stays within the shape on small shapes.
  const restDistance = Math.min(REST_INSET / stageScale, max * 0.45);
  // Along the bisector from the corner. The rest position keeps the knob clear
  // of the transformer's own anchor when there is no radius yet.
  const travel = Math.min(max, Math.max(radius, restDistance));

  // Shape-local coordinates — the wrapping Group's transform handles world placement.
  const origin = { x: corner.point.x, y: corner.point.y };
  const x = origin.x + corner.inward.x * travel;
  const y = origin.y + corner.inward.y * travel;

  /** The pointer projected onto the bisector, as a radius (in shape-local space). */
  const radiusFor = (px: number, py: number): number => {
    const along = (px - origin.x) * corner.inward.x + (py - origin.y) * corner.inward.y;
    return Math.max(0, Math.min(max, along));
  };

  const commit = (value: number) => {
    updateNode(node.id, {
      appearance: {
        ...(node.appearance ?? {}),
        cornerRadius: value > 0.5 ? Math.round(value) : undefined,
      },
    } as Partial<ShapeNode>);
    liveTransformStore.delete(node.id);
    setLiveRadius(null);
  };

  // Centre-pivot: matches ObjectRenderer's `<Group x={node.x + cx} y={node.y + cy}
  // offsetX={cx} offsetY={cy} rotation={rotation}>` exactly.
  const cx = width / 2;
  const cy = height / 2;

  return (
    <Group
      x={xPos + cx}
      y={yPos + cy}
      offsetX={cx}
      offsetY={cy}
      rotation={rotation}
      scaleX={node.scaleX}
      scaleY={node.scaleY}
      name={EXPORT_CHROME}
    >
      {/* The line the knob runs along, shown only while dragging the knob */}
      {liveRadius !== null && (
        <Line
          points={[origin.x, origin.y, origin.x + corner.inward.x * max, origin.y + corner.inward.y * max]}
          stroke={ACCENT}
          strokeWidth={1 / stageScale}
          dash={[3 / stageScale, 3 / stageScale]}
          listening={false}
        />
      )}
      <Circle
        x={x}
        y={y}
        radius={KNOB / 2 / stageScale}
        fill="#FFFFFF"
        stroke={ACCENT}
        strokeWidth={1.5 / stageScale}
        draggable
        name={EXPORT_CHROME}
        onDragStart={() => {
          window.dispatchEvent(new CustomEvent('canvas-drag-start'));
          const initial = cornerRadiiOf(node.appearance?.cornerRadius)[0];
          setLiveRadius(initial);
          liveTransformStore.set(node.id, { cornerRadius: initial });
        }}
        onDragMove={(e: Konva.KonvaEventObject<DragEvent>) => {
          const next = radiusFor(e.target.x(), e.target.y());
          setLiveRadius(next);
          liveTransformStore.set(node.id, { cornerRadius: next });
        }}
        onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
          window.dispatchEvent(new CustomEvent('canvas-drag-end'));
          const value = radiusFor(e.target.x(), e.target.y());
          commit(value);
          // Put the knob back on the bisector — it is drawn from the radius,
          // not from wherever the pointer let go.
          const settled = Math.min(max, Math.max(value, restDistance));
          e.target.position({
            x: origin.x + corner.inward.x * settled,
            y: origin.y + corner.inward.y * settled,
          });
        }}
        onMouseEnter={() => claimCursor('corner-radius', 'pointer')}
        onMouseLeave={() => claimCursor('corner-radius', null)}
      />
    </Group>
  );
};

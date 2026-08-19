import React, { useMemo, useState } from 'react';
import { Circle, Group, Line } from 'react-konva';
import type Konva from 'konva';
import { updateNode } from '../../engine/document';
import { EXPORT_CHROME } from '../../engine/export/chrome';
import { flattenPath } from '../../engine/model/pathGeometry';
import { shapeToPath } from '../../engine/model/shapeToPath';
import type { Point, ShapeNode } from '../../engine/model/schema';
import { isRoundableTurn } from '../../engine/model/roundCorners';

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
 * ## Why a knob rather than only a number
 *
 * The radius has always been reachable — a stepper in the properties panel, a
 * slider on the rail. Both are fine for *setting* a value you already know and
 * hopeless for *finding* one, which is what rounding a corner actually is: you
 * are matching a feeling against the rest of the board, and the answer arrives
 * by moving until it looks right rather than by typing 12.
 *
 * ## Why it is not on the top-left of a rectangle
 *
 * Because "the corner" is not a rectangle's idea. The knob sits on whichever
 * corner the *shape* actually has, found by walking the flattened outline for
 * sharp turns — so a triangle gets one, a star gets ten, a hexagon six, and a
 * heart exactly one, at its point. A circle gets none, and correctly shows no
 * knob at all rather than a control that would do nothing.
 *
 * The knob is placed on the corner nearest the top-left of the shape's box, so
 * it lands somewhere predictable rather than wherever the outline happened to
 * start, and every knob edits the same single radius — one shape, one
 * roundness, which is what the model stores and what the panel has always said.
 *
 * ## What it is dragged along
 *
 * The corner's **bisector**, into the shape. A radius is a distance from the
 * corner along both edges at once, so the bisector is the one direction that
 * treats them equally — dragging along an axis instead would have to pick one
 * edge and would disagree with itself on every shape that is not a rectangle.
 * The pointer is projected onto that line, so the knob tracks the hand without
 * the hand having to be exact.
 *
 * It works in sketch mode for free, because the sketcher draws whatever
 * `shapeOutline` describes and the rounding happens there.
 */
export const CornerRadiusHandle: React.FC<Props> = ({ node, stageScale }) => {
  const [live, setLive] = useState<number | null>(null);

  // Corners are measured on the *unrounded* shape, so the knob's travel does
  // not shrink as it is dragged — a handle that runs away from the pointer is
  // the classic way this control goes wrong.
  const corners = useMemo(
    () => cornersOf({ ...node, appearance: { ...(node.appearance ?? {}), cornerRadius: 0 } }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [node.geometry, node.width, node.height]
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
   *
   * Taking the global minimum was the "not smart" behaviour: one short edge —
   * a star's inner valley, a sliver on an irregular polygon — capped the whole
   * shape's radius at almost nothing, so the knob barely moved and the control
   * felt broken. `roundCorners` already clamps every corner to its own room,
   * so each corner takes what it can and the others are not held back by it.
   */
  const max = corner.reach;
  const radius = Math.min(live ?? node.appearance?.cornerRadius ?? 0, max);

  // Along the bisector from the corner. The rest position keeps the knob clear
  // of the transformer's own anchor when there is no radius yet.
  const travel = Math.max(radius, REST_INSET / stageScale);
  const origin = { x: node.x + corner.point.x, y: node.y + corner.point.y };
  const x = origin.x + corner.inward.x * travel;
  const y = origin.y + corner.inward.y * travel;

  /** The pointer projected onto the bisector, as a radius. */
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
    setLive(null);
  };

  return (
    <Group name={EXPORT_CHROME}>
      {/* The line the knob runs along, shown only while it is moving. Without
          it the constraint is invisible and a diagonal drag reads as the knob
          refusing to follow the pointer. */}
      {live !== null && (
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
          setLive(node.appearance?.cornerRadius ?? 0);
        }}
        onDragMove={(e: Konva.KonvaEventObject<DragEvent>) => {
          setLive(radiusFor(e.target.x(), e.target.y()));
        }}
        onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
          window.dispatchEvent(new CustomEvent('canvas-drag-end'));
          const value = radiusFor(e.target.x(), e.target.y());
          commit(value);
          // Put the knob back on the bisector — it is drawn from the radius,
          // not from wherever the pointer let go.
          const settled = Math.max(value, REST_INSET / stageScale);
          e.target.position({
            x: origin.x + corner.inward.x * settled,
            y: origin.y + corner.inward.y * settled,
          });
        }}
        onMouseEnter={(e) => {
          const stage = e.target.getStage();
          if (stage) stage.container().style.cursor = 'pointer';
        }}
        onMouseLeave={(e) => {
          const stage = e.target.getStage();
          if (stage) stage.container().style.cursor = '';
        }}
      />
    </Group>
  );
};

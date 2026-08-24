/**
 * Smart, dynamic, head-and-end aware magnetic snapping for lines and arrows.
 *
 * ## Why smart head-and-end awareness matters
 *
 * An unattached line is a directed vector from an origin (start / tail) to a
 * destination (end / head). Snapping a head or tail blindly to the nearest
 * coordinate causes frustrating artifacts:
 *
 * 1. **Directional Inversion**: An arrow approaching a box from the left can
 *    accidentally snap to the far right port if the pointer drifts slightly,
 *    causing the arrow to pierce straight through the box. Directional normal
 *    vector scoring prioritizes the facing edge towards the oncoming line.
 *
 * 2. **Cap Geometry Alignment**: An arrowhead (`arrow`, `triangle`) should rest its
 *    sharp tip cleanly against the shape perimeter, while a circle or diamond
 *    terminal should sit flush against the boundary without clipping.
 *
 * 3. **Start vs. End Semantic Feedback**: Dragging the head provides directional
 *    arrival indicators pointing into the port, while dragging the tail provides
 *    departure anchor indicators.
 */

import type { Point } from '../model/schema';
import type { BindCandidate } from '../model/connectorBinding';
import { PORT_SNAP_SCREEN, EDGE_BAND_SCREEN } from '../model/connectorBinding';
import { portPoint, type Box, type Port } from '../model/connector';
import { attachOnOutline, nearestOnOutline } from '../model/shapePerimeter';
import type { EndAlign, EndCapKind } from '../model/connectorEnds';
import { endCapShape, endCapSize } from '../model/connectorEnds';
import { defaultEndAlign, type LineProfile } from '../model/linePath';

const SIDES: Array<Exclude<Port, 'auto'>> = ['top', 'right', 'bottom', 'left'];

/** Cardinal port outward unit normal vectors in the shape's unrotated frame. */
const BASE_NORMALS: Record<Exclude<Port, 'auto'>, Point> = {
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/** Compute the rotated outward normal vector for a cardinal port. */
export function portNormal(side: Exclude<Port, 'auto'>, rotation = 0): Point {
  const base = BASE_NORMALS[side];
  if (!rotation) return base;
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: base.x * cos - base.y * sin,
    y: base.x * sin + base.y * cos,
  };
}

export interface SnapEndOptions {
  /** The other end of the line (stationary anchor point), for approach angle computation. */
  anchor?: Point;
  /** Whether the moving handle is the start ('start' / handle a) or end ('end' / handle b). */
  endType?: 'start' | 'end';
  /** The active marker head at this end. */
  capKind?: EndCapKind;
  /** End cap size multiplier. */
  endScale?: number;
  /** Stroke weight. */
  strokeWidth?: number;
  /** Line profile (straight, curved, wavy, zigzag, coil). */
  lineProfile?: LineProfile;
  /** End alignment ('inside' | 'extend'). */
  endAlign?: EndAlign;
}

export interface LineSnapIndicator {
  point: Point;
  normal: Point;
  angle: number;
  port?: Exclude<Port, 'auto'>;
  targetId: string;
  targetBox: Box;
  outline?: readonly Point[] | null;
  rotation?: number;
  endType: 'start' | 'end';
  capKind: EndCapKind;
}

export interface LineSnapResult {
  /** The resulting world position (snapped or original). */
  point: Point;
  /** Whether the point snapped to a target. */
  snapped: boolean;
  /** Node ID that was snapped to, if any. */
  targetId?: string;
  /** Which cardinal port (if snapped to an edge midpoint). */
  port?: Exclude<Port, 'auto'>;
  /** Visual indicator point for rendering feedback. */
  indicator?: Point;
  /** Rich visual and geometric metadata for rendering dynamic indicators. */
  meta?: LineSnapIndicator;
}

/**
 * Magnetically snap a line endpoint to the nearest shape port or perimeter outline
 * with smart head/tail directional awareness and end cap clearance.
 *
 * @param raw - The unconstrained world point under the cursor
 * @param candidates - List of connectable object candidates on the board
 * @param zoom - Stage scale / zoom (so snap thresholds remain constant in screen pixels)
 * @param options - Head/tail end options including anchor point and cap kind
 * @param excludeId - Optional node ID to ignore (e.g. the line being edited)
 */
export function snapLineEndpoint(
  raw: Point,
  candidates: readonly BindCandidate[],
  zoom: number,
  options?: SnapEndOptions,
  excludeId?: string | null
): LineSnapResult {
  const scale = zoom > 0 ? 1 / zoom : 1;
  const portThreshold = PORT_SNAP_SCREEN * scale * 1.5;
  const edgeThreshold = EDGE_BAND_SCREEN * scale;

  const anchor = options?.anchor;
  const endType = options?.endType ?? 'end';
  const capKind = options?.capKind ?? 'none';
  const endScale = options?.endScale ?? 1;
  const strokeWidth = options?.strokeWidth ?? 2;
  const effectiveAlign: EndAlign = options?.endAlign ?? defaultEndAlign(options?.lineProfile);

  // Approach unit vector from stationary anchor to raw cursor point
  let approachDir: Point = { x: 1, y: 0 };
  let approachAngle = 0;
  if (anchor) {
    const dx = raw.x - anchor.x;
    const dy = raw.y - anchor.y;
    const len = Math.hypot(dx, dy);
    if (len > 1e-4) {
      approachDir = { x: dx / len, y: dy / len };
      approachAngle = Math.atan2(dy, dx);
    }
  }

  let bestPortSnap: {
    point: Point;
    normal: Point;
    score: number;
    target: BindCandidate;
    port: Exclude<Port, 'auto'>;
  } | null = null;

  let bestEdgeSnap: {
    point: Point;
    normal: Point;
    score: number;
    target: BindCandidate;
  } | null = null;

  for (const c of candidates) {
    if (excludeId && c.id === excludeId) continue;

    // 1. Check the 4 cardinal ports with directional weighting
    for (const side of SIDES) {
      const portWorld = attachOnOutline(c.box, c.outline, c.rotation ?? 0, portPoint(c.box, side));
      const normal = portNormal(side, c.rotation ?? 0);
      const d = Math.hypot(raw.x - portWorld.x, raw.y - portWorld.y);

      if (d <= portThreshold) {
        // Directional penalty: If approaching as 'end' (head), penalize ports facing away
        let penalty = 1.0;
        if (anchor) {
          const dot = approachDir.x * normal.x + approachDir.y * normal.y;
          if (endType === 'end') {
            if (dot > 0.1) penalty += dot * 0.9;
          } else {
            if (dot < -0.1) penalty += Math.abs(dot) * 0.9;
          }
        }

        const weightedDist = d * penalty;
        if (!bestPortSnap || weightedDist < bestPortSnap.score) {
          bestPortSnap = {
            point: portWorld,
            normal,
            score: weightedDist,
            target: c,
            port: side,
          };
        }
      }
    }

    // 2. Also check outline perimeter
    if (c.outline && c.outline.length >= 3) {
      const nearest = nearestOnOutline(c.outline, raw);
      if (nearest && nearest.distance <= edgeThreshold) {
        const cx = c.box.x + c.box.width / 2;
        const cy = c.box.y + c.box.height / 2;
        const ndx = nearest.point.x - cx;
        const ndy = nearest.point.y - cy;
        const nlen = Math.hypot(ndx, ndy) || 1;
        const normal = { x: ndx / nlen, y: ndy / nlen };

        let penalty = 1.0;
        if (anchor) {
          const dot = approachDir.x * normal.x + approachDir.y * normal.y;
          if (endType === 'end') {
            if (dot > 0.1) penalty += dot * 0.8;
          } else {
            if (dot < -0.1) penalty += Math.abs(dot) * 0.8;
          }
        }

        const weightedDist = nearest.distance * penalty;
        if (!bestEdgeSnap || weightedDist < bestEdgeSnap.score) {
          bestEdgeSnap = {
            point: nearest.point,
            normal,
            score: weightedDist,
            target: c,
          };
        }
      }
    }
  }

  // Adjust endpoint coordinate so that marker tip rests flush on the shape perimeter
  const computeAdjustedPoint = (contactPoint: Point, normal: Point): Point => {
    if (capKind === 'none') return contactPoint;

    const size = endCapSize(strokeWidth, endScale);
    const shape = endCapShape(capKind, { x: 0, y: 0 }, 0, size);
    const inset = shape?.inset ?? 0;

    // Use inward normal when snapping to a port if approaching facing that port
    const alignDir = (anchor && Math.hypot(approachDir.x, approachDir.y) > 0.1)
      ? approachDir
      : { x: -normal.x, y: -normal.y };

    if (effectiveAlign === 'extend' && inset > 0) {
      // In extend mode, terminateRun projects the tip forward along alignDir by inset.
      // We pull the endpoint back by inset so the tip lands on contactPoint flush.
      if (endType === 'end') {
        return {
          x: contactPoint.x - alignDir.x * inset,
          y: contactPoint.y - alignDir.y * inset,
        };
      } else {
        return {
          x: contactPoint.x + alignDir.x * inset,
          y: contactPoint.y + alignDir.y * inset,
        };
      }
    }

    return contactPoint;
  };

  if (bestPortSnap !== null) {
    const snap = bestPortSnap;
    const finalPoint = computeAdjustedPoint(snap.point, snap.normal);
    return {
      point: finalPoint,
      snapped: true,
      targetId: snap.target.id,
      port: snap.port,
      indicator: snap.point,
      meta: {
        point: snap.point,
        normal: snap.normal,
        angle: approachAngle,
        port: snap.port,
        targetId: snap.target.id,
        targetBox: snap.target.box,
        outline: snap.target.outline,
        rotation: snap.target.rotation,
        endType,
        capKind,
      },
    };
  }

  if (bestEdgeSnap !== null) {
    const snap = bestEdgeSnap;
    const finalPoint = computeAdjustedPoint(snap.point, snap.normal);
    return {
      point: finalPoint,
      snapped: true,
      targetId: snap.target.id,
      indicator: snap.point,
      meta: {
        point: snap.point,
        normal: snap.normal,
        angle: approachAngle,
        targetId: snap.target.id,
        targetBox: snap.target.box,
        outline: snap.target.outline,
        rotation: snap.target.rotation,
        endType,
        capKind,
      },
    };
  }

  return {
    point: raw,
    snapped: false,
  };
}


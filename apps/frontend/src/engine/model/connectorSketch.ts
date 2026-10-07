/**
 * The hand-drawn form of a connector: its run and its end markers.
 *
 * The canvas and the SVG export both draw sketched connectors through here,
 * with the same seeds and options, so the strokes in the file are the strokes
 * on the board.
 *
 * - The run is seeded by the connector's id; each marker by the id plus its
 *   end (`start` / `end`), so the two heads wobble independently.
 * - A curved run is sketched as one continuous curve (`asCurve`), an elbow run
 *   keeps its corners and their overshoot.
 * - A dashed run takes one lap (`passes: 1`): two laps of a dash pattern never
 *   line up and read as noise.
 */

import { roughLoop, roughPolyline, seedFor, type SketchLevel } from './rough';
import type { EndCapShape } from './connectorEnds';

/** Below this marker size a hand-drawn head reads as a smudge, so small ones stay crisp. */
export const SKETCHABLE_CAP = 13;

export interface ConnectorSketchSpec {
  id: string;
  sketchSeed?: number;
  level: SketchLevel;
  width: number;
  curved: boolean;
  dashed: boolean;
}

/** The sketched run, as SVG path data. */
export function sketchedRun(points: readonly { x: number; y: number }[], spec: ConnectorSketchSpec): string {
  return roughPolyline(points as { x: number; y: number }[], {
    seed: seedFor(spec.id, spec.sketchSeed),
    closed: false,
    level: spec.level,
    width: spec.width,
    asCurve: spec.curved || undefined,
    passes: spec.dashed ? 1 : undefined,
  });
}

/**
 * A sketched end marker, as SVG path data, or null when it is drawn crisp
 * (too small to sketch, or no marker).
 */
export function sketchedCap(
  cap: EndCapShape | null,
  key: 'start' | 'end',
  capSize: number,
  spec: Pick<ConnectorSketchSpec, 'id' | 'sketchSeed' | 'level' | 'width'>
): string | null {
  if (!cap || capSize < SKETCHABLE_CAP) return null;
  const seed = seedFor(spec.id + key, spec.sketchSeed);
  if (cap.circle) {
    const { x, y, radius } = cap.circle;
    const ring = Array.from({ length: 16 }, (_, i) => {
      const a = (i / 16) * Math.PI * 2;
      return { x: x + Math.cos(a) * radius, y: y + Math.sin(a) * radius };
    });
    return roughLoop(ring, { seed, level: spec.level, width: spec.width });
  }
  if (!cap.points) return null;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < cap.points.length; i += 2) pts.push({ x: cap.points[i], y: cap.points[i + 1] });
  return roughPolyline(pts, { seed, level: spec.level, width: spec.width, closed: cap.filled });
}

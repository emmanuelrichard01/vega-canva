import { describe, it, expect } from 'vitest';
import {
  capExtentPoints,
  connectorCaps,
  endCapSize,
  polylineLength,
  trimPolyline,
} from './connectorEnds';
import { connectorPoints, type Box } from './connector';

const boxes: Record<string, Box> = {
  a: { x: 0, y: 0, width: 120, height: 60 },
  b: { x: 180, y: 0, width: 120, height: 60 },
};
const boxOf = (id: string) => boxes[id] ?? null;

/** Every point in a flat list, as the distance travelled along it. */
const lengthOf = (pts: number[]) => polylineLength(pts);

describe('polylineLength', () => {
  it('adds every segment, not just the last one', () => {
    expect(polylineLength([0, 0, 30, 0, 30, 40])).toBe(70);
  });

  it('is zero for a single point', () => {
    expect(polylineLength([5, 5])).toBe(0);
  });
});

describe('trimPolyline', () => {
  it('shortens the run by exactly the inset', () => {
    const out = trimPolyline([0, 0, 100, 0], 30, false);
    expect(lengthOf(out)).toBeCloseTo(70);
    expect(out.slice(-2)).toEqual([70, 0]);
  });

  it('trims from the start when asked', () => {
    const out = trimPolyline([0, 0, 100, 0], 30, true);
    expect(out.slice(0, 2)).toEqual([30, 0]);
    expect(lengthOf(out)).toBeCloseTo(70);
  });

  it('walks back across several segments, dropping the ones it swallows', () => {
    // The bug this exists for: the old code looked only at the final segment,
    // so an inset larger than it did nothing at all.
    const out = trimPolyline([0, 0, 50, 0, 50, 50, 60, 50], 30, false);
    expect(lengthOf(out)).toBeCloseTo(80);
    // The 10-unit final leg is gone entirely; the cut lands on the vertical.
    expect(out.slice(-2)).toEqual([50, 30]);
  });

  it('trims a curved route, whose last segment is a couple of units', () => {
    // A curved connector is sampled into 24 steps, so its final segment is far
    // shorter than any marker. It was therefore never trimmed at any size, and
    // every curved connector drew its line straight through its own arrowhead.
    const curve = connectorPoints({ nodeId: 'a' }, { nodeId: 'b' }, 'curved', boxOf);
    const before = lengthOf(curve);
    const after = lengthOf(trimPolyline(curve, 16, false));
    expect(before - after).toBeCloseTo(16, 0);
  });

  it('refuses rather than returning nothing when the inset exceeds the run', () => {
    // A zero-length line is not a shorter line, it is nothing to click.
    const out = trimPolyline([0, 0, 20, 0], 500, false);
    expect(out).toEqual([0, 0, 20, 0]);
  });

  it('leaves the line alone for a zero inset', () => {
    expect(trimPolyline([0, 0, 20, 0], 0, false)).toEqual([0, 0, 20, 0]);
  });

  it('never produces a NaN', () => {
    // Coincident points have no direction to trim along, and dividing by that
    // is how a connector ends up drawn at NaN and stops being hit-testable.
    for (const pts of [[10, 10, 10, 10, 90, 10], [0, 0, 0, 0]]) {
      for (const atStart of [true, false]) {
        expect(trimPolyline(pts, 5, atStart).every(Number.isFinite)).toBe(true);
      }
    }
  });
});

describe('connectorCaps', () => {
  it('caps the marker against the run, so a big End size cannot swallow it', () => {
    const short = [0, 0, 40, 0];
    const { size } = connectorCaps(short, { start: 'none', end: 'triangle', strokeWidth: 2, scale: 4 });
    // Unclamped this is 32 — four fifths of a 40-unit connector.
    expect(size).toBeLessThanOrEqual(40 * 0.4);
    expect(size).toBeLessThan(endCapSize(2, 4));
  });

  it('leaves the marker at its asked-for size on a run with room', () => {
    const long = [0, 0, 400, 0];
    const { size } = connectorCaps(long, { start: 'none', end: 'triangle', strokeWidth: 2, scale: 4 });
    expect(size).toBe(endCapSize(2, 4));
  });

  it('measures the whole run, not the final segment', () => {
    // Same journey, two routings. The curve's last segment is ~3 units, so a
    // cap sized from it would be a tenth of what the straight run gets.
    const straight = connectorPoints({ nodeId: 'a' }, { nodeId: 'b' }, 'straight', boxOf);
    const curved = connectorPoints({ nodeId: 'a' }, { nodeId: 'b' }, 'curved', boxOf);
    const s = connectorCaps(straight, { start: 'none', end: 'arrow', strokeWidth: 2, scale: 2 }).size;
    const c = connectorCaps(curved, { start: 'none', end: 'arrow', strokeWidth: 2, scale: 2 }).size;
    expect(c).toBe(s);
  });
});

describe('capExtentPoints', () => {
  it('is empty for no marker', () => {
    expect(capExtentPoints(null)).toEqual([]);
  });

  it('gives a circle its bounding square', () => {
    const caps = connectorCaps([0, 0, 200, 0], { start: 'none', end: 'circle', strokeWidth: 2, scale: 1 });
    const pts = capExtentPoints(caps.end);
    expect(pts.length).toBe(4);
    expect(pts.every(Number.isFinite)).toBe(true);
  });

  it('reaches outside the route, which is the reason it exists', () => {
    // A horizontal connector's route is a one-unit-tall box while its
    // arrowhead is many units tall. Bounds computed from the route alone had
    // the arrow culled with its head still on screen.
    const route = [0, 0, 200, 0];
    const caps = connectorCaps(route, { start: 'none', end: 'triangle', strokeWidth: 2, scale: 4 });
    const ys = capExtentPoints(caps.end).filter((_, i) => i % 2 === 1);
    expect(Math.max(...ys.map(Math.abs))).toBeGreaterThan(1);
  });
});

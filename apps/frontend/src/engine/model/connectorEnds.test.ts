import { describe, it, expect } from 'vitest';
import {
  END_CAP_KINDS,
  END_CAP_LABELS,
  capExtentPoints,
  connectorCaps,
  endCapShape,
  endCapSize,
  polylineLength,
  terminateRun,
  trimPolyline,
  type EndCapShape,
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

describe('the head set', () => {
  it('labels every head and offers each once', () => {
    expect(new Set(END_CAP_KINDS).size).toBe(END_CAP_KINDS.length);
    expect(Object.keys(END_CAP_LABELS).sort()).toEqual([...END_CAP_KINDS].sort());
    expect(END_CAP_KINDS).toEqual(
      expect.arrayContaining(['none', 'arrow', 'open-arrow', 'triangle', 'circle', 'diamond', 'bar', 'crow-foot'])
    );
  });

  it('draws the open arrow as a chevron through the tip, not a closed triangle', () => {
    const cap = endCapShape('open-arrow', { x: 100, y: 0 }, 0, 10)!;
    expect(cap.filled).toBe(false);
    expect(cap.points).toHaveLength(6);
    // The middle point is the tip; both arms trail back from it.
    expect(cap.points!.slice(2, 4)).toEqual([100, 0]);
    expect(cap.points![0]).toBeLessThan(100);
    expect(cap.points![4]).toBeLessThan(100);
  });

  it("spreads the crow's foot against the end and meets one depth back", () => {
    const cap = endCapShape('crow-foot', { x: 100, y: 0 }, 0, 10)!;
    expect(cap.filled).toBe(false);
    const [x1, y1, x2, y2, x3, y3] = cap.points!;
    expect([x1, x3]).toEqual([100, 100]);
    expect(y1).toBeCloseTo(-y3, 9);
    expect(x2).toBe(90);
    expect(y2).toBeCloseTo(0, 9);
  });

  it('grows with the stroke it terminates', () => {
    expect(endCapSize(8)).toBeGreaterThan(endCapSize(2));
  });
});

describe('terminateRun: a head sits flush on the end of the line', () => {
  /** The furthest the painted head reaches along +x: its geometry plus half the stroke. */
  const reach = (cap: EndCapShape, sw: number) => {
    const xs = cap.circle ? [cap.circle.x + cap.circle.radius] : [];
    for (let i = 0; cap.points && i < cap.points.length; i += 2) xs.push(cap.points[i]);
    return Math.max(...xs) + sw / 2;
  };

  for (const kind of END_CAP_KINDS.filter((k) => k !== 'none')) {
    it(`${kind}: the painted tip lands on the endpoint, and the run stops under it`, () => {
      const sw = 6;
      const { run, end } = terminateRun([0, 0, 200, 0], { start: 'none', end: kind, strokeWidth: sw });
      expect(reach(end!, sw)).toBeCloseTo(200, 6);
      // The run's own round cap must not poke out past the head either.
      expect(run[run.length - 2] + sw / 2).toBeLessThanOrEqual(200 + 1e-6);
    });
  }

  it('leaves a line without heads exactly as long as it was', () => {
    const { run } = terminateRun([0, 0, 200, 0], { start: 'none', end: 'none', strokeWidth: 6 });
    expect(run).toEqual([0, 0, 200, 0]);
  });

  it('lands a connector head flush on the endpoint, half a stroke inside it', () => {
    const points = [0, 0, 200, 0];
    const { end } = connectorCaps(points, { start: 'none', end: 'triangle', strokeWidth: 6 });
    const tip = end!.points!;
    // The geometric tip sits half a stroke short of the endpoint, so the painted edge touches it.
    expect(tip[0]).toBeCloseTo(197);
    expect(tip[1]).toBeCloseTo(0);
    // And the run is trimmed under the head and that half stroke.
    expect(end!.inset).toBeCloseTo(endCapShape('triangle', { x: 197, y: 0 }, 0, endCapSize(6))!.inset + 3);
  });

  it('agrees with terminateRun about where the head is', () => {
    const points = [0, 0, 120, 80, 300, 80];
    const spec = { start: 'arrow' as const, end: 'diamond' as const, strokeWidth: 4 };
    const caps = connectorCaps(points, spec);
    const run = terminateRun(points, spec);
    expect(caps.end!.points!.map((n) => Math.round(n * 100))).toEqual(run.end!.points!.map((n) => Math.round(n * 100)));
    expect(caps.start!.points![0]).toBeCloseTo(run.start!.points![0]);
  });
});

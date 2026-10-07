import { describe, expect, it } from 'vitest';
import { CHANNEL_GAP, adjustNetwork, findHops, lineOffsets, spreadChannels, type NetworkRoute } from './network';
import { applyNudges, clampNudge, connectorPathData, nudgeKey } from './pathOps';
import { normalizeNode } from '../../document/normalize';
import type { Pt } from './geometry';

const route = (id: string, points: Pt[], extra: Partial<NetworkRoute> = {}): NetworkRoute => ({
  id,
  points,
  orthogonal: true,
  zIndex: 0,
  jumps: 'arc',
  strokeWidth: 2,
  ...extra,
});

describe('channel spreading', () => {
  it('fans out legs from different connectors that run down one channel', () => {
    const a = route('a', [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 200 }, { x: 220, y: 200 }]);
    const b = route('b', [{ x: 0, y: 40 }, { x: 40, y: 40 }, { x: 40, y: 100 }, { x: 180, y: 100 }, { x: 180, y: 220 }, { x: 220, y: 220 }]);
    const [pa, pb] = spreadChannels([a, b]);
    // The shared horizontal run at y = 100 becomes two lanes, a gap apart.
    expect(Math.abs(pa[2].y - pb[2].y)).toBe(CHANNEL_GAP);
    expect((pa[2].y + pb[2].y) / 2).toBe(100);
  });

  it('gives the same lanes whatever order the routes arrive in', () => {
    const a = route('a', [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 200 }, { x: 220, y: 200 }]);
    const b = route('b', [{ x: 0, y: 40 }, { x: 40, y: 40 }, { x: 40, y: 100 }, { x: 180, y: 100 }, { x: 180, y: 220 }, { x: 220, y: 220 }]);
    const forward = spreadChannels([a, b]);
    const backward = spreadChannels([b, a]);
    expect(backward[1]).toEqual(forward[0]);
    expect(backward[0]).toEqual(forward[1]);
  });

  it('leaves a lone leg on its line', () => {
    const segs = [{ id: 'a', seg: 1, axis: 'h' as const, coord: 10, lo: 0, hi: 100, side: 0 }];
    expect(lineOffsets(segs)).toEqual([0]);
  });
});

describe('line jumps', () => {
  const horizontal = (id: string, z: number, jumps: NetworkRoute['jumps'] = 'arc') =>
    route(id, [{ x: 0, y: 50 }, { x: 200, y: 50 }], { zIndex: z, jumps, orthogonal: false });
  const vertical = (id: string, z: number, jumps: NetworkRoute['jumps'] = 'arc') =>
    route(id, [{ x: 100, y: 0 }, { x: 100, y: 100 }], { zIndex: z, jumps, orthogonal: false });

  it('the upper line hops over the lower one, once', () => {
    const hops = findHops([horizontal('h', 2), vertical('v', 1)], [horizontal('h', 2).points, vertical('v', 1).points]);
    expect(hops[0]).toEqual([{ seg: 0, at: 100, kind: 'arc' }]);
    expect(hops[1]).toEqual([]);
  });

  it('with gaps the lower line breaks instead', () => {
    const routes = [horizontal('h', 2, 'gap'), vertical('v', 1)];
    const hops = findHops(routes, routes.map((r) => r.points));
    expect(hops[0]).toEqual([]);
    expect(hops[1][0]).toMatchObject({ seg: 0, at: 50, kind: 'gap' });
  });

  it('draws a hop as an arc in the path', () => {
    const [adjusted] = adjustNetwork([horizontal('h', 2), vertical('v', 1)]);
    const d = connectorPathData(adjusted.points, { hops: adjusted.hops, hopRadius: 6 });
    expect(d).toMatch(/A6 6 0 0 1 106 50/);
  });

  it('curves take no part in jumps', () => {
    const routes = [horizontal('h', 2), route('v', [...vertical('v', 1).points], { curved: true, orthogonal: false })];
    const hops = findHops(routes, routes.map((r) => r.points));
    expect(hops[0]).toEqual([]);
  });
});

describe('segment nudges', () => {
  // Legs: 0 the start's stub, 1 vertical at x=50, 2 the end's run.
  const elbow: Pt[] = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 100 }, { x: 200, y: 100 }];

  it('moves the leg its key names, the legs either side stretching to meet it', () => {
    const out = applyNudges(elbow, [{ axis: 'v', at: 50, offset: 30 }]);
    expect(out.points).toEqual([{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 100 }, { x: 200, y: 100 }]);
    expect(out.legs[1]).toEqual({ axis: 'v', at: 50, nudge: 30 });
  });

  it('follows its leg to a new index when the route gains legs before it', () => {
    // The same vertical leg at x=50, now the third segment.
    const longer: Pt[] = [{ x: 0, y: -40 }, { x: 20, y: -40 }, { x: 20, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 100 }, { x: 200, y: 100 }];
    const out = applyNudges(longer, [{ axis: 'v', at: 50, offset: 30 }]);
    expect(out.points[3]).toEqual({ x: 80, y: 0 });
    expect(out.points[4]).toEqual({ x: 80, y: 100 });
    expect(out.points[1]).toEqual({ x: 20, y: -40 });
  });

  it('drops a nudge whose leg is gone, rather than moving whatever leg now has its index', () => {
    const moved: Pt[] = [{ x: 0, y: 0 }, { x: 70, y: 0 }, { x: 70, y: 100 }, { x: 200, y: 100 }];
    expect(applyNudges(moved, [{ axis: 'v', at: 50, offset: 30 }]).points).toEqual(moved);
    expect(applyNudges(elbow, [{ axis: 'h', at: 50, offset: 30 }]).points).toEqual(elbow);
  });

  it('never moves the first or last leg, which belong to the ports', () => {
    expect(applyNudges(elbow, [{ axis: 'h', at: 0, offset: 30 }, { axis: 'h', at: 100, offset: 30 }]).points).toEqual(elbow);
  });

  it('stops a nudged leg at the edge of an obstacle instead of running into it', () => {
    const block = { minX: 100, minY: -50, maxX: 160, maxY: 150 };
    const out = applyNudges(elbow, [{ axis: 'v', at: 50, offset: 90 }], [block]);
    expect(out.points[1].x).toBe(100);
    expect(out.legs[1]!.nudge).toBe(50);
    // The way it came from is free.
    expect(applyNudges(elbow, [{ axis: 'v', at: 50, offset: -30 }], [block]).points[1].x).toBe(20);
  });

  it('keeps the stretched legs out of an obstacle too', () => {
    // On the start's stub line, past its end: lengthening the stub would run into it.
    const block = { minX: 70, minY: -30, maxX: 120, maxY: 10 };
    const out = applyNudges(elbow, [{ axis: 'v', at: 50, offset: 40 }], [block]);
    expect(out.points[1].x).toBe(70);
    expect(clampNudge(elbow, 1, 40, [block])).toBe(20);
  });

  it('reads one key per leg, so concurrent nudges of different legs both survive', () => {
    const raw = {
      id: 'c', type: 'connector', from: { nodeId: 'a' }, to: { nodeId: 'b' },
      // What a copy of the node carries...
      nudges: [{ axis: 'v', at: 50, offset: 10 }, { axis: 'h', at: 100, offset: 5 }],
      // ...and two people's edits, each under its own leg's key.
      [nudgeKey({ axis: 'v', at: 50 })]: 30,
      [nudgeKey({ axis: 'h', at: 200 })]: -12,
      // Zero clears a leg, the copied list's entry included.
      [nudgeKey({ axis: 'h', at: 100 })]: 0,
    };
    const node = normalizeNode(raw) as unknown as { nudges: unknown };
    expect(node.nudges).toEqual([
      { axis: 'h', at: 200, offset: -12 },
      { axis: 'v', at: 50, offset: 30 },
    ]);
  });
});

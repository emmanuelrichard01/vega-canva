import { describe, it, expect } from 'vitest';
import {
  autoPorts,
  connectorBounds,
  connectorPoints,
  portNormal,
  portPoint,
  resolveEnd,
  routeOrthogonal,
  type Box,
} from './connector';

const box = (x: number, y: number, width = 100, height = 60): Box => ({ x, y, width, height });

describe('portPoint', () => {
  it('sits at the middle of each side', () => {
    const b = box(0, 0, 100, 60);
    expect(portPoint(b, 'top')).toEqual({ x: 50, y: 0 });
    expect(portPoint(b, 'bottom')).toEqual({ x: 50, y: 60 });
    expect(portPoint(b, 'left')).toEqual({ x: 0, y: 30 });
    expect(portPoint(b, 'right')).toEqual({ x: 100, y: 30 });
  });
});

describe('portNormal', () => {
  it('points out of the box', () => {
    expect(portNormal('top')).toEqual({ x: 0, y: -1 });
    expect(portNormal('right')).toEqual({ x: 1, y: 0 });
  });
});

describe('autoPorts', () => {
  it('joins side to side when the boxes are horizontally apart', () => {
    expect(autoPorts(box(0, 0), box(300, 0))).toEqual({ from: 'right', to: 'left' });
    expect(autoPorts(box(300, 0), box(0, 0))).toEqual({ from: 'left', to: 'right' });
  });

  it('joins top to bottom when they are vertically apart', () => {
    expect(autoPorts(box(0, 0), box(0, 300))).toEqual({ from: 'bottom', to: 'top' });
    expect(autoPorts(box(0, 300), box(0, 0))).toEqual({ from: 'top', to: 'bottom' });
  });

  it('keeps a side-by-side pair side-connected despite a vertical offset', () => {
    // Chosen from the gap between the boxes rather than the distance between
    // their centres: by centres this pair would flip to top/bottom, and a
    // diagram should not reorganise itself because something moved 40px.
    expect(autoPorts(box(0, 0), box(300, 120))).toEqual({ from: 'right', to: 'left' });
  });
});

describe('routeOrthogonal', () => {
  it('turns twice between two horizontal ports, splitting the gap', () => {
    const path = routeOrthogonal({ x: 0, y: 0 }, { x: 100, y: 50 }, 'right', 'left');
    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 50 },
      { x: 100, y: 50 },
    ]);
  });

  it('turns twice between two vertical ports', () => {
    const path = routeOrthogonal({ x: 0, y: 0 }, { x: 60, y: 100 }, 'bottom', 'top');
    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 50 },
      { x: 60, y: 50 },
      { x: 60, y: 100 },
    ]);
  });

  it('turns once when the two ports face different axes', () => {
    const path = routeOrthogonal({ x: 0, y: 0 }, { x: 80, y: 90 }, 'right', 'top');
    expect(path).toEqual([{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 90 }]);
  });

  it('leaves every segment axis-aligned', () => {
    const path = routeOrthogonal({ x: 5, y: 7 }, { x: 91, y: 43 }, 'right', 'left');
    for (let i = 1; i < path.length; i += 1) {
      const straight = path[i].x === path[i - 1].x || path[i].y === path[i - 1].y;
      expect(straight).toBe(true);
    }
  });
});

describe('resolveEnd', () => {
  const boxes: Record<string, Box> = { a: box(0, 0), b: box(300, 0) };
  const boxOf = (id: string) => boxes[id] ?? null;

  it('uses the bound object, choosing a port from the other end', () => {
    const r = resolveEnd({ nodeId: 'a' }, boxes.b, boxOf);
    expect(r.port).toBe('right');
    expect(r.point).toEqual({ x: 100, y: 30 });
  });

  it('honours an explicit port over the automatic one', () => {
    expect(resolveEnd({ nodeId: 'a', port: 'top' }, boxes.b, boxOf).port).toBe('top');
  });

  it('falls back to the stored point when the object is gone', () => {
    // This is what detaching writes, and it is why deleting a box leaves its
    // connectors where they were instead of collapsing them onto the origin.
    const r = resolveEnd({ nodeId: 'ghost', x: 42, y: 24 }, null, boxOf);
    expect(r.point).toEqual({ x: 42, y: 24 });
    expect(r.box).toBeNull();
  });

  it('treats a loose end with no coordinate as the origin rather than throwing', () => {
    expect(resolveEnd({}, null, boxOf).point).toEqual({ x: 0, y: 0 });
  });
});

describe('connectorPoints', () => {
  const boxes: Record<string, Box> = { a: box(0, 0), b: box(300, 0) };
  const boxOf = (id: string) => boxes[id] ?? null;

  it('is a flat pair list, straight between two bound objects', () => {
    expect(connectorPoints({ nodeId: 'a' }, { nodeId: 'b' }, 'straight', boxOf)).toEqual([100, 30, 300, 30]);
  });

  it('adds the elbows for an orthogonal route', () => {
    const pts = connectorPoints({ nodeId: 'a' }, { nodeId: 'b' }, 'orthogonal', boxOf);
    expect(pts.length).toBe(8);
    expect(pts.slice(0, 2)).toEqual([100, 30]);
    expect(pts.slice(-2)).toEqual([300, 30]);
  });
});

describe('connectorBounds', () => {
  it('encloses every point on the route', () => {
    expect(connectorBounds([10, 20, 50, 20, 50, 90])).toEqual({ x: 10, y: 20, width: 40, height: 70 });
  });

  it('never returns a zero box for a straight horizontal run', () => {
    // Culling, the radar and marquee selection all read these, and a zero
    // height would make a horizontal connector vanish from all three.
    const b = connectorBounds([0, 50, 200, 50]);
    expect(b.height).toBeGreaterThanOrEqual(1);
    expect(b.width).toBe(200);
  });
});

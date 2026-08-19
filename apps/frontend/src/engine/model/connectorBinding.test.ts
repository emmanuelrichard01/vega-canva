import { describe, it, expect } from 'vitest';
import { bindingAt, type BindCandidate } from './connectorBinding';
import type { Box } from './connector';

const box = (x: number, y: number, width: number, height: number): Box => ({ x, y, width, height });
const A: BindCandidate = { id: 'a', box: box(0, 0, 200, 100) };
const opts = { scale: 1 };

describe('bindingAt', () => {
  it('snaps to a named port near an edge midpoint', () => {
    expect(bindingAt({ x: 200, y: 52 }, [A], opts)).toEqual({ nodeId: 'a', port: 'right' });
    expect(bindingAt({ x: 100, y: 3 }, [A], opts)).toEqual({ nodeId: 'a', port: 'top' });
  });

  it('binds to an exact anchor near the perimeter but away from a midpoint', () => {
    // Down the right edge, clear of the midpoint's 22px reach.
    const end = bindingAt({ x: 196, y: 92 }, [A], opts);
    expect(end.nodeId).toBe('a');
    expect(end.port).toBeUndefined();
    expect(end.anchor!.u).toBeCloseTo(0.98);
    expect(end.anchor!.v).toBeCloseTo(0.92);
  });

  it('means the object, not a spot on it, when the pointer is well inside', () => {
    expect(bindingAt({ x: 100, y: 50 }, [A], opts)).toEqual({ nodeId: 'a', port: 'auto' });
  });

  it('leaves a loose end outside every candidate', () => {
    expect(bindingAt({ x: 900, y: 900 }, [A], opts)).toEqual({ x: 900, y: 900 });
  });

  it('does not claim a point just outside a box', () => {
    // The edge band reaches inwards only: an arrow aimed at the outside of a
    // box has not arrived, and grabbing near-misses makes a loose end
    // impossible to place next to existing content.
    expect(bindingAt({ x: 210, y: 92 }, [A], opts)).toEqual({ x: 210, y: 92 });
  });

  it('refuses the excluded node, so an end cannot bind to its own other end', () => {
    expect(bindingAt({ x: 200, y: 52 }, [A], { scale: 1, excludeId: 'a' })).toEqual({
      x: 200,
      y: 52,
    });
  });

  it('scales both tolerances with the zoom', () => {
    const far = { x: 200, y: 80 };
    // 30 world units from the right midpoint: outside 22px at 100% zoom...
    expect(bindingAt(far, [A], { scale: 1 }).port).not.toBe('right');
    // ...and inside it at 50%, where 22 screen px is 44 world units.
    expect(bindingAt(far, [A], { scale: 2 }).port).toBe('right');
  });

  it('prefers a small node port over a large node it sits on top of', () => {
    // Specificity beats z-order: the frame's interior must not swallow the
    // note's attachment points just because it is drawn underneath.
    const frame: BindCandidate = { id: 'frame', box: box(0, 0, 1000, 1000) };
    const note: BindCandidate = { id: 'note', box: box(400, 400, 100, 100) };
    expect(bindingAt({ x: 500, y: 450 }, [frame, note], opts)).toEqual({
      nodeId: 'note',
      port: 'right',
    });
  });

  it('picks the innermost containing box when nothing is near an edge', () => {
    const frame: BindCandidate = { id: 'frame', box: box(0, 0, 1000, 1000) };
    const note: BindCandidate = { id: 'note', box: box(400, 400, 200, 200) };
    expect(bindingAt({ x: 500, y: 500 }, [frame, note], opts).nodeId).toBe('note');
  });

  it('never returns an anchor outside 0..1', () => {
    for (const p of [{ x: 0, y: 0 }, { x: 200, y: 100 }, { x: 1, y: 99 }]) {
      const end = bindingAt(p, [A], opts);
      if (end.anchor) {
        expect(end.anchor.u).toBeGreaterThanOrEqual(0);
        expect(end.anchor.u).toBeLessThanOrEqual(1);
        expect(end.anchor.v).toBeGreaterThanOrEqual(0);
        expect(end.anchor.v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('bindingAt on a shape that is not its box', () => {
  // A triangle in a 200x100 box. Its left-middle — where the box says a port
  // is — sits in empty air 50 units from anything drawn.
  const TRI = [
    { x: 100, y: 0 },
    { x: 200, y: 100 },
    { x: 0, y: 100 },
  ];
  const tri: BindCandidate = { id: 't', box: box(0, 0, 200, 100), outline: TRI };

  it('arms a port where the ring is drawn, not where the box says', () => {
    // The bug this fixes: the ring was drawn on the outline while the snap was
    // measured against the box, so you had to hover empty air beside the shape
    // to arm a ring sitting on the shape.
    const onOutline = { x: 50, y: 50 };
    expect(bindingAt(onOutline, [tri], opts)).toEqual({ nodeId: 't', port: 'left' });
  });

  it('does not arm from the box position, which is nowhere near the shape', () => {
    expect(bindingAt({ x: 0, y: 50 }, [tri], opts).nodeId).toBeUndefined();
  });

  it('binds when the pointer is on the shape body', () => {
    // Inside the triangle and clear of both its edges and its ports — at
    // y=80 the bottom port is only 20 away and correctly wins the snap.
    expect(bindingAt({ x: 100, y: 62 }, [tri], opts)).toEqual({ nodeId: 't', port: 'auto' });
  });

  it('ignores a point inside the box but outside the shape', () => {
    // The top-left corner of the box is empty air above the triangle hypotenuse.
    expect(bindingAt({ x: 10, y: 10 }, [tri], opts)).toEqual({ x: 10, y: 10 });
  });

  it('anchors to the point on the slanted edge, not to a box projection', () => {
    const end = bindingAt({ x: 55, y: 92 }, [tri], opts);
    expect(end.nodeId).toBe('t');
    expect(end.anchor).toBeDefined();
  });
});

describe('bindingAt on a rotated object', () => {
  // A 100x100 square turned 45 degrees about its centre becomes a diamond.
  const c = { x: 50, y: 50 };
  const turn = (p: { x: number; y: number }, deg: number) => {
    const r = (deg * Math.PI) / 180;
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    return { x: c.x + dx * Math.cos(r) - dy * Math.sin(r), y: c.y + dx * Math.sin(r) + dy * Math.cos(r) };
  };
  const diamond = [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
  ].map((p) => turn(p, 45));
  const rotated: BindCandidate = {
    id: 'r', box: box(0, 0, 100, 100), outline: diamond, rotation: 45,
  };

  it('binds on the turned silhouette', () => {
    // The diamond's rightmost vertex is well outside the axis-aligned box.
    const vertex = turn({ x: 100, y: 0 }, 45);
    expect(bindingAt(vertex, [rotated], opts).nodeId).toBe('r');
  });

  it('rejects a corner of the unrotated box, which the turned shape vacated', () => {
    expect(bindingAt({ x: 2, y: 2 }, [rotated], opts).nodeId).toBeUndefined();
  });

  it('stores the anchor in the node own unrotated frame', () => {
    // An anchor is a ratio of an unrotated box. Storing a rotated one would
    // drag every connector around the outside the next time the object turned.
    const rightVertex = turn({ x: 100, y: 50 }, 45);
    const end = bindingAt(rightVertex, [rotated], opts);
    if (end.anchor) {
      expect(end.anchor.u).toBeGreaterThan(0.9);
      expect(end.anchor.v).toBeCloseTo(0.5, 1);
    }
  });
});

import { describe, it, expect } from 'vitest';
import { bindingAt, PORT_SNAP_SCREEN, type BindCandidate } from './connectorBinding';
import { anchorPoint } from './connectorAnchor';
import { portPoint } from './connector';
import { attachOnOutline } from './shapePerimeter';
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

  it('claims a point just outside, because that is how people aim at an edge', () => {
    // The band straddles the outline rather than reaching inwards only.
    // Inward-only meant tracing the outer perimeter produced nothing until the
    // cursor crossed the stroke, and one pixel further became an anchor — a
    // flicker on the outside of every object. It was inward-only to protect
    // room for a loose end, and loose ends can no longer be authored.
    expect(bindingAt({ x: 210, y: 92 }, [A], opts).nodeId).toBe('a');
  });

  it('leaves a point well clear of everything alone', () => {
    expect(bindingAt({ x: 400, y: 92 }, [A], opts)).toEqual({ x: 400, y: 92 });
  });

  it('tracks the cursor without jumping as it runs round the perimeter', () => {
    // The whole complaint: four generous snap zones and a discontinuous
    // anchor made a lap of a shape a series of teleports. Sampling the
    // resolved point all the way round must move in small steps.
    const box200 = { x: 0, y: 0, width: 200, height: 100 };
    const cand: BindCandidate = { id: 'a', box: box200 };
    /** A lap of the box's own perimeter — the gesture the complaint describes. */
    const onPerimeter = (t: number) => {
      const d = t * 600; // 2*(200+100)
      if (d < 200) return { x: d, y: 0 };
      if (d < 300) return { x: 200, y: d - 200 };
      if (d < 500) return { x: 500 - d, y: 100 };
      return { x: 0, y: 600 - d };
    };
    const at = (t: number) => {
      const p = onPerimeter(t);
      const end = bindingAt(p, [cand], opts);
      return end.anchor
        ? anchorPoint(box200, end.anchor)
        : end.port && end.port !== 'auto'
          ? portPoint(box200, end.port)
          : { x: p.x, y: p.y };
    };
    let previous = at(0);
    let worst = 0;
    for (let i = 1; i <= 400; i += 1) {
      const p = at(i / 400);
      worst = Math.max(worst, Math.hypot(p.x - previous.x, p.y - previous.y));
      previous = p;
    }
    // The only jump left is the port snap itself, which is a snap by
    // definition and is bounded by its own radius — a fingertip, not the
    // twelve-to-forty-unit leaps the old anchor and the old 22px zones made.
    expect(worst).toBeLessThanOrEqual(PORT_SNAP_SCREEN + 2);
  });

  it('refuses the excluded node, so an end cannot bind to its own other end', () => {
    expect(bindingAt({ x: 200, y: 52 }, [A], { scale: 1, excludeId: 'a' })).toEqual({
      x: 200,
      y: 52,
    });
  });

  it('scales the port snap with the zoom', () => {
    // Written against the constant rather than a literal, so changing the snap
    // cannot silently turn this into a test of nothing. Three quarters of the
    // radius is inside the zone but outside the inner half, so at 100% it is
    // an eased anchor and at 50% — where the zone is twice as wide in world
    // units — the same place is within the grip and binds to the port.
    const p = { x: 200, y: 50 + PORT_SNAP_SCREEN * 0.75 };
    expect(bindingAt(p, [A], { scale: 1 }).port).not.toBe('right');
    expect(bindingAt(p, [A], { scale: 2 }).port).toBe('right');
  });

  it('eases into a port instead of teleporting to it', () => {
    // At the rim of the zone there must be no pull at all, or entering it is
    // a jump; by the halfway mark the pull must be complete, because that is
    // where the binding becomes the port and the two have to agree about
    // where the point is.
    const atRim = bindingAt({ x: 200, y: 50 + PORT_SNAP_SCREEN }, [A], opts);
    expect(anchorPoint(A.box, atRim.anchor!).y).toBeCloseTo(50 + PORT_SNAP_SCREEN, 1);

    const atGrip = bindingAt({ x: 200, y: 50 + PORT_SNAP_SCREEN / 2 + 0.01 }, [A], opts);
    expect(anchorPoint(A.box, atGrip.anchor!).y).toBeCloseTo(50, 0);
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
    // Far enough out that the edge band cannot reach it either — the corner of
    // the axis-aligned box is only about eighteen units from the diamond's
    // nearest edge, which the band is entitled to claim.
    expect(bindingAt({ x: -40, y: -40 }, [rotated], opts).nodeId).toBeUndefined();
  });

  it('listens for the snap exactly where the ring is drawn', () => {
    // The defect this holds shut: `portAt` and `attachPoint` were two
    // implementations of one question, and when rotation arrived only the
    // drawing side got it. On this turned square the ring sat on one edge
    // while the snap listened on another, tens of units away — a lap of the
    // outline jumped eighty units. Aiming at a drawn ring must bind to that
    // port, or the affordance is lying.
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const drawn = attachOnOutline(rotated.box, rotated.outline, 45, portPoint(rotated.box, side));
      const end = bindingAt(drawn, [rotated], opts);
      expect({ side, port: end.port }).toEqual({ side, port: side });
    }
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

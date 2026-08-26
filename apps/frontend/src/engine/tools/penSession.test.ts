import { describe, expect, it } from 'vitest';
import {
  CLOSE_RADIUS_SCREEN,
  commitPath,
  constrainToAngle,
  isClosable,
  isHandleDrag,
  previewGeometry,
  pullHandle,
  retractOutgoing,
} from './penSession';
import { pathData, type Anchor } from '../model/pathGeometry';

describe('pullHandle', () => {
  it('mirrors the handle, so the curve runs through the anchor unkinked', () => {
    const out = pullHandle({ x: 100, y: 100 }, { x: 140, y: 80 }, false);
    expect(out).toEqual({ x: 100, y: 100, outX: 140, outY: 80, inX: 60, inY: 120 });
  });

  it('leaves the incoming handle alone when the pair is broken', () => {
    /**
     * The gesture the tool never had. With the incoming handle *defined* as the
     * mirror of the outgoing one, a cusp was not something the tool refused to
     * draw -- it was something the format could not hold.
     */
    const arrived: Anchor = { x: 100, y: 100, inX: 60, inY: 100 };
    const out = pullHandle(arrived, { x: 100, y: 40 }, true);
    expect(out).toEqual({ x: 100, y: 100, inX: 60, inY: 100, outX: 100, outY: 40 });
  });

  it('gives a broken anchor with nothing arriving only an outgoing handle', () => {
    expect(pullHandle({ x: 0, y: 0 }, { x: 10, y: 0 }, true)).toEqual({
      x: 0, y: 0, outX: 10, outY: 0,
    });
  });
});

describe('isHandleDrag', () => {
  it('reads a small wobble as a click placing a corner', () => {
    expect(isHandleDrag({ x: 0, y: 0 }, { x: 2, y: 0 }, 1)).toBe(false);
  });

  it('means the same distance to the hand at every zoom', () => {
    // Two world units is a pull at 800% and a tremor at 10%.
    expect(isHandleDrag({ x: 0, y: 0 }, { x: 2, y: 0 }, 8)).toBe(true);
    expect(isHandleDrag({ x: 0, y: 0 }, { x: 2, y: 0 }, 0.1)).toBe(false);
  });
});

describe('retractOutgoing', () => {
  it('leaves the curve arriving bent and leaving straight', () => {
    expect(retractOutgoing({ x: 5, y: 5, inX: 0, inY: 5, outX: 10, outY: 5 })).toEqual({
      x: 5, y: 5, inX: 0, inY: 5,
    });
  });

  it('does nothing to an anchor that had no outgoing handle', () => {
    expect(retractOutgoing({ x: 5, y: 5 })).toEqual({ x: 5, y: 5 });
  });
});

describe('previewGeometry', () => {
  const anchors: Anchor[] = [{ x: 0, y: 0, outX: 20, outY: 0 }, { x: 50, y: 50 }];

  it('builds the rubber band from the same function that builds the path', () => {
    /**
     * The preview and the commit used to be two separate string builders over
     * the same anchors, which is how what you draw against and what you get
     * drift apart. The band is a real anchor at the pointer instead.
     */
    const preview = previewGeometry(anchors, { x: 90, y: 10 }, false);
    const committed = commitPath([...anchors, { x: 90, y: 10 }], false)!;
    // Same shape, only moved into the node's own space.
    expect(pathData(preview)).toBe(
      pathData({
        ...committed.geometry,
        segments: committed.geometry.segments.map((s) => ({
          ...s,
          x: s.x + committed.x,
          y: s.y + committed.y,
          ...(s.cp1x !== undefined ? { cp1x: s.cp1x + committed.x, cp1y: s.cp1y! + committed.y } : null),
          ...(s.cp2x !== undefined ? { cp2x: s.cp2x + committed.x, cp2y: s.cp2y! + committed.y } : null),
        })),
      })
    );
  });

  it('drops the band once the next click would close the path', () => {
    // A band running to a point that is already an anchor says the opposite of
    // what is about to happen.
    const closing = previewGeometry(anchors, { x: 1, y: 1 }, true);
    expect(closing.segments).toHaveLength(2);
    expect(closing.closed).toBe(true);
  });

  it('shows a lone anchor before the pointer has anywhere to go', () => {
    expect(previewGeometry([{ x: 3, y: 4 }], null, false).segments).toEqual([{ x: 3, y: 4 }]);
  });
});

describe('commitPath', () => {
  it('measures the ink, not the control hull', () => {
    /**
     * A handle lies outside the curve it bends. Taking bounds over the anchors
     * *and their handles*, as the tool used to, stored every curved path with a
     * box bigger than its own shape -- and that box is what marquee selection,
     * the eraser, snapping and every later resize all read.
     */
    const arc: Anchor[] = [
      { x: 0, y: 0, outX: 0, outY: -100 },
      { x: 100, y: 0, inX: 100, inY: -100 },
    ];
    const out = commitPath(arc, false)!;
    // The handles reach y = -100; the curve only reaches -75.
    expect(out.height).toBeCloseTo(75, 1);
    expect(out.y).toBeCloseTo(-75, 1);
    expect(out.width).toBeCloseTo(100, 6);
  });

  it('puts the geometry in the node\'s own space, starting at the box', () => {
    const out = commitPath([{ x: 40, y: 60 }, { x: 90, y: 60 }], false)!;
    expect(out.x).toBe(40);
    expect(out.y).toBe(60);
    expect(out.geometry.segments[0]).toEqual({ x: 0, y: 0 });
    expect(out.geometry.segments[1]).toMatchObject({ x: 50, y: 0 });
  });

  it('floors a straight run at one unit, so it can still be clicked', () => {
    expect(commitPath([{ x: 0, y: 10 }, { x: 100, y: 10 }], false)!.height).toBe(1);
  });

  it('closes the ring when asked, including the curve home', () => {
    const out = commitPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], true)!;
    expect(out.geometry.closed).toBe(true);
  });

  it('refuses a single point, which is not a path', () => {
    // Committing one would leave a zero-area object only the layers panel
    // could find.
    expect(commitPath([{ x: 0, y: 0 }], false)).toBeNull();
    expect(commitPath([], false)).toBeNull();
  });
});

describe('constrainToAngle', () => {
  it('snaps a near-horizontal run flat', () => {
    const p = constrainToAngle({ x: 0, y: 0 }, { x: 100, y: 6 });
    expect(p.y).toBeCloseTo(0, 6);
    expect(p.x).toBeCloseTo(Math.hypot(100, 6), 6);
  });

  it('keeps a diagonal on the diagonal', () => {
    const p = constrainToAngle({ x: 0, y: 0 }, { x: 50, y: 46 });
    expect(p.x).toBeCloseTo(p.y, 6);
  });

  it('holds the distance, so the segment does not shorten as it straightens', () => {
    const p = constrainToAngle({ x: 10, y: 10 }, { x: 10, y: 90 });
    expect(Math.hypot(p.x - 10, p.y - 10)).toBeCloseTo(80, 6);
  });
});

describe('isClosable', () => {
  const anchors: Anchor[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }];

  it('is a constant target on the screen, however far the canvas is zoomed', () => {
    // One world distance, judged at two zooms. Twenty units is five pixels of
    // screen at 25% and forty at 200%, so the same pointer is on the target in
    // one and nowhere near it in the other.
    expect(CLOSE_RADIUS_SCREEN).toBe(9);
    expect(isClosable(anchors, { x: 20, y: 0 }, 0.25)).toBe(true);
    expect(isClosable(anchors, { x: 20, y: 0 }, 2)).toBe(false);
  });

  it('will not close a path of one anchor onto itself', () => {
    expect(isClosable([{ x: 0, y: 0 }], { x: 0, y: 0 }, 1)).toBe(false);
  });
});

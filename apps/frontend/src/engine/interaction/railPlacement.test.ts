import { describe, expect, it } from 'vitest';
import { inflate, placeRail, selectionHull, type Bounds, type Rect } from './railPlacement';

/** A 1000 × 800 window with the panels and the dock taken out of it. */
const BOUNDS: Bounds = { top: 64, right: 712, bottom: 724, left: 288 };
const RAIL = { width: 300, height: 40 };
/** The same window stretched wide, so there is a column free beside a tall object. */
const WIDE: Bounds = { top: 64, right: 1600, bottom: 724, left: 288 };
const STANDOFF = 14;

/** The rail's own rect, from the anchor and the side it hangs by. */
const railRect = (p: ReturnType<typeof placeRail>): Rect => {
  const { width: w, height: h } = RAIL;
  switch (p.side) {
    case 'top': return { x: p.x - w / 2, y: p.y - h, width: w, height: h };
    case 'bottom': return { x: p.x - w / 2, y: p.y, width: w, height: h };
    case 'left': return { x: p.x - w, y: p.y - h / 2, width: w, height: h };
    default: return { x: p.x, y: p.y - h / 2, width: w, height: h };
  }
};

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('selectionHull', () => {
  it('is the box every object fits inside', () => {
    expect(selectionHull([
      { x: 10, y: 20, width: 30, height: 40 },
      { x: 50, y: 0, width: 10, height: 10 },
    ])).toEqual({ x: 10, y: 0, width: 50, height: 60 });
  });

  it('grows a turned square to what it actually covers', () => {
    /**
     * The bug the hull exists for: a square turned 45° reaches past its own
     * corners on every side, so a rail placed against the unrotated box sat
     * inside the shape.
     */
    const hull = selectionHull([{ x: 0, y: 0, width: 100, height: 100, rotation: 45 }])!;
    const diagonal = Math.sqrt(2) * 100;
    expect(hull.width).toBeCloseTo(diagonal, 6);
    expect(hull.height).toBeCloseTo(diagonal, 6);
    // Still centred where it was.
    expect(hull.x + hull.width / 2).toBeCloseTo(50, 6);
  });

  it('leaves a square turned a right angle exactly where it was', () => {
    const hull = selectionHull([{ x: 5, y: 5, width: 20, height: 20, rotation: 90 }])!;
    expect(hull.x).toBeCloseTo(5, 6);
    expect(hull.width).toBeCloseTo(20, 6);
  });

  it('swaps the axes of a turned rectangle', () => {
    const hull = selectionHull([{ x: 0, y: 0, width: 100, height: 20, rotation: 90 }])!;
    expect(hull.width).toBeCloseTo(20, 6);
    expect(hull.height).toBeCloseTo(100, 6);
  });

  it('is null for nothing, rather than an empty box at the origin', () => {
    expect(selectionHull([])).toBeNull();
  });

  it('ignores an object with no finite position', () => {
    expect(selectionHull([
      { x: NaN, y: 0, width: 10, height: 10 },
      { x: 0, y: 0, width: 10, height: 10 },
    ])).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  });
});

describe('inflate', () => {
  it('grows a rect on every side, so the handles count as part of the object', () => {
    expect(inflate({ x: 10, y: 10, width: 20, height: 20 }, 6)).toEqual({
      x: 4, y: 4, width: 32, height: 32,
    });
  });
});

describe('placeRail', () => {
  it('sits above by preference', () => {
    const subject = { x: 400, y: 300, width: 120, height: 90 };
    const p = placeRail(subject, RAIL, BOUNDS, STANDOFF);
    expect(p.side).toBe('top');
    expect(p.clear).toBe(true);
    // Its bottom edge is exactly the standoff clear of the subject's top.
    expect(p.y).toBe(300 - STANDOFF);
    expect(p.x).toBe(460);
  });

  it('flips below when the object is against the top of the free strip', () => {
    const subject = { x: 400, y: 70, width: 120, height: 90 };
    const p = placeRail(subject, RAIL, BOUNDS, STANDOFF);
    expect(p.side).toBe('bottom');
    expect(p.y).toBe(70 + 90 + STANDOFF);
  });

  it('never clamps back over the object it flipped below to avoid', () => {
    /**
     * The regression this whole module was written for. An object low enough
     * that the rail below it would foul the dock used to be "kept on screen" by
     * dragging the rail up -- into the artwork's bottom edge.
     */
    const subject = { x: 400, y: 200, width: 120, height: 480 };
    const p = placeRail(subject, RAIL, BOUNDS, STANDOFF);
    expect(overlaps(railRect(p), subject)).toBe(false);
  });

  it('goes beside a tall object when neither band has room', () => {
    // Taller than the free strip, but narrow: there is a whole column free.
    const subject = { x: 400, y: 40, width: 60, height: 900 };
    const p = placeRail(subject, RAIL, WIDE, STANDOFF);
    expect(p.side).toBe('right');
    expect(p.clear).toBe(true);
    expect(overlaps(railRect(p), subject)).toBe(false);
  });

  it('takes the left when the right is against the panel', () => {
    const subject = { x: 1200, y: 40, width: 100, height: 900 };
    const p = placeRail(subject, RAIL, WIDE, STANDOFF);
    expect(p.side).toBe('left');
    expect(overlaps(railRect(p), subject)).toBe(false);
  });

  it('admits it when the object leaves nowhere to stand', () => {
    const subject = { x: -200, y: -200, width: 2000, height: 2000 };
    const p = placeRail(subject, RAIL, BOUNDS, STANDOFF);
    expect(p.clear).toBe(false);
  });

  it('goes to the wall rather than towards the object when nothing is clear', () => {
    // A little more room below than above, so the rail should end up flush with
    // the bottom bound -- as far from the artwork as the screen permits.
    const subject = { x: 300, y: 100, width: 400, height: 579 };
    const p = placeRail(subject, RAIL, BOUNDS, STANDOFF);
    expect(p.clear).toBe(false);
    expect(p.side).toBe('bottom');
    expect(railRect(p).y + RAIL.height).toBe(BOUNDS.bottom);
  });

  it('keeps the rail\'s edges inside the bounds, not just its centre', () => {
    // Hard against the left panel: centring on the subject would put half the
    // rail underneath it.
    const subject = { x: 290, y: 300, width: 40, height: 40 };
    const p = placeRail(subject, RAIL, BOUNDS, STANDOFF);
    expect(railRect(p).x).toBeGreaterThanOrEqual(BOUNDS.left);
    expect(railRect(p).x + RAIL.width).toBeLessThanOrEqual(BOUNDS.right);
  });

  it('centres a rail wider than the free strip rather than pinning one edge', () => {
    const narrow: Bounds = { top: 64, right: 500, bottom: 724, left: 300 };
    const p = placeRail({ x: 320, y: 300, width: 40, height: 40 }, RAIL, narrow, STANDOFF);
    expect(p.x).toBe(400);
  });

  it('stays where it is while the side it prefers is only barely clear', () => {
    /**
     * Without this the rail flickers between above and below on a slow pan: the
     * gap above crosses the threshold by fractions of a pixel per frame, and the
     * decision follows it.
     */
    const subject = { x: 400, y: BOUNDS.top + 56, width: 120, height: 200 };
    expect(placeRail(subject, RAIL, BOUNDS, STANDOFF, 'bottom').side).toBe('bottom');
    // And with no memory of a previous side, the preference wins outright.
    expect(placeRail(subject, RAIL, BOUNDS, STANDOFF).side).toBe('top');
  });

  it('comes back up once there is real room above', () => {
    const subject = { x: 400, y: BOUNDS.top + 200, width: 120, height: 100 };
    expect(placeRail(subject, RAIL, BOUNDS, STANDOFF, 'bottom').side).toBe('top');
  });

  it('leaves a side that no longer fits, however long it has been there', () => {
    const subject = { x: 400, y: BOUNDS.top + 4, width: 120, height: 100 };
    expect(placeRail(subject, RAIL, BOUNDS, STANDOFF, 'top').side).toBe('bottom');
  });

  it('takes a different clearance on each side', () => {
    /**
     * The rail's shadow falls downward, so a rail above an object needs more
     * room than one below it. One number for both put the smear on the artwork.
     */
    const perSide = { top: 30, bottom: 14, left: 18, right: 18 };
    const subject = { x: 400, y: 300, width: 120, height: 90 };
    expect(placeRail(subject, RAIL, BOUNDS, perSide).y).toBe(300 - 30);

    // And a gap that would have fitted a symmetric standoff no longer fits above.
    const tight = { x: 400, y: BOUNDS.top + 60, width: 120, height: 90 };
    expect(placeRail(tight, RAIL, BOUNDS, 14).side).toBe('top');
    expect(placeRail(tight, RAIL, BOUNDS, perSide).side).toBe('bottom');
  });

  it('is stable: the same input gives the same answer', () => {
    const subject = { x: 400, y: 300, width: 120, height: 90 };
    expect(placeRail(subject, RAIL, BOUNDS, STANDOFF)).toEqual(
      placeRail(subject, RAIL, BOUNDS, STANDOFF)
    );
  });
});

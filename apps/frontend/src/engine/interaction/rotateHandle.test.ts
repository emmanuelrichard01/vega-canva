import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  angleDelta,
  angleOf,
  centreOf,
  corners,
  reachAt,
  rotateCursorAngle,
  rotateZones,
  rotationFor,
  ROTATE_REACH,
  SHEAR_EDGES,
  shearAxis,
  shearCursorAngle,
  shearFor,
  shearZones,
  type Box,
} from './rotateHandle';

/**
 * The rotation gesture, as arithmetic.
 *
 * The selection box drops Konva's protruding ninth control and puts rotation
 * in the ring just outside each corner — what Figma and Illustrator do. That
 * means the gesture is ours rather than the library's, so the parts of it that
 * are easy to get subtly wrong live here where they can be asserted, and the
 * component is left with the Konva wiring and nothing else.
 */

const box: Box = { x: 100, y: 50, width: 200, height: 100 };

describe('the zones sit outside the box, never inside it', () => {
  it('hangs each one off its own corner, outward on both axes', () => {
    /**
     * The rule that matters: a zone reaching *inwards* would take presses
     * meant for the object, so selecting a shape near its own corner would
     * start a rotation instead. Every zone must be strictly outside.
     */
    const reach = 20;
    const zones = rotateZones(box, reach);
    expect(zones).toHaveLength(4);

    for (const z of zones) {
      const overlapX = Math.min(z.x + z.width, box.x + box.width) - Math.max(z.x, box.x);
      const overlapY = Math.min(z.y + z.height, box.y + box.height) - Math.max(z.y, box.y);
      // Touching along an edge is fine; sharing area is not.
      expect(Math.min(overlapX, overlapY), JSON.stringify(z)).toBeLessThanOrEqual(0);
    }
  });

  it('puts one at each corner', () => {
    const zones = rotateZones(box, 20);
    const touching = corners(box).map((c) =>
      zones.some(
        (z) =>
          (z.x === c.x || z.x + z.width === c.x) && (z.y === c.y || z.y + z.height === c.y)
      )
    );
    expect(touching).toEqual([true, true, true, true]);
  });
});

describe('the zone is a size on a screen, not a size in the document', () => {
  it('shrinks in world units as the board is zoomed in', () => {
    /**
     * Invariant 9. A hit zone is a statement about a hand on a screen, so
     * judging it in world units makes it mean something different at every
     * zoom — the same mistake that made Alt-drag duplicate on a half-pixel
     * wobble at 10% and refuse a twenty-pixel drag at 500%.
     */
    expect(reachAt(1)).toBe(ROTATE_REACH);
    expect(reachAt(2)).toBe(ROTATE_REACH / 2);
    expect(reachAt(0.5)).toBe(ROTATE_REACH * 2);
  });

  it('does not divide by zero at an impossible zoom', () => {
    expect(Number.isFinite(reachAt(0))).toBe(true);
  });
});

describe('angleOf', () => {
  it('measures clockwise from east, in degrees', () => {
    const c = { x: 0, y: 0 };
    expect(angleOf(c, { x: 10, y: 0 })).toBe(0);
    expect(angleOf(c, { x: 0, y: 10 })).toBe(90);
    expect(angleOf(c, { x: -10, y: 0 })).toBe(180);
  });

  it('is unaffected by how far out the pointer is', () => {
    // An angle is an angle: dragging further from the centre must turn the
    // object at the same rate, or a rotation started near the corner and
    // finished at the edge of the screen accelerates as it goes.
    const c = centreOf(box);
    const near = angleOf(c, { x: c.x + 10, y: c.y + 10 });
    const far = angleOf(c, { x: c.x + 1000, y: c.y + 1000 });
    expect(near).toBeCloseTo(far, 10);
  });
});

describe('angleDelta', () => {
  /**
   * The jump the report called "weird jumps".
   *
   * `angleOf` is `atan2`, so it wraps at ±180. Dragging across the far side of
   * the object takes the pointer from 179° to −179° — a real step of two
   * degrees that subtracts as three hundred and fifty-eight, flipping the
   * object most of a turn in one frame. No downstream smoothing can hide it:
   * the value really did change by 358.
   */
  it('takes the short way across the wrap', () => {
    expect(angleDelta(179, -179)).toBe(2);
    expect(angleDelta(-179, 179)).toBe(-2);
  });

  it('is the plain difference away from the boundary', () => {
    expect(angleDelta(10, 40)).toBe(30);
    expect(angleDelta(40, 10)).toBe(-30);
  });

  it('never returns a step longer than half a turn', () => {
    for (let from = -350; from <= 350; from += 7) {
      for (let to = -350; to <= 350; to += 11) {
        const d = angleDelta(from, to);
        expect(Math.abs(d), `${from} -> ${to}`).toBeLessThanOrEqual(180);
      }
    }
  });

  it('accumulates past a full turn, which a start-relative reading cannot', () => {
    // Walking all the way round in steps sums to 360 rather than folding back
    // to zero — which is what lets a gesture keep turning past one revolution.
    let total = 0;
    let prev = 0;
    for (let a = 0; a <= 360; a += 20) {
      total += angleDelta(prev, a % 360);
      prev = a % 360;
    }
    expect(total).toBeCloseTo(360, 6);
  });
});

describe('rotationFor', () => {
  it('adds what the gesture has travelled', () => {
    expect(rotationFor(0, 30)).toBe(30);
    expect(rotationFor(45, 30)).toBe(75);
  });

  it('turns anticlockwise into a negative rotation rather than a jump', () => {
    expect(rotationFor(0, -30)).toBe(-30);
  });

  it('snaps the result, not the delta', () => {
    /**
     * The distinction is the whole usefulness of Shift. Rounding the *delta*
     * makes the snap relative to wherever the object already was, so a box
     * sitting at 7° snaps to 7°, 22°, 37° — a grid of its own that lines up
     * with nothing on the board. Rounding the result is what makes Shift mean
     * "square to the world".
     */
    expect(rotationFor(7, 5, 15)).toBe(15);
    expect(rotationFor(7, -7, 15)).toBe(0);
    expect(rotationFor(7, 40, 15)).toBe(45);
  });

  it('leaves the angle alone when nothing is being snapped to', () => {
    expect(rotationFor(7, 5, 0)).toBe(12);
  });
});

describe('the rotate cursor points the right way', () => {
  it('differs at each corner', () => {
    // A curved arrow has a direction, so one drawn at a fixed angle is right
    // at one corner and visibly wrong at the other three.
    const angles = [0, 1, 2, 3].map((i) => rotateCursorAngle(i, 0));
    expect(new Set(angles).size).toBe(4);
  });

  it('follows the object as it turns', () => {
    expect(rotateCursorAngle(0, 90)).toBe((225 + 90) % 360);
  });

  it('never comes back negative, however the object was turned', () => {
    // Dragging anticlockwise produces a negative rotation, and a negative
    // angle in a `rotate()` transform is legal but indexes off the front of
    // anything that tabulates by it — the bug `cursorForAnchor` records.
    for (const rotation of [-30, -90, -400, 0, 30, 400]) {
      for (const corner of [0, 1, 2, 3]) {
        const a = rotateCursorAngle(corner, rotation);
        expect(a, `corner ${corner} at ${rotation}`).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThan(360);
      }
    }
  });
});

describe('the box the zones are placed from', () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../components/canvas/RotateZones.tsx'),
    'utf8'
  );

  /**
   * The bug this pins, because the arithmetic above could not see it.
   *
   * `rotateZones` was always right. The component fed it the wrong box: it
   * read `proxy.x()` and treated it as a top-left, and `fitProxy` positions the
   * proxy **by its centre** with an offset so Konva turns it about its middle.
   * Every zone therefore landed half a box down and to the right of the corner
   * it belonged to — off the shape entirely for anything bigger than the zone.
   * Nothing could be hovered and nothing could be rotated, and the pure tests
   * all passed.
   *
   * A structural check, in the manner of `sketchHitArea.test.ts` beside it and
   * for the same reason: the failure is in what a component *reads*, and no
   * assertion about the function it calls can reach that.
   */
  it('comes from the parent, not from the proxy', () => {
    expect(src, 'the box must be a prop').toMatch(/box:\s*Box/);
    expect(
      src.replace(/\/\*[\s\S]*?\*\//g, ''),
      'reading the proxy for geometry is the bug: it is positioned by its centre'
    ).not.toMatch(/proxy\.(x|y|width|height)\(\)/);
  });

  it('takes its starting angle from the document, not the proxy', () => {
    /**
     * The proxy is a scratch node the transformer drives, and `handleTransformEnd`
     * used to leave it at zero until the next `fitProxy`. Reading a start angle
     * off it therefore returned 0 for an object that was plainly turned — so a
     * second rotation threw the object back to square before turning it, which
     * is the "jumps, rotates a bit, then snaps back" report.
     *
     * `rotation` is the same value `fitProxy` fits the proxy *to*, one step
     * earlier, so it cannot be behind it.
     */
    expect(src).toContain('startRotation: rotation');
    expect(
      src.replace(/\/\*[\s\S]*?\*\//g, ''),
      'the start angle must not come from the scratch proxy'
    ).not.toMatch(/startRotation:\s*proxy\.rotation\(\)/);
  });
});

describe('shear', () => {
  /**
   * The gesture `skewX`/`skewY` never had.
   *
   * The fields have been on `BaseNode` since before this session, normalised,
   * rendered through the `tan()` that turns degrees into Konva's coefficient,
   * and exposed as two steppers in the Transform panel. What was missing was a
   * way to *drag* — which is how anybody actually shears something; the panel
   * is where you go to type an exact number.
   *
   * Worth recording that this was declined once on the grounds that "there is
   * no shear in the model", which was simply a misreading of the schema. The
   * check is one grep and it was not run.
   */
  it('leans by an angle, not by a ratio', () => {
    // 45° is the drag that moves the top edge across by exactly the box's
    // height — the definition of a 45° lean, and the check that this is an
    // `atan` and not a proportion.
    expect(shearFor(0, 100, 100, 1)).toBeCloseTo(45, 6);
    expect(shearFor(0, 50, 100, 1)).toBeCloseTo(26.565, 3);
  });

  it('means the same slant for the same hand movement on any box', () => {
    // A proportional rule would make ten pixels on a tall box and ten on a
    // short one produce the same number, which they visibly are not.
    expect(shearFor(0, 20, 100, 1)).not.toBeCloseTo(shearFor(0, 20, 400, 1), 2);
    // And the taller the box, the gentler the lean for the same travel.
    expect(Math.abs(shearFor(0, 20, 400, 1))).toBeLessThan(Math.abs(shearFor(0, 20, 100, 1)));
  });

  it('adds to the slant already there', () => {
    expect(shearFor(10, 0, 100, 1)).toBeCloseTo(10, 6);
  });

  it('clamps short of the vertical, where the tangent runs away', () => {
    // At 90° the tangent is infinite and the object collapses to a line it
    // cannot come back from. ±89 is what the panel's steppers already allow.
    expect(shearFor(0, 1e9, 100, 1)).toBeLessThanOrEqual(89);
    expect(shearFor(0, -1e9, 100, 1)).toBeGreaterThanOrEqual(-89);
  });

  it('survives a zero-height box rather than dividing by it', () => {
    expect(Number.isFinite(shearFor(0, 40, 0, 1))).toBe(true);
  });

  it('snaps the result, like every other Shift in this file', () => {
    expect(shearFor(0, 100, 100, 1, 15)).toBe(45);
  });

  it('takes opposite edges the opposite way, so the object follows the hand', () => {
    expect(shearAxis('top').sign).toBe(-shearAxis('bottom').sign);
    expect(shearAxis('left').sign).toBe(-shearAxis('right').sign);
    expect(shearAxis('top').key).toBe('skewX');
    expect(shearAxis('left').key).toBe('skewY');
  });

  it('puts a bar outside each edge, clear of both corner zones', () => {
    /**
     * The bars must not reach the corners, or they take the presses meant for
     * rotation — and the corners are the gesture with no other way in.
     */
    const zones = shearZones(box, 20);
    const rotates = rotateZones(box, 20);
    for (const edge of SHEAR_EDGES) {
      const z = zones[edge];
      for (const r of rotates) {
        const ox = Math.min(z.x + z.width, r.x + r.width) - Math.max(z.x, r.x);
        const oy = Math.min(z.y + z.height, r.y + r.height) - Math.max(z.y, r.y);
        expect(Math.min(ox, oy), `${edge} overlaps a rotate zone`).toBeLessThanOrEqual(0);
      }
    }
  });

  it('keeps its bars outside the box, like the corner zones', () => {
    const zones = shearZones(box, 20);
    for (const edge of SHEAR_EDGES) {
      const z = zones[edge];
      const ox = Math.min(z.x + z.width, box.x + box.width) - Math.max(z.x, box.x);
      const oy = Math.min(z.y + z.height, box.y + box.height) - Math.max(z.y, box.y);
      expect(Math.min(ox, oy), `${edge} reaches inside the box`).toBeLessThanOrEqual(0);
    }
  });

  it('points the cursor along the edge it slides', () => {
    expect(shearCursorAngle('top', 0)).toBe(0);
    expect(shearCursorAngle('left', 0)).toBe(90);
    // And follows the object round.
    expect(shearCursorAngle('top', 30)).toBe(30);
    expect(shearCursorAngle('top', -30)).toBe(330);
  });
});

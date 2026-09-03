import { describe, expect, it } from 'vitest';
import { anchorBox, onScreen } from './walkAnchor';

/**
 * The conversion invariant 10 exists because of.
 *
 * These are short and they are the whole reason `walkAnchor.ts` is a module.
 * The bug they pin cost three rounds of user reports on `ObjectContextToolbar`
 * and was invisible in review, because the arithmetic looks complete without
 * the origin — it converts world to stage correctly, and stage is simply not
 * the space a DOM element is positioned in.
 */

const camera = { x: 100, y: 50, zoom: 2 };
/** The rulers, which is what makes the stage start away from the window. */
const ruler = { x: 28, y: 28 };

describe('anchorBox', () => {
  it('adds the stage origin, which is the whole point', () => {
    const box = anchorBox({ x: 10, y: 10, width: 40, height: 20 }, camera, ruler);
    // world 10 * zoom 2 = 20, + camera 100 = 120 (stage), + ruler 28 = 148 (window)
    expect(box.x).toBe(148);
    expect(box.y).toBe(98);
  });

  it('is exactly a ruler out when the origin is forgotten', () => {
    // Stated as a test rather than a comment, because this is the failure and
    // it is the one that looks correct.
    const right = anchorBox({ x: 10, y: 10, width: 40, height: 20 }, camera, ruler);
    const wrong = anchorBox({ x: 10, y: 10, width: 40, height: 20 }, camera, { x: 0, y: 0 });
    expect(right.x - wrong.x).toBe(ruler.x);
    expect(right.y - wrong.y).toBe(ruler.y);
  });

  it('scales the size by the zoom but never by the origin', () => {
    // A size is a length, and a length has no origin. Adding the inset to the
    // width is the other half of this mistake and produces a ring that grows
    // as the rulers are toggled.
    const box = anchorBox({ x: 0, y: 0, width: 40, height: 20 }, camera, ruler);
    expect(box.width).toBe(80);
    expect(box.height).toBe(40);
  });

  it('follows the camera, so a pan moves the ring with the object', () => {
    const world = { x: 10, y: 10, width: 40, height: 20 };
    const before = anchorBox(world, camera, ruler);
    const after = anchorBox(world, { ...camera, x: camera.x - 60 }, ruler);
    expect(before.x - after.x).toBe(60);
  });
});

describe('onScreen', () => {
  const viewport = { width: 1000, height: 800 };

  it('accepts an object comfortably in view', () => {
    expect(onScreen({ x: 100, y: 100, width: 200, height: 120 }, viewport)).toBe(true);
  });

  it('rejects one that has been panned away entirely', () => {
    expect(onScreen({ x: -500, y: 100, width: 200, height: 120 }, viewport)).toBe(false);
    expect(onScreen({ x: 1200, y: 100, width: 200, height: 120 }, viewport)).toBe(false);
  });

  it('rejects one with only a sliver showing', () => {
    // A ring round something the reader cannot really see claims the
    // walkthrough is talking about a thing that is not there.
    expect(onScreen({ x: -195, y: 100, width: 200, height: 120 }, viewport)).toBe(false);
  });

  it('accepts one straddling the edge with a real amount visible', () => {
    expect(onScreen({ x: -100, y: 100, width: 200, height: 120 }, viewport)).toBe(true);
  });

  it('needs both axes, not either', () => {
    // Wide but vertically off screen is off screen.
    expect(onScreen({ x: 100, y: 790, width: 400, height: 120 }, viewport)).toBe(false);
  });
});

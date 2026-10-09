import { describe, expect, it } from 'vitest';
import { FLICK_VELOCITY, resolveRelease, SheetDrag, snapHeights } from './bottomSheetModel';

const H = [300, 500, 800]; // peek, half, full

describe('snapHeights', () => {
  it('lists the chosen snaps lowest first, whatever order they are given in', () => {
    expect(snapHeights(['full', 'peek'], 1000).map((s) => s.name)).toEqual(['peek', 'full']);
    expect(snapHeights(['half'], 1000)[0].height).toBe(560);
    expect(snapHeights(['full'], 1000)[0].height).toBe(1000);
  });
});

describe('resolveRelease', () => {
  it('settles a slow release on the nearest snap', () => {
    expect(resolveRelease(420, 0, H)).toBe(1);
    expect(resolveRelease(380, 0.1, H)).toBe(0);
    expect(resolveRelease(700, -0.2, H)).toBe(2);
  });

  it('dismisses a slow release pulled below half the lowest snap', () => {
    expect(resolveRelease(140, 0, H)).toBe('dismiss');
    expect(resolveRelease(160, 0, H)).toBe(0);
  });

  it('keeps an undismissible sheet on its lowest snap', () => {
    expect(resolveRelease(40, 0, H, false)).toBe(0);
    expect(resolveRelease(250, FLICK_VELOCITY + 1, H, false)).toBe(0);
  });

  it('goes one step the way a flick throws it, even from near a snap', () => {
    // Pulled just above half and flicked up: full, not back to half.
    expect(resolveRelease(510, -1, H)).toBe(2);
    // Pulled just below half and flicked up: back up to half.
    expect(resolveRelease(490, -1, H)).toBe(1);
    // Just above half, flicked down: half; just below it: peek.
    expect(resolveRelease(510, 1, H)).toBe(1);
    expect(resolveRelease(480, 1, H)).toBe(0);
    // Flicked up from full stays full.
    expect(resolveRelease(820, -2, H)).toBe(2);
  });

  it('dismisses a downward flick from the lowest snap', () => {
    expect(resolveRelease(290, 1.2, H)).toBe('dismiss');
  });
});

describe('SheetDrag', () => {
  it('follows the finger and resists past the top', () => {
    const d = new SheetDrag(600, 500, 800, 0);
    expect(d.move(500, 16)).toBe(600);
    expect(d.move(200, 32)).toBe(800 + 100 * 0.2);
    expect(d.move(1000, 48)).toBe(100);
    expect(d.move(2000, 64)).toBe(0);
  });

  it('reads a fast swipe down as a flick, and a pause before lifting as still', () => {
    const fast = new SheetDrag(400, 500, 800, 0);
    fast.move(440, 10);
    fast.move(480, 20);
    fast.move(520, 30);
    expect(fast.velocity(30)).toBeCloseTo(4, 5);
    expect(resolveRelease(fast.heightAt(520), fast.velocity(30), H)).toBe(0);

    const paused = new SheetDrag(400, 500, 800, 0);
    paused.move(450, 20);
    paused.move(451, 40);
    expect(paused.velocity(400)).toBe(0);
  });

  it('tells a tap from a drag', () => {
    const d = new SheetDrag(400, 500, 800, 0);
    expect(d.moved(404)).toBe(false);
    expect(d.moved(410)).toBe(true);
  });
});

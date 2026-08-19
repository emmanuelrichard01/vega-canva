import { describe, it, expect } from 'vitest';
import { nudgeDelta, NUDGE_STEP, NUDGE_STEP_LARGE } from './nudge';

describe('nudgeDelta', () => {
  it('moves one unit in the direction of the arrow', () => {
    expect(nudgeDelta('ArrowLeft', false)).toEqual({ dx: -NUDGE_STEP, dy: 0 });
    expect(nudgeDelta('ArrowRight', false)).toEqual({ dx: NUDGE_STEP, dy: 0 });
    expect(nudgeDelta('ArrowUp', false)).toEqual({ dx: 0, dy: -NUDGE_STEP });
    expect(nudgeDelta('ArrowDown', false)).toEqual({ dx: 0, dy: NUDGE_STEP });
  });

  it('screen coordinates run downwards, so Up is negative', () => {
    // Worth its own assertion: getting this backwards is the one bug in a
    // nudge implementation that reads correct and feels wrong.
    expect(nudgeDelta('ArrowUp', false)!.dy).toBeLessThan(0);
    expect(nudgeDelta('ArrowDown', false)!.dy).toBeGreaterThan(0);
  });

  it('takes the larger step with Shift held', () => {
    expect(nudgeDelta('ArrowRight', true)).toEqual({ dx: NUDGE_STEP_LARGE, dy: 0 });
    expect(NUDGE_STEP_LARGE).toBeGreaterThan(NUDGE_STEP);
  });

  it('returns null for anything that is not an arrow, so other keys pass through', () => {
    for (const key of ['Enter', 'Tab', 'Escape', 'a', ' ', 'Home']) {
      expect(nudgeDelta(key, false)).toBeNull();
    }
  });
});

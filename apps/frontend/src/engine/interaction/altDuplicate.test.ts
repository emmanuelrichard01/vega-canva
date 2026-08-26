import { describe, expect, it } from 'vitest';
import { ALT_DUPLICATE_SLOP, duplicationSet, travelledEnough } from './altDuplicate';

describe('travelledEnough', () => {
  it('ignores the wobble inside an Alt-click', () => {
    expect(travelledEnough(2, 2, 1)).toBe(false);
  });

  it('takes a deliberate drag', () => {
    expect(travelledEnough(40, 0, 1)).toBe(true);
  });

  it('means the same distance to the hand at every zoom', () => {
    /**
     * The bug: the threshold was compared against world units, so zoomed out it
     * fired on a hand movement of half a pixel and zoomed in it refused a drag
     * of twenty. A gesture made on a screen is judged on the screen.
     */
    const wobble = ALT_DUPLICATE_SLOP - 1; // screen pixels

    // Zoomed far out, that is a huge distance in world units...
    expect(travelledEnough(wobble / 0.1, 0, 0.1)).toBe(false);
    // ...and zoomed far in, a tiny one. Neither should duplicate.
    expect(travelledEnough(wobble / 5, 0, 5)).toBe(false);

    // A real drag takes at both.
    expect(travelledEnough(20 / 0.1, 0, 0.1)).toBe(true);
    expect(travelledEnough(20 / 5, 0, 5)).toBe(true);
  });

  it('survives a zoom of zero or nonsense rather than refusing every drag', () => {
    expect(travelledEnough(40, 0, 0)).toBe(true);
    expect(travelledEnough(40, 0, NaN)).toBe(true);
  });
});

describe('duplicationSet', () => {
  it('copies the whole selection when the dragged object is part of one', () => {
    expect(duplicationSet('b', true, ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('copies just the object when it is the only thing selected', () => {
    expect(duplicationSet('b', true, ['b'])).toEqual(['b']);
  });

  it('copies just the object when it is not in the selection at all', () => {
    // Dragging an unselected object is an ordinary way to move one; Alt must
    // not quietly bring the selection along with it.
    expect(duplicationSet('z', false, ['a', 'b'])).toEqual(['z']);
  });

  it('copies just the object when there is no selection to speak of', () => {
    expect(duplicationSet('b', true, undefined)).toEqual(['b']);
  });
});

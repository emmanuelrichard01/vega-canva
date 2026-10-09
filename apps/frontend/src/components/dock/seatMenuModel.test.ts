import { describe, expect, it } from 'vitest';
import { flyoutMotion, flyoutTransition, rovingIndex, seatMenuStep, seatTipDescription, typeaheadIndex } from './seatMenuModel';

type M = 'shape' | 'frame' | 'data';
const click = (menu: M, armed = false, allowed = true) => ({ type: 'click' as const, menu, armed, allowed });

describe('the seat menu model', () => {
  it('arms the tool and opens its flyout on the first click', () => {
    expect(seatMenuStep<M>(null, click('shape'))).toEqual({ open: 'shape', arm: true });
  });

  it('closes on a second click on the armed seat, and keeps the tool', () => {
    expect(seatMenuStep<M>('shape', click('shape', true))).toEqual({ open: null, arm: false });
  });

  it('arms, and keeps the flyout open, when it was opened before the tool was armed', () => {
    // Opened from the caret while another tool was in hand: the click arms.
    expect(seatMenuStep<M>('shape', click('shape', false))).toEqual({ open: 'shape', arm: true });
  });

  it('reopens on a click on an armed seat whose flyout was closed', () => {
    expect(seatMenuStep<M>(null, click('shape', true))).toEqual({ open: 'shape', arm: true });
  });

  it('swaps one seat’s flyout for another’s', () => {
    expect(seatMenuStep<M>('shape', click('frame'))).toEqual({ open: 'frame', arm: true });
  });

  it('keeps the flyout open when an option is picked', () => {
    expect(seatMenuStep<M>('frame', { type: 'pick' })).toEqual({ open: 'frame', arm: false });
  });

  it('closes on Escape, a press elsewhere or a placement', () => {
    expect(seatMenuStep<M>('data', { type: 'dismiss' })).toEqual({ open: null, arm: false });
  });

  it('opens nothing for a tool the person may not use, and closes what was open', () => {
    expect(seatMenuStep<M>(null, click('shape', false, false))).toEqual({ open: null, arm: true });
    expect(seatMenuStep<M>('frame', click('shape', false, false))).toEqual({ open: 'frame', arm: true });
    expect(seatMenuStep<M>(null, { type: 'open', menu: 'shape', allowed: false })).toEqual({ open: null, arm: false });
  });

  it('lets the caret toggle without arming', () => {
    expect(seatMenuStep<M>(null, { type: 'caret', menu: 'shape', allowed: true })).toEqual({ open: 'shape', arm: false });
    expect(seatMenuStep<M>('shape', { type: 'caret', menu: 'shape', allowed: true })).toEqual({ open: null, arm: false });
  });

  it('opens from the keyboard without arming, whatever was open', () => {
    expect(seatMenuStep<M>('data', { type: 'open', menu: 'shape', allowed: true })).toEqual({ open: 'shape', arm: false });
  });
});

describe('flyout motion', () => {
  it('rises from nothing, cross-fades between seats, and stays put otherwise', () => {
    expect(flyoutMotion<M>(null, 'shape')).toBe('rise');
    expect(flyoutMotion<M>('shape', 'frame')).toBe('swap');
    expect(flyoutMotion<M>('shape', 'shape')).toBe('settled');
    expect(flyoutMotion<M>('shape', null)).toBe('settled');
  });

  it('exits faster than it enters, a swap does not travel, and reduced motion is instant', () => {
    const rise = flyoutTransition('rise', false);
    expect(rise.exit).toBeLessThan(rise.enter);
    expect(rise.enter).toBeGreaterThanOrEqual(0.12);
    expect(rise.enter).toBeLessThanOrEqual(0.16);
    expect(flyoutTransition('swap', false).rise).toBe(0);
    // A swap removes the old panel at once, so two never overlap.
    expect(flyoutTransition('swap', false).exit).toBe(0);
    expect(flyoutTransition('rise', true)).toEqual({ rise: 0, enter: 0, exit: 0 });
  });
});

describe('a tool armed some other way', () => {
  it('closes a flyout that does not own the new tool', () => {
    expect(seatMenuStep<M>('shape', { type: 'tool', owner: null })).toEqual({ open: null, arm: false });
    expect(seatMenuStep<M>('shape', { type: 'tool', owner: 'frame' })).toEqual({ open: null, arm: false });
  });

  it('keeps the flyout whose seat holds the new tool, and opens nothing', () => {
    expect(seatMenuStep<M>('shape', { type: 'tool', owner: 'shape' })).toEqual({ open: 'shape', arm: false });
    expect(seatMenuStep<M>(null, { type: 'tool', owner: 'shape' })).toEqual({ open: null, arm: false });
  });
});

describe('roving focus', () => {
  it('walks a list with Up and Down, wrapping, and jumps with Home and End', () => {
    expect(rovingIndex('ArrowDown', 0, 3, 'vertical')).toBe(1);
    expect(rovingIndex('ArrowDown', 2, 3, 'vertical')).toBe(0);
    expect(rovingIndex('ArrowUp', 0, 3, 'vertical')).toBe(2);
    expect(rovingIndex('Home', 2, 3, 'vertical')).toBe(0);
    expect(rovingIndex('End', 0, 3, 'horizontal')).toBe(2);
  });

  it('leaves the other axis and other keys alone', () => {
    expect(rovingIndex('ArrowLeft', 1, 3, 'vertical')).toBeNull();
    expect(rovingIndex('ArrowDown', 1, 3, 'horizontal')).toBeNull();
    expect(rovingIndex('Enter', 1, 3, 'vertical')).toBeNull();
    expect(rovingIndex('ArrowDown', 0, 0, 'vertical')).toBeNull();
  });

  it('enters from the near end when nothing in the run has focus', () => {
    expect(rovingIndex('ArrowRight', -1, 4, 'horizontal')).toBe(0);
    expect(rovingIndex('ArrowLeft', -1, 4, 'horizontal')).toBe(3);
  });
});

describe('typeahead', () => {
  const labels = ['Select', 'Direct select', 'Sticky', 'Shape'];

  it('finds the next label starting with the letter, and cycles on repeats', () => {
    expect(typeaheadIndex(labels, 0, 's')).toBe(2);
    expect(typeaheadIndex(labels, 2, 'S')).toBe(3);
    expect(typeaheadIndex(labels, 3, 's')).toBe(0);
    expect(typeaheadIndex(labels, -1, 'd')).toBe(1);
  });

  it('answers nothing for no match, a space or a named key', () => {
    expect(typeaheadIndex(labels, 0, 'z')).toBeNull();
    expect(typeaheadIndex(labels, 0, ' ')).toBeNull();
    expect(typeaheadIndex(labels, 0, 'ArrowDown')).toBeNull();
  });
});

describe('the seat tooltip', () => {
  it('says how to keep a lockable seat armed, after what it holds', () => {
    expect(seatTipDescription('rectangle', 'open')).toBe('Rectangle. Double-click to keep armed');
    expect(seatTipDescription(undefined, 'open')).toBe('Double-click to keep armed');
    expect(seatTipDescription('rectangle', 'kept')).toBe('Rectangle. Kept armed. Double-click to let go');
    expect(seatTipDescription('pan the board', 'none')).toBe('Pan the board');
    expect(seatTipDescription(undefined, 'none')).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { flyoutMotion, flyoutTransition, seatMenuStep } from './seatMenuModel';

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
    expect(flyoutTransition('rise', true)).toEqual({ rise: 0, enter: 0, exit: 0 });
  });
});

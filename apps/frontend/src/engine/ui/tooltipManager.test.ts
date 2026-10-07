import { describe, expect, it } from 'vitest';
import { createTooltipManager, OPEN_DELAY, WARM_WINDOW } from './tooltipManager';

const make = () => {
  let t = 1000;
  const m = createTooltipManager(() => t);
  return { m, tick: (ms: number) => (t += ms) };
};

describe('delay and warm window', () => {
  it('waits the full delay from cold, but never for the keyboard or a long-press', () => {
    const { m } = make();
    expect(m.decide('a', 'pointer')).toEqual({ action: 'wait', ms: OPEN_DELAY });
    expect(m.decide('a', 'focus')).toEqual({ action: 'show' });
    expect(m.decide('a', 'longpress')).toEqual({ action: 'show' });
  });

  it('shows the next one at once while a tip is up', () => {
    const { m } = make();
    m.shown('a');
    expect(m.decide('b', 'pointer')).toEqual({ action: 'show' });
  });

  it('stays warm for 300ms after a tip hides, then goes cold', () => {
    const { m, tick } = make();
    m.shown('a');
    m.hidden();
    tick(WARM_WINDOW - 1);
    expect(m.decide('b', 'pointer')).toEqual({ action: 'show' });
    tick(2);
    expect(m.decide('b', 'pointer')).toEqual({ action: 'wait', ms: OPEN_DELAY });
  });

  it('does not start a warm window when nothing was showing', () => {
    const { m } = make();
    m.hidden();
    expect(m.decide('b', 'pointer')).toEqual({ action: 'wait', ms: OPEN_DELAY });
  });
});

describe('suppression', () => {
  it('blocks one anchor and leaves the rest alone', () => {
    const { m } = make();
    m.suppress('seat-draw');
    expect(m.decide('seat-draw', 'focus')).toEqual({ action: 'blocked' });
    expect(m.decide('seat-shape', 'focus')).toEqual({ action: 'show' });
  });

  it('blocks everything with true, even a warm pointer or the keyboard', () => {
    const { m } = make();
    m.shown('a');
    m.suppress(true);
    expect(m.decide('b', 'pointer')).toEqual({ action: 'blocked' });
    expect(m.decide('b', 'focus')).toEqual({ action: 'blocked' });
  });

  it('counts: two overlays do not release each other', () => {
    const { m } = make();
    const a = m.suppress(true);
    const b = m.suppress(true);
    a();
    a();
    expect(m.isSuppressed()).toBe(true);
    b();
    expect(m.isSuppressed()).toBe(false);
  });

  it('releases a named anchor', () => {
    const { m } = make();
    const release = m.suppress('x');
    release();
    expect(m.decide('x', 'pointer')).toEqual({ action: 'wait', ms: OPEN_DELAY });
  });
});

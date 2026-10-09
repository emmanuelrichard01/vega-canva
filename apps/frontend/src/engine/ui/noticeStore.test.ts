// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notices$, NOTICE_LIFETIME } from './notices';

/** The store's lifecycle with a real expiry clock: hold, release, dismissal. */
describe('the notice store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    notices$.release();
    notices$.clear();
  });
  afterEach(() => {
    notices$.release();
    notices$.clear();
    vi.useRealTimers();
  });

  const lifetime = NOTICE_LIFETIME.success as number;

  it('expires a timed notice after its lifetime', () => {
    notices$.notify({ message: 'Copied', tone: 'success' });
    vi.advanceTimersByTime(lifetime + 20);
    expect(notices$.getSnapshot()).toHaveLength(0);
  });

  it('holds the clock while hovered and credits the time on release', () => {
    notices$.notify({ message: 'Copied', tone: 'success' });
    notices$.hold();
    vi.advanceTimersByTime(lifetime * 3);
    expect(notices$.getSnapshot()).toHaveLength(1);
    notices$.release();
    vi.advanceTimersByTime(lifetime - 200);
    expect(notices$.getSnapshot()).toHaveLength(1);
    vi.advanceTimersByTime(400);
    expect(notices$.getSnapshot()).toHaveLength(0);
  });

  it('drops a hold when the last notice is dismissed under the pointer', () => {
    const id = notices$.notify({ message: 'Deleted', tone: 'success' });
    notices$.hold();
    // The row unmounts under the pointer: no pointerleave, so no release.
    notices$.dismiss(id);
    notices$.notify({ message: 'Pasted', tone: 'success' });
    vi.advanceTimersByTime(lifetime + 20);
    expect(notices$.getSnapshot()).toHaveLength(0);
  });

  it('keeps an error until it is dismissed', () => {
    const id = notices$.notify({ message: 'That file could not be read', tone: 'error' });
    vi.advanceTimersByTime(60_000);
    expect(notices$.getSnapshot()).toHaveLength(1);
    notices$.dismiss(id);
    expect(notices$.getSnapshot()).toHaveLength(0);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readTourRecord, reloadTourState, tourState } from './tourState';
import { TOUR } from './tour';

const KEY = 'vega_tour_v2';


/** An in-memory store behind `window.localStorage`, which is where safeStorage looks. */
function installStorage() {
  const map = new Map<string, string>();
  const mem = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
  vi.stubGlobal('localStorage', mem);
  vi.stubGlobal('window', { localStorage: mem });
}

beforeEach(() => {
  installStorage();
  reloadTourState();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('tourState', () => {
  it('starts from the top the first time, and marks the offer made', () => {
    tourState.start();
    expect(tourState.getSnapshot()).toMatchObject({ step: 0, seen: true });
    expect(readTourRecord().seen).toBe(true);
  });

  it('resumes where it was put away, across a reload', () => {
    tourState.start();
    tourState.next();
    tourState.next();
    tourState.stop();
    expect(tourState.getSnapshot().step).toBeNull();

    reloadTourState();
    expect(tourState.canResume()).toBe(true);
    tourState.start();
    expect(tourState.getSnapshot().step).toBe(2);
  });

  it('starts again from the top after it has been finished', () => {
    tourState.start();
    for (let i = 0; i < TOUR.length; i++) tourState.next();
    expect(tourState.getSnapshot()).toMatchObject({ step: null, finished: true, resumeAt: null });
    expect(tourState.canResume()).toBe(false);
    tourState.start();
    expect(tourState.getSnapshot().step).toBe(0);
  });

  it('restarts from the first step whatever was saved', () => {
    tourState.start();
    tourState.goTo(4);
    tourState.stop();
    tourState.restart();
    expect(tourState.getSnapshot().step).toBe(0);
  });

  it('remembers a decline as firmly as a start', () => {
    tourState.decline();
    reloadTourState();
    expect(tourState.getSnapshot()).toMatchObject({ seen: true, step: null });
  });

  it('never stops a running tour when the offer is marked as made', () => {
    // A guided start begins the tour, then the checklist appears and records
    // the offer. The tour must survive that.
    tourState.restart();
    tourState.decline();
    expect(tourState.getSnapshot().step).toBe(0);
  });

  it('honours the old record, so a returning person is not offered it again', () => {
    localStorage.setItem('vega_tour_v1', 'yes');
    reloadTourState();
    expect(tourState.getSnapshot().seen).toBe(true);
  });

  it('ignores a stored step that no longer exists', () => {
    localStorage.setItem(KEY, JSON.stringify({ seen: true, resumeAt: 999 }));
    reloadTourState();
    expect(tourState.getSnapshot().resumeAt).toBeNull();
    localStorage.setItem(KEY, '{not json');
    reloadTourState();
    expect(tourState.getSnapshot()).toMatchObject({ seen: false, resumeAt: null });
  });

  it('does nothing when asked to move while nothing is running', () => {
    tourState.next();
    tourState.back();
    tourState.goTo(2);
    expect(tourState.getSnapshot().step).toBeNull();
  });
});

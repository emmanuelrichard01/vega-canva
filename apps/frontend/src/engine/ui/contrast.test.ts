// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONTRAST_STORAGE_KEY,
  canvasChromeContrast,
  getContrastPreference,
  initContrast,
  isContrastEnhanced,
  parseContrastPreference,
  resetContrastForTests,
  resolveContrast,
  setContrastPreference,
  subscribeContrast,
  toggleContrast,
} from './contrast';

function mockMatchMedia(active: Record<string, boolean>) {
  const lists = new Map<string, { listeners: Set<() => void>; matches: boolean }>();
  vi.stubGlobal('matchMedia', (query: string) => {
    if (!lists.has(query)) lists.set(query, { listeners: new Set(), matches: Boolean(active[query]) });
    const entry = lists.get(query)!;
    return {
      get matches() {
        return entry.matches;
      },
      addEventListener: (_: string, fn: () => void) => entry.listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => entry.listeners.delete(fn),
    };
  });
  return {
    set(query: string, matches: boolean) {
      const entry = lists.get(query);
      if (!entry) return;
      entry.matches = matches;
      entry.listeners.forEach((fn) => fn());
    },
  };
}

const MORE = '(prefers-contrast: more)';
const FORCED = '(forced-colors: active)';
const attr = () => document.documentElement.getAttribute('data-contrast');

/** In memory: Node 25 defines its own global localStorage, which shadows jsdom's. */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (k) => (data.has(k) ? data.get(k)! : null),
    key: (i) => Array.from(data.keys())[i] ?? null,
    removeItem: (k) => { data.delete(k); },
    setItem: (k, v) => { data.set(k, String(v)); },
  };
}

beforeEach(() => {
  resetContrastForTests();
  vi.stubGlobal('localStorage', memoryStorage());
  document.documentElement.removeAttribute('data-contrast');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveContrast', () => {
  it('pins on and off regardless of the system', () => {
    expect(resolveContrast('on', { moreContrast: false, forcedColors: false })).toBe(true);
    expect(resolveContrast('off', { moreContrast: true, forcedColors: true })).toBe(false);
  });

  it('follows prefers-contrast and forced colours under system', () => {
    expect(resolveContrast('system', { moreContrast: false, forcedColors: false })).toBe(false);
    expect(resolveContrast('system', { moreContrast: true, forcedColors: false })).toBe(true);
    expect(resolveContrast('system', { moreContrast: false, forcedColors: true })).toBe(true);
  });

  it('treats anything unrecognised in storage as system', () => {
    expect(parseContrastPreference(null)).toBe('system');
    expect(parseContrastPreference('loud')).toBe('system');
    expect(parseContrastPreference('on')).toBe('on');
  });
});

describe('the contrast store', () => {
  it('applies the stored preference on init', () => {
    mockMatchMedia({});
    localStorage.setItem(CONTRAST_STORAGE_KEY, 'on');
    initContrast();
    expect(getContrastPreference()).toBe('on');
    expect(attr()).toBe('more');
  });

  it('follows the OS setting live while on system, and announces the change', () => {
    const media = mockMatchMedia({ [MORE]: false });
    initContrast();
    const heard = vi.fn();
    subscribeContrast(heard);
    expect(attr()).toBeNull();
    media.set(MORE, true);
    expect(isContrastEnhanced()).toBe(true);
    expect(attr()).toBe('more');
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('ignores the OS once a choice is pinned', () => {
    const media = mockMatchMedia({ [FORCED]: false });
    initContrast();
    setContrastPreference('off');
    media.set(FORCED, true);
    expect(attr()).toBeNull();
    expect(localStorage.getItem(CONTRAST_STORAGE_KEY)).toBe('off');
  });

  it('toggles against what is in effect, so the command always changes something', () => {
    mockMatchMedia({ [MORE]: true });
    initContrast();
    expect(isContrastEnhanced()).toBe(true);
    toggleContrast();
    expect(getContrastPreference()).toBe('off');
    expect(attr()).toBeNull();
    toggleContrast();
    expect(getContrastPreference()).toBe('on');
    expect(attr()).toBe('more');
  });

  it('thickens canvas chrome only when enhanced', () => {
    expect(canvasChromeContrast(false)).toEqual({ strokeScale: 1, halo: false });
    expect(canvasChromeContrast(true).strokeScale).toBeGreaterThan(1);
  });
});

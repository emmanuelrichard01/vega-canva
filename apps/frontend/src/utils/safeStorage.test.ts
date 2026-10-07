// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storageGet, storageGetJson, storageRemove, storageSet } from './safeStorage';

/**
 * An in-memory Storage, installed per test. Node 25 defines its own global
 * `localStorage` (inert without `--localstorage-file`), which shadows the one
 * jsdom would provide.
 */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => { data.delete(k); },
    setItem: (k: string, v: string) => { data.set(k, String(v)); },
  };
}

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage() });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('safeStorage', () => {
  it('reads and writes through to localStorage', () => {
    expect(storageSet('k', 'v')).toBe(true);
    expect(storageGet('k')).toBe('v');
    storageRemove('k');
    expect(storageGet('k')).toBeNull();
  });

  it('falls back on missing or malformed JSON', () => {
    expect(storageGetJson('missing', [1])).toEqual([1]);
    window.localStorage.setItem('bad', '{not json');
    expect(storageGetJson('bad', 'fallback')).toBe('fallback');
  });

  /** Site data blocked: merely touching `window.localStorage` throws. */
  it('survives storage that throws on access', () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
    expect(storageGet('k')).toBeNull();
    expect(storageSet('k', 'v')).toBe(false);
    expect(() => storageRemove('k')).not.toThrow();
  });

  it('survives a full quota', () => {
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    expect(storageSet('k', 'v')).toBe(false);
  });
});

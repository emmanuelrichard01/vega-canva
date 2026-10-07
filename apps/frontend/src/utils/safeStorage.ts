/**
 * `localStorage` that cannot throw.
 *
 * Merely reading `window.localStorage` throws a `SecurityError` when site data
 * is blocked, and `setItem` throws `QuotaExceededError` when it is full. A
 * throw while a module is first evaluated happens before any error boundary
 * exists, so the page never gets past the boot shell. Every preference this
 * app keeps is a convenience: losing one must never cost the page.
 */
function store(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function storageGet(key: string): string | null {
  try {
    return store()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Returns whether the value was stored. */
export function storageSet(key: string, value: string): boolean {
  try {
    const s = store();
    if (!s) return false;
    s.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function storageRemove(key: string): void {
  try {
    store()?.removeItem(key);
  } catch {
    // Nothing to do: a key we cannot reach is a key we cannot have written.
  }
}

/** Parse a stored JSON value, falling back on anything missing or malformed. */
export function storageGetJson<T>(key: string, fallback: T): T {
  const raw = storageGet(key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

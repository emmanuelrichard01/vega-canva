import React, { useState, useEffect } from 'react';
import { nanoid } from 'nanoid';
import { getColorForUser } from '../engine/presence/ColorPalette';
import { AuthContext, type User } from './useAuth';
import { storageRemove, storageSet } from '../utils/safeStorage';

export type { User, AuthContextType } from './useAuth';

const colorForId = getColorForUser;

/**
 * The browser's store of this kind, or null where reading it would throw
 * (site data blocked). Merely touching `window.localStorage` throws then.
 */
function webStorage(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function sessionSet(key: string, value: string): void {
  try {
    webStorage('session')?.setItem(key, value);
  } catch {
    /* blocked or full: the in-memory identity is what the room reads */
  }
}

function sessionRemove(key: string): void {
  try {
    webStorage('session')?.removeItem(key);
  } catch {
    /* nothing to clean */
  }
}

/**
 * A stored identity, or null — never a throw.
 *
 * This was a bare JSON.parse in the state initialiser of the provider that
 * wraps the whole app. One corrupt entry — a truncated write, an extension,
 * a hand edit — threw on every load before anything could render, and the
 * only way out was clearing site data, which nobody knows to do. A value that
 * is not a usable identity is removed and treated as signed out: the visitor
 * types their name again, and loses nothing else.
 */
function readStoredUser(store: Storage | null, key: string): User | null {
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.id === 'string' && typeof parsed.name === 'string') return parsed as User;
  } catch {
    /* corrupt — fall through and discard it */
  }
  try {
    store.removeItem(key);
  } catch {
    /* storage unavailable: nothing to clean */
  }
  return null;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => {
    if (typeof window === 'undefined') return null;
    return readStoredUser(webStorage('local'), 'vega_user') ?? readStoredUser(webStorage('session'), 'vega_guest');
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const apiBase = (import.meta.env.VITE_API_URL as string) || '';
    fetch(`${apiBase}/api/session`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.user?.id) return;
        // Read by the connection token on every (re)connect: see doc.ts.
        if (data.token) storageSet('vega_session_token', data.token);
      })
      .catch(() => {
        // Offline or server unreachable: preserve local identity
      });
  }, []);

  const login = (name: string, color: string) => {
    const id = nanoid();
    const newUser = { id, name, color: color || colorForId(id), isGuest: false };
    storageSet('vega_user', JSON.stringify(newUser));
    sessionRemove('vega_guest');
    setUser(newUser);
  };

  const joinAsGuest = (name: string, color: string) => {
    const id = `guest_${nanoid()}`;
    const newGuest = { id, name, color: color || colorForId(id), isGuest: true };
    sessionSet('vega_guest', JSON.stringify(newGuest));
    setUser(newGuest);
  };

  /**
   * Change name or colour without becoming somebody else.
   *
   * The `id` is deliberately untouched. It is what `localAuthorId()` stamps on
   * every node and comment, so minting a new one would orphan everything this
   * person has already made — their own comments would stop being theirs. A
   * profile edit is a change of *appearance*, and the identity behind it is
   * the thing that must not move.
   *
   * Written back to whichever store this identity came from: a guest who edits
   * their profile stays a guest, rather than being quietly promoted to a
   * remembered identity by the act of renaming themselves.
   */
  const updateProfile = (patch: Partial<Pick<User, 'name' | 'color'>>) => {
    setUser((current) => {
      if (!current) return current;
      const next = { ...current, ...patch };
      const key = current.isGuest ? 'vega_guest' : 'vega_user';
      // A full or blocked store must not lose the edit for this session:
      // the in-memory identity is what the room actually reads.
      if (current.isGuest) sessionSet(key, JSON.stringify(next));
      else storageSet(key, JSON.stringify(next));
      return next;
    });
  };

  const logout = () => {
    storageRemove('vega_user');
    sessionRemove('vega_guest');
    storageRemove('vega_session_token');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, joinAsGuest, updateProfile, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

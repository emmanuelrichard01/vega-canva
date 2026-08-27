import React, { useState } from 'react';
import { nanoid } from 'nanoid';
import { getColorForUser } from '../engine/presence/ColorPalette';
import { AuthContext, type User } from './useAuth';

export type { User, AuthContextType } from './useAuth';

const colorForId = getColorForUser;

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => {
    if (typeof window === 'undefined') return null;
    const savedUser = localStorage.getItem('vega_user');
    if (savedUser) return JSON.parse(savedUser);
    const savedGuest = sessionStorage.getItem('vega_guest');
    return savedGuest ? JSON.parse(savedGuest) : null;
  });

  const login = (name: string, color: string) => {
    const id = nanoid();
    const newUser = { id, name, color: color || colorForId(id), isGuest: false };
    localStorage.setItem('vega_user', JSON.stringify(newUser));
    sessionStorage.removeItem('vega_guest');
    setUser(newUser);
  };

  const joinAsGuest = (name: string, color: string) => {
    const id = `guest_${nanoid()}`;
    const newGuest = { id, name, color: color || colorForId(id), isGuest: true };
    sessionStorage.setItem('vega_guest', JSON.stringify(newGuest));
    setUser(newGuest);
  };

  /**
   * Change name, colour or face without becoming somebody else.
   *
   * The `id` is deliberately untouched. It is what `localAuthorId()` stamps on
   * every node and comment, so minting a new one would orphan everything this
   * person has already made — their own comments would stop being theirs. A
   * profile edit is a change of *appearance*, and the identity behind it is
   * the thing that must not move.
   *
   * Written back to whichever store this identity came from: a guest who edits
   * their profile stays a guest, rather than being quietly promoted to a
   * remembered identity by the act of picking a face.
   */
  const updateProfile = (patch: Partial<Pick<User, 'name' | 'color' | 'avatar'>>) => {
    setUser((current) => {
      if (!current) return current;
      const next = { ...current, ...patch };
      const key = current.isGuest ? 'vega_guest' : 'vega_user';
      const store = current.isGuest ? sessionStorage : localStorage;
      try {
        store.setItem(key, JSON.stringify(next));
      } catch {
        // A full or blocked store must not lose the edit for this session —
        // the in-memory identity is what the room actually reads.
      }
      return next;
    });
  };

  const logout = () => {
    localStorage.removeItem('vega_user');
    sessionStorage.removeItem('vega_guest');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, joinAsGuest, updateProfile, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

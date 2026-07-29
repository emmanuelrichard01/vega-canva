import React, { createContext, useContext, useState } from 'react';
import { nanoid } from 'nanoid';
import { getColorForUser } from '../engine/presence/ColorPalette';

interface User {
  id: string;
  name: string;
  color: string;
  isGuest: boolean;
}

interface AuthContextType {
  user: User | null;
  login: (name: string, color: string) => void;
  joinAsGuest: (name: string, color: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

// A collaborator's color is their identity in the presence layer (cursor,
// selection outline, avatar) — it must stay the same for the same person
// every session, and two people shouldn't get the same color by coincidence
// more often than necessary. Hashing the stable id into a fixed palette gives
// every identity one deterministic, good-looking color.
//
// This used to be a second, near-identical palette + hash implementation
// inlined here, sitting alongside engine/presence/ColorPalette.ts which did
// exactly the same job with a slightly different palette and was imported by
// nothing. Two sources of truth for "what color is this person" is precisely
// the kind of drift that produces a user whose cursor and avatar disagree.
const colorForId = getColorForUser;

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => {
    if (typeof window === 'undefined') return null;
    // Remembered identity (login) takes priority; a guest identity — which
    // was never actually persisted anywhere before this — falls back to
    // sessionStorage, so it survives a reload within the same tab/session
    // but doesn't linger like a real account once the tab closes.
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

  const logout = () => {
    localStorage.removeItem('vega_user');
    sessionStorage.removeItem('vega_guest');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, joinAsGuest, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};

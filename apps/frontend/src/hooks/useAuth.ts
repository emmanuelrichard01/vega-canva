import { createContext, useContext } from 'react';

export interface User {
  id: string;
  name: string;
  /**
   * The *preferred* identity colour.
   *
   * What actually reaches a room is `resolvePresenceColor`'s answer, which
   * takes this as a first choice and moves it if somebody already there has
   * it. Uniqueness is a property of the room, and this record has never known
   * which room it is in.
   */
  color: string;
  isGuest: boolean;
}

export interface AuthContextType {
  user: User | null;
  login: (name: string, color: string) => void;
  joinAsGuest: (name: string, color: string) => void;
  /** Change name or colour preference, keeping the same identity. */
  updateProfile: (patch: Partial<Pick<User, 'name' | 'color'>>) => void;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};

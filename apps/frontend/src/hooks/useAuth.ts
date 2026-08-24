import { createContext, useContext } from 'react';

export interface User {
  id: string;
  name: string;
  color: string;
  isGuest: boolean;
}

export interface AuthContextType {
  user: User | null;
  login: (name: string, color: string) => void;
  joinAsGuest: (name: string, color: string) => void;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};

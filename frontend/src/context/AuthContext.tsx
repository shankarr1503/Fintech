import React, { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAuthToken, logoutSession, setAuthToken, setUnauthorizedHandler } from '../services/api';
import { deleteSecret, getSecret, setSecret } from '../services/secureStorage';

export interface User {
  id: string;
  phone: string;
  name?: string;
  avatar?: string;
  pin_set?: boolean;
  kyc_status?: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  /** True when the session came from storage (app reopened), so the app lock should engage. */
  restored: boolean;
  login: (user: User, token: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (updates: Partial<User>) => void;
}

const USER_KEY = 'user';
const TOKEN_KEY = 'session_token';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [restored, setRestored] = useState(false);

  // Forget the session on this device.
  const clearSession = useCallback(async () => {
    setAuthToken(null);
    setUser(null);
    await Promise.all([AsyncStorage.removeItem(USER_KEY), deleteSecret(TOKEN_KEY)]);
  }, []);

  // Sign out locally first, so a slow or unreachable server can't keep the session on this device;
  // then revoke the token server-side, best effort.
  const logout = useCallback(async () => {
    const token = getAuthToken();
    await clearSession();
    if (token) logoutSession(token).catch(() => {});
  }, [clearSession]);

  useEffect(() => {
    // The server already rejected this token, so there's nothing to revoke.
    setUnauthorizedHandler(() => {
      clearSession();
    });
    Promise.all([AsyncStorage.getItem(USER_KEY), getSecret(TOKEN_KEY)])
      .then(([storedUser, token]) => {
        // A user without a token is a pre-auth session: make them sign in again.
        if (storedUser && token) {
          setAuthToken(token);
          setUser(JSON.parse(storedUser));
          setRestored(true);
        }
      })
      .catch((error) => console.error('Failed to load session:', error))
      .finally(() => setIsLoading(false));
    return () => setUnauthorizedHandler(null);
  }, [clearSession]);

  const login = useCallback(async (userData: User, token: string) => {
    setAuthToken(token);
    // The token goes to the Keychain / Keystore (see secureStorage); the profile isn't secret.
    await Promise.all([AsyncStorage.setItem(USER_KEY, JSON.stringify(userData)), setSecret(TOKEN_KEY, token)]);
    setUser(userData);
  }, []);

  const updateUser = useCallback((updates: Partial<User>) => {
    setUser((current) => {
      if (!current) return current;
      const updated = { ...current, ...updates };
      AsyncStorage.setItem(USER_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  return <AuthContext.Provider value={{ user, isLoading, restored, login, logout, updateUser }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

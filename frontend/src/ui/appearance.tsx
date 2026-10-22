import React, { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Scheme, setScheme } from './theme';

export type AppearancePref = 'system' | 'light' | 'dark';
const KEY = 'appearance';

type Ctx = {
  preference: AppearancePref;
  scheme: Scheme;
  /** Change the theme. `returnTo` is reopened after the app re-renders in the new palette. */
  setPreference: (p: AppearancePref, returnTo?: string) => void;
  takeReturnRoute: () => string | null;
};

const AppearanceContext = createContext<Ctx | undefined>(undefined);

export function AppearanceProvider({ children }: { children: (scheme: Scheme) => ReactNode }) {
  const system = useColorScheme();
  const [preference, setPref] = useState<AppearancePref>('dark') // dark glass is the signature look; light and system stay one tap away;
  const [ready, setReady] = useState(false);
  const returnRoute = useRef<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => {
        if (v === 'light' || v === 'dark' || v === 'system') setPref(v);
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const scheme: Scheme = preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;
  setScheme(scheme); // before children render, so every style reads the right palette

  const setPreference = useCallback((p: AppearancePref, returnTo?: string) => {
    returnRoute.current = returnTo ?? null;
    setPref(p);
    AsyncStorage.setItem(KEY, p).catch(() => {});
  }, []);

  const takeReturnRoute = useCallback(() => {
    const r = returnRoute.current;
    returnRoute.current = null;
    return r;
  }, []);

  if (!ready) return null;
  return <AppearanceContext.Provider value={{ preference, scheme, setPreference, takeReturnRoute }}>{children(scheme)}</AppearanceContext.Provider>;
}

export function useAppearance() {
  const ctx = useContext(AppearanceContext);
  if (!ctx) throw new Error('useAppearance must be used within AppearanceProvider');
  return ctx;
}

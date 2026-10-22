import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../context/AuthContext';
import { errorMessage, verifyPin } from '../services/api';
import { Coin } from '../game/Coin';
import { PinPad } from './PinPad';
import { C, F, themed } from './theme';

const LOCK_AFTER_MS = 60_000;
export const BIOMETRIC_KEY = 'biometric_unlock';

export async function biometricAvailable() {
  if (Platform.OS === 'web') return false;
  try {
    return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
  } catch {
    return false;
  }
}

/** Covers the app when it's reopened or returns after a minute in the background. */
export function AppLock() {
  const { user, restored, logout } = useAuth();
  const [locked, setLocked] = useState(false);
  const [bio, setBio] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const backgroundAt = useRef<number | null>(null);

  // Lock on cold start with a saved session.
  useEffect(() => {
    if (user && restored && user.pin_set !== false) setLocked(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored]);

  // Same rule as cold start: lock unless the user is known to have no PIN yet.
  const canLock = !!user && user.pin_set !== false;
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') backgroundAt.current = Date.now();
      else if (state === 'active' && backgroundAt.current && Date.now() - backgroundAt.current > LOCK_AFTER_MS && canLock) setLocked(true);
    });
    return () => sub.remove();
  }, [canLock]);

  useEffect(() => {
    if (!user) setLocked(false);
  }, [user]);

  const tryBiometric = useCallback(async () => {
    const res = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock CoinQuest', cancelLabel: 'Use PIN', disableDeviceFallback: true });
    if (res.success) setLocked(false);
  }, []);

  useEffect(() => {
    if (!locked) return;
    (async () => {
      const enabled = (await AsyncStorage.getItem(BIOMETRIC_KEY).catch(() => null)) === 'on';
      const ok = enabled && (await biometricAvailable());
      setBio(ok);
      if (ok) tryBiometric();
    })();
  }, [locked, tryBiometric]);

  if (!locked || !user) return null;

  const submit = async (pin: string) => {
    setBusy(true);
    setError(null);
    try {
      await verifyPin(pin); // checked by the server; also keeps the session alive
      setLocked(false);
    } catch (e) {
      setError(errorMessage(e, 'Wrong PIN'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root} accessibilityViewIsModal testID="app-lock">
      <View style={styles.brand}>
        <Coin size={22} />
        <Text style={styles.brandText}>CoinQuest is locked</Text>
      </View>
      <PinPad dark title="Enter your PIN" error={error} busy={busy} onSubmit={submit} onBiometric={bio ? tryBiometric : undefined} />
      <Pressable onPress={logout} accessibilityRole="button" style={styles.logout} hitSlop={12}>
        <Text style={styles.logoutText}>Not you? Log out</Text>
      </Pressable>
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    root: { ...StyleSheet.absoluteFillObject, backgroundColor: C.night, alignItems: 'center', justifyContent: 'center', zIndex: 2000 },
    brand: { position: 'absolute', top: 64, flexDirection: 'row', alignItems: 'center', gap: 8 },
    brandText: { fontFamily: F.medium, fontSize: 14, color: C.nightMuted },
    logout: { marginTop: 22, paddingVertical: 8, paddingHorizontal: 12 },
    logoutText: { fontFamily: F.medium, fontSize: 14, color: C.nightText, textDecorationLine: 'underline' },
  }),
);

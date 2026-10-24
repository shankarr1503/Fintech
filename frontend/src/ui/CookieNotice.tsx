import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { Button, Glass } from './kit';
import { C, F, R, themed } from './theme';

const KEY = 'cookie_choice';
type Choice = 'all' | 'essential';

let current: Choice | null = null;
const listeners = new Set<() => void>();

/**
 * Whether optional (non-essential) storage such as analytics may be used. CoinQuest has none today;
 * anything optional added later must check this first.
 */
export const optionalStorageAllowed = () => current === 'all';

/** Show the notice again so the choice can be changed (footer "Cookie settings"). */
export function reopenCookieNotice() {
  current = null;
  AsyncStorage.removeItem(KEY).catch(() => {});
  listeners.forEach((l) => l());
}

/** Web only: tells visitors what the site stores, with an equal choice to accept or refuse optional storage. */
export function CookieNotice() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    AsyncStorage.getItem(KEY)
      .then((v) => {
        current = (v as Choice) || null;
        setOpen(!current);
      })
      .catch(() => setOpen(true));
    const l = () => setOpen(true);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  if (!open) return null;

  const choose = (choice: Choice) => {
    current = choice;
    AsyncStorage.setItem(KEY, choice).catch(() => {});
    setOpen(false);
  };

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.card} accessibilityRole={'region' as any} accessibilityLabel="Cookie notice" testID="cookie-notice">
        <Glass strong />
        <Text style={styles.title}>Cookies and storage</Text>
        <Text style={styles.body}>
          We only store what the app needs to work: keeping you signed in and remembering your settings. No ads, no tracking.{' '}
          <Text style={styles.link} onPress={() => router.push('/legal/cookies')} accessibilityRole="link">
            Cookie Policy
          </Text>
        </Text>
        <View style={styles.row}>
          <Button label="Essential only" kind="secondary" small style={{ flex: 1 }} onPress={() => choose('essential')} testID="cookie-essential" />
          <Button label="Accept all" kind="secondary" small style={{ flex: 1 }} onPress={() => choose('all')} testID="cookie-accept" />
        </View>
      </View>
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    // Top of the screen: it must never cover the page's main action (e.g. "Get OTP" at the bottom of sign-in).
    wrap: { position: 'absolute', left: 0, right: 0, top: 0, padding: 12, alignItems: 'center', zIndex: 1500 },
    card: {
      width: '100%',
      maxWidth: 520,
      backgroundColor: C.glass,
      borderRadius: R.md,
      padding: 16,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: C.lineStrong,
      shadowColor: '#000',
      shadowOpacity: 0.15,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 8 },
      elevation: 8,
    },
    title: { fontFamily: F.semibold, fontSize: 16, color: C.ink },
    body: { fontFamily: F.regular, fontSize: 14, lineHeight: 20, color: C.ink2, marginTop: 6 },
    link: { color: C.ink, textDecorationLine: 'underline', fontFamily: F.medium },
    row: { flexDirection: 'row', gap: 10, marginTop: 14 },
  }),
);

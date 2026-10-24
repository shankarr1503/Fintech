import React, { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { errorMessage, pinLogin, resetPin, setPin } from '../../src/services/api';
import { useAuth } from '../../src/context/AuthContext';
import { pinProblem } from '../../src/utils/pin';
import { PinPad } from '../../src/ui/PinPad';
import { Body, Button, NO_OUTLINE, Small, useStatusBar } from '../../src/ui/kit';
import { C, F, GUTTER, R, themed } from '../../src/ui/theme';

/**
 * mode=login  second sign-in factor (after OTP)
 * mode=set    first sign-in: create a PIN before using the app
 * mode=reset  forgot PIN: new PIN (+ PAN if KYC is done)
 */
export default function PinScreen() {
  useStatusBar('dark');
  const router = useRouter();
  const { mode = 'login', mfa = '' } = useLocalSearchParams<{ mode?: string; mfa?: string }>();
  const { login, updateUser } = useAuth();
  const [first, setFirst] = useState<string | null>(null);
  const [pan, setPan] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const done = async (res: any) => {
    await login(res.user, res.token);
    router.replace('/(tabs)');
  };

  const submit = async (pin: string) => {
    setError(null);
    if (mode === 'set' || mode === 'reset') {
      if (!first) {
        const problem = pinProblem(pin);
        if (problem) return setError(problem);
        setFirst(pin);
        return;
      }
      if (pin !== first) {
        setFirst(null);
        setError("PINs didn't match. Start again.");
        return;
      }
    }
    setBusy(true);
    try {
      if (mode === 'login') await done(await pinLogin(mfa, pin));
      else if (mode === 'reset') await done(await resetPin(mfa, pin, pan || undefined));
      else {
        await setPin(pin);
        updateUser({ pin_set: true });
        router.replace('/(tabs)');
      }
    } catch (e) {
      if (mode !== 'login') setFirst(null);
      setError(errorMessage(e, "That didn't work"));
    } finally {
      setBusy(false);
    }
  };

  const title =
    mode === 'login' ? 'Enter your PIN' : first ? 'Enter it once more' : mode === 'reset' ? 'Choose a new PIN' : 'Set your app PIN';
  const subtitle =
    mode === 'login'
      ? 'Second step of sign-in'
      : first
        ? 'Just to be sure'
        : "4 to 6 digits. You'll use it to unlock the app and confirm UPI payments of ₹2,000 or more. Avoid birthdays and 1234.";

  return (
    <SafeAreaView style={styles.root}>
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: GUTTER }}>
        {mode === 'reset' && !first && (
          <View style={{ marginBottom: 24 }}>
            <Small style={{ marginBottom: 6, fontFamily: F.medium, color: C.ink2 }}>PAN (if you&apos;ve completed KYC)</Small>
            <TextInput selectionColor={C.ink} cursorColor={C.ink} value={pan} onChangeText={(t) => setPan(t.toUpperCase().slice(0, 10))} autoCapitalize="characters" placeholder="ABCPE1234F" placeholderTextColor={C.ink3} style={styles.pan} />
          </View>
        )}
        <PinPad title={title} subtitle={subtitle} error={error} busy={busy} onSubmit={submit} testID="pin-pad" />
      </View>
      <View style={styles.footer}>
        {mode === 'login' ? (
          <Pressable onPress={() => router.replace({ pathname: '/(auth)/pin', params: { mode: 'reset', mfa } })} accessibilityRole="button">
            <Body style={{ color: C.blue, fontFamily: F.semibold, textAlign: 'center' }}>Forgot PIN?</Body>
          </Pressable>
        ) : mode === 'reset' ? (
          <Small center>Other devices will be signed out, and payments of ₹2,000+ pause for 24 hours.</Small>
        ) : null}
        {mode !== 'set' && <Button label="Cancel" kind="ghost" small onPress={() => router.replace('/(auth)/login')} />}
      </View>
    </SafeAreaView>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: 'transparent' },
    footer: { paddingHorizontal: GUTTER, paddingBottom: 18, gap: 8, alignItems: 'center' },
    pan: { height: 50, borderRadius: R.sm, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, paddingHorizontal: 14, fontFamily: F.semibold, fontSize: 16, color: C.ink, letterSpacing: 2, ...NO_OUTLINE },
  }),
);

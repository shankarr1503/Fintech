import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { errorMessage, sendOTP } from '../../src/services/api';
import { Coin } from '../../src/game/Coin';
import { Alert } from '../../src/ui/dialog';
import { Button, NO_OUTLINE, Small, useStatusBar } from '../../src/ui/kit';
import { C, F, GUTTER, R, themed } from '../../src/ui/theme';
import { VoxelCoin } from '../../src/ui/three/Voxel';

export default function Login() {
  useStatusBar('light');
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const valid = /^[6-9]\d{9}$/.test(phone);
  const pretty = phone.length > 5 ? `${phone.slice(0, 5)} ${phone.slice(5)}` : phone;

  const start = async () => {
    if (!valid) return;
    setLoading(true);
    try {
      const res = await sendOTP(phone);
      router.push({ pathname: '/(auth)/verify', params: { phone, demoOtp: res.demo_otp ?? '' } });
    } catch (e) {
      Alert.alert("Couldn't send the code", errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <Pressable style={styles.brand} onPress={() => router.replace('/')} accessibilityRole="link" accessibilityLabel="CoinQuest home">
            <Coin size={22} />
            <Text style={styles.brandText}>CoinQuest</Text>
          </Pressable>

          <View style={styles.hero}>
            {/* Off-centre on purpose: the coin sits by the headline like an object on a desk. */}
            <View style={{ alignSelf: 'flex-end', marginBottom: -18, marginRight: 4 }}>
              <VoxelCoin size={104} spin={0.35} interactive />
            </View>
            <Text style={styles.h1}>Pay, save</Text>
            <Text style={styles.h1}>
              and <Text style={styles.h1Italic}>level up.</Text>
            </Text>
            <Text style={styles.sub}>UPI, bills, credit cards and goals in one place, with rewards for the good habits.</Text>
          </View>

          <View style={styles.form}>
            <Text style={styles.label}>Mobile number</Text>
            <View style={[styles.field, (valid || focused) && { borderColor: C.gold }, focused && styles.fieldFocus]}>
              <Text style={styles.cc}>+91</Text>
              <View style={styles.sep} />
              <TextInput selectionColor={C.nightText} cursorColor={C.nightText}
                value={pretty}
                onChangeText={(t) => setPhone(t.replace(/\D/g, '').slice(0, 10))}
                keyboardType="phone-pad"
                placeholder="98765 43210"
                placeholderTextColor={C.nightMuted}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                style={styles.input}
                maxLength={11}
                autoFocus
                testID="phone-input"
                returnKeyType="go"
                onSubmitEditing={start}
                accessibilityLabel="Mobile number"
              />
              {valid && <Feather name="check" size={18} color={C.gold} />}
            </View>
            <Button label="Get OTP" kind="gold" disabled={!valid} loading={loading} onPress={start} style={{ marginTop: 16 }} testID="start-btn" />
            <Text style={styles.terms}>
              For people aged 18 and over. New here? You’ll be asked to accept our{' '}
              <Text style={styles.link} onPress={() => router.push('/legal/terms')} accessibilityRole="link">
                Terms
              </Text>{' '}
              and{' '}
              <Text style={styles.link} onPress={() => router.push('/legal/privacy')} accessibilityRole="link">
                Privacy Policy
              </Text>{' '}
              after the code.
            </Text>
            <View style={styles.trust}>
              <Feather name="lock" size={12} color={C.nightMuted} />
              <Small color={C.nightMuted} style={{ marginLeft: 6 }}>
                We&apos;ll never ask for your UPI PIN or card CVV.
              </Small>
            </View>
            <View style={styles.legal}>
              {[
                ['Refunds', '/legal/refunds'],
                ['Cookies', '/legal/cookies'],
                ['Delete my data', '/delete-account'],
              ].map(([label, href]) => (
                <Text key={href} style={styles.legalLink} onPress={() => router.push(href as any)} accessibilityRole="link">
                  {label}
                </Text>
              ))}
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  root: { flex: 1, backgroundColor: C.night },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: GUTTER, paddingTop: 12 },
  brandText: { fontFamily: F.semibold, fontSize: 16, color: C.nightText, letterSpacing: -0.2 },
  hero: { flex: 1, justifyContent: 'center', paddingHorizontal: GUTTER },
  h1: { fontFamily: F.display, fontSize: 58, lineHeight: 60, color: C.nightText, letterSpacing: -1 },
  h1Italic: { fontFamily: F.displayItalic, color: C.gold },
  sub: { fontFamily: F.regular, fontSize: 16, lineHeight: 23, color: C.nightMuted, marginTop: 18, maxWidth: 330 },
  form: { paddingHorizontal: GUTTER, paddingBottom: 18 },
  label: { fontFamily: F.medium, fontSize: 13, color: C.nightMuted, marginBottom: 8 },
  field: { flexDirection: 'row', alignItems: 'center', height: 60, borderRadius: R.md, backgroundColor: C.night2, borderWidth: 1, borderColor: C.night3, paddingHorizontal: 16 },
  cc: { fontFamily: F.semibold, fontSize: 18, color: C.nightMuted },
  sep: { width: 1, height: 24, backgroundColor: C.night3, marginHorizontal: 14 },
  input: { flex: 1, fontFamily: F.semibold, fontSize: 20, color: C.nightText, letterSpacing: 1, fontVariant: ['tabular-nums'], ...NO_OUTLINE },
  terms: { fontFamily: F.regular, fontSize: 13, lineHeight: 18, color: C.nightMuted, textAlign: 'center', marginTop: 14 },
  link: { color: C.nightText, textDecorationLine: 'underline' },
  trust: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  fieldFocus: { borderWidth: 2 },
  legal: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 16, rowGap: 6, marginTop: 14 },
  legalLink: { fontFamily: F.medium, fontSize: 12, lineHeight: 20, color: C.nightMuted, textDecorationLine: 'underline' },
}));

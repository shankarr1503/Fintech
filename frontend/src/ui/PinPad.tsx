import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { C, F, themed } from './theme';
import { haptic, Keycap, NATIVE } from './kit';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'bio', '0', 'del'];

type Props = {
  title: string;
  subtitle?: string;
  error?: string | null;
  busy?: boolean;
  /** Called with 4-6 digits: at 6 automatically, or when the user taps the tick. */
  onSubmit: (pin: string) => void;
  onBiometric?: () => void;
  dark?: boolean;
  testID?: string;
};

/** PIN entry with its own keypad, so the digits never pass through the system keyboard. */
export function PinPad({ title, subtitle, error, busy, onSubmit, onBiometric, dark, testID }: Props) {
  const [pin, setPin] = useState('');
  const shake = React.useRef(new Animated.Value(0)).current;
  const fg = dark ? C.nightText : C.ink;
  const muted = dark ? C.nightMuted : C.ink3;

  useEffect(() => {
    if (!error) return;
    setPin('');
    haptic('medium');
    Animated.sequence([10, -10, 6, -6, 0].map((v) => Animated.timing(shake, { toValue: v, duration: 50, useNativeDriver: NATIVE }))).start();
  }, [error, shake]);

  const press = (k: string) => {
    if (busy) return;
    if (k === 'bio') return onBiometric?.();
    haptic();
    if (k === 'del') return setPin((p) => p.slice(0, -1));
    if (k === 'ok') return pin.length >= 4 && send(pin);
    const next = (pin + k).slice(0, 6);
    setPin(next);
    if (next.length === 6) send(next);
  };

  // Hand the PIN over and start fresh, so a follow-up entry (confirm, retry) never appends to it.
  const send = (value: string) => {
    setTimeout(() => setPin(''), 150);
    onSubmit(value);
  };

  return (
    <View style={{ alignItems: 'center' }} testID={testID}>
      <Text style={[styles.title, { color: fg }]}>{title}</Text>
      {subtitle ? <Text style={[styles.sub, { color: muted }]}>{subtitle}</Text> : null}
      <Animated.View style={[styles.dots, { transform: [{ translateX: shake }] }]} accessible accessibilityLabel={`${pin.length} digits entered`}>
        {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
          <View key={i} style={[styles.dot, { borderColor: fg }, i < pin.length && { backgroundColor: fg }]} />
        ))}
      </Animated.View>
      <View style={{ height: 22, justifyContent: 'center' }}>
        {busy ? <ActivityIndicator color={fg} /> : error ? <Text style={[styles.error, { color: dark ? C.nightText : C.red }]}>{error}</Text> : null}
      </View>
      <View style={styles.pad}>
        {KEYS.map((k) => {
          if (k === 'bio' && !onBiometric) {
            return pin.length >= 4 && pin.length < 6 ? (
              <Pressable key="ok" onPress={() => press('ok')} style={styles.key} accessibilityRole="button" accessibilityLabel="Confirm PIN" testID="pin-ok">
                <Feather name="check" size={26} color={fg} />
              </Pressable>
            ) : (
              <View key={k} style={styles.key} />
            );
          }
          return (
            <Pressable
              key={k}
              onPress={() => press(k)}
              style={styles.key}
              accessibilityRole="button"
              accessibilityLabel={k === 'del' ? 'Delete' : k === 'bio' ? 'Use biometrics' : k}
              testID={`pin-${k}`}
            >
              {({ pressed }) =>
                k === 'del' || k === 'bio' ? (
                  // Function keys stay flat: only digits are keycaps, so the eye finds them first.
                  <Feather name={k === 'del' ? 'delete' : 'smartphone'} size={22} color={fg} style={{ opacity: pressed ? 0.5 : 1 }} />
                ) : (
                  <Keycap width={80} height={54} radius={16} depth={4} pressed={pressed}>
                    <Text style={[styles.keyText, { color: C.ink }]}>{k}</Text>
                  </Keycap>
                )
              }
            </Pressable>
          );
        })}
      </View>
      {onBiometric && pin.length >= 4 && pin.length < 6 && (
        <Pressable onPress={() => press('ok')} accessibilityRole="button" testID="pin-ok" style={{ marginTop: 8 }}>
          <Text style={[styles.sub, { color: fg, fontFamily: F.semibold }]}>Continue</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    title: { fontFamily: F.display, fontSize: 30, textAlign: 'center' },
    sub: { fontFamily: F.regular, fontSize: 14, marginTop: 6, textAlign: 'center', maxWidth: 300 },
    dots: { flexDirection: 'row', gap: 16, marginTop: 26 },
    dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5 },
    error: { fontFamily: F.medium, fontSize: 13, textAlign: 'center' },
    pad: { flexDirection: 'row', flexWrap: 'wrap', width: 288, marginTop: 10 },
    key: { width: 96, height: 68, alignItems: 'center', justifyContent: 'center' },
    keyText: { fontFamily: F.semibold, fontSize: 26, fontVariant: ['tabular-nums'] },
  }),
);

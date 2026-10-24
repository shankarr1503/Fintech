import React, { useEffect, useState } from 'react';
import { Share, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import {
  deleteUserAccount,
  endOtherSessions,
  endSession,
  errorMessage,
  exportUserData,
  getAuditLog,
  getSecuritySettings,
  listSessions,
  setPin,
  updateSecuritySettings,
  verifyPin,
} from '../src/services/api';
import { BIOMETRIC_KEY, biometricAvailable } from '../src/ui/AppLock';
import { PinPad } from '../src/ui/PinPad';
import { pinProblem } from '../src/utils/pin';
import { useAuth } from '../src/context/AuthContext';
import { useUserData } from '../src/game/useData';
import { Alert } from '../src/ui/dialog';
import { Card, Divider, ErrorState, IconMark, Pill, Row, Screen, Section, Sheet, SkeletonScreen, Small, Toggle } from '../src/ui/kit';
import { C } from '../src/ui/theme';
import { formatDate, formatTime } from '../src/utils/format';

type Settings = { biometric_enabled: boolean; transaction_alerts: boolean; login_notifications: boolean };
const EVENT: Record<string, string> = {
  login: 'Signed in',
  login_otp_verified: 'OTP verified',
  login_otp_failed: 'Wrong OTP entered',
  login_pin_failed: 'Wrong PIN entered',
  pin_changed: 'App PIN set or changed',
  pin_locked: 'PIN locked after wrong attempts',
  pin_reset: 'PIN reset',
  pin_reset_failed: 'PIN reset failed',
  session_revoked: 'Signed out a device',
  sessions_revoked_others: 'Signed out other devices',
  terms_accepted: 'Accepted terms',
  kyc_verified: 'Identity verified',
  kyc_review: 'Identity sent for review',
  kyc_failed: 'Identity check failed',
  payment_initiated: 'Payment started',
  payment_success: 'Payment completed',
  payment_failed: 'Payment failed',
  payment_on_hold: 'Payment held for review',
  payment_received: 'Money received',
  data_exported: 'Data downloaded',
  privacy_settings_updated: 'Security settings changed',
  aa_consent_revoked: 'Bank link consent revoked',
};
const eventLabel = (a: string) => EVENT[a] ?? a.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

type Session = { id: string; device: string; ip?: string; created_at: string; last_seen: string; current: boolean };

export default function Security() {
  const { logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const [hasBio, setHasBio] = useState(false);
  const [pinStep, setPinStep] = useState<null | 'current' | 'new' | 'delete'>(null);
  const [currentPin, setCurrentPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const { data, setData, loading, reload, userId, error } = useUserData(async (id) => {
    const [settings, log, sessions] = await Promise.all([getSecuritySettings(id), getAuditLog(id), listSessions()]);
    return { settings: settings as Settings, log: log as any[], sessions: sessions as Session[] };
  });

  useEffect(() => {
    biometricAvailable().then(setHasBio);
  }, []);

  if (loading || !data)
    return (
      <Screen title="Security">
        {error ? <ErrorState onRetry={reload} /> : <SkeletonScreen />}
      </Screen>
    );

  const toggle = async (key: keyof Settings, value: boolean) => {
    let prevBio: string | null = null;
    if (key === 'biometric_enabled') {
      if (value) {
        // Prove it's the owner's finger before trusting it to unlock the app.
        const res = await LocalAuthentication.authenticateAsync({ promptMessage: 'Turn on biometric unlock', disableDeviceFallback: true }).catch(() => null);
        if (!res?.success) return;
      }
      prevBio = await AsyncStorage.getItem(BIOMETRIC_KEY).catch(() => null);
      await AsyncStorage.setItem(BIOMETRIC_KEY, value ? 'on' : 'off').catch(() => {});
    }
    const prev = data.settings;
    setData({ ...data, settings: { ...prev, [key]: value } });
    try {
      await updateSecuritySettings(userId, { ...prev, [key]: value });
    } catch (e) {
      // Not saved: the app lock must keep following the setting as shown.
      if (key === 'biometric_enabled') await AsyncStorage.setItem(BIOMETRIC_KEY, prevBio ?? 'off').catch(() => {});
      setData({ ...data, settings: prev });
      Alert.alert("Couldn't save", errorMessage(e));
    }
  };

  const exportData = async () => {
    setBusy(true);
    try {
      const dump = await exportUserData(userId);
      await Share.share({ title: 'CoinQuest data export', message: JSON.stringify(dump, null, 2) });
    } catch (e) {
      Alert.alert('Export failed', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const signOutOthers = () =>
    Alert.alert('Sign out other devices?', 'Every phone and browser except this one will need your OTP and PIN again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          try {
            await endOtherSessions();
            reload();
          } catch (e) {
            Alert.alert("Couldn't sign out", errorMessage(e));
          }
        },
      },
    ]);

  const endOne = async (s: Session) => {
    try {
      await endSession(s.id);
      setData({ ...data, sessions: data.sessions.filter((x) => x.id !== s.id) });
    } catch (e) {
      Alert.alert("Couldn't sign out", errorMessage(e));
    }
  };

  const closePin = () => {
    setPinStep(null);
    setCurrentPin('');
    setPinError(null);
  };

  const onPin = async (pin: string) => {
    if (pinStep === 'delete') {
      // Erasure can't be undone, so the server wants a fresh PIN confirmation for it.
      setBusy(true);
      try {
        const { step_up_token } = await verifyPin(pin);
        await deleteUserAccount(userId, 'User requested deletion', step_up_token);
        closePin();
        await logout();
      } catch (e) {
        setPinError(errorMessage(e));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (pinStep === 'current') {
      setCurrentPin(pin);
      setPinError(null);
      return setPinStep('new');
    }
    const problem = pinProblem(pin);
    if (problem) return setPinError(problem);
    setBusy(true);
    try {
      await setPin(pin, currentPin);
      closePin();
      Alert.alert('PIN changed', 'Use your new PIN from now on. We’ve sent a security alert to confirm it was you.');
    } catch (e) {
      const msg = errorMessage(e);
      // A wrong current PIN sends the user back a step; a weak new PIN keeps them here.
      if (/current|wrong|locked/i.test(msg)) {
        setPinStep('current');
        setCurrentPin('');
      }
      setPinError(msg);
    } finally {
      setBusy(false);
    }
  };

  const toggles: { key: keyof Settings; title: string; sub: string }[] = [
    ...(hasBio ? [{ key: 'biometric_enabled' as const, title: 'Biometric unlock', sub: 'Fingerprint or Face ID instead of your PIN' }] : []),
    { key: 'transaction_alerts', title: 'Payment alerts', sub: 'A notification for every debit and credit' },
    { key: 'login_notifications', title: 'New device alerts', sub: 'When someone signs in on another phone' },
  ];

  const remove = () =>
    Alert.alert('Delete your account?', 'Your profile, transactions, goals, coins and progress will be erased. This cannot be undone. Payment and KYC records are kept for 5 years, as anti-money-laundering law requires, and used for nothing else.', [
      { text: 'Keep my account', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => setPinStep('delete'),
      },
    ]);

  return (
    <Screen title="Security">
      <Section title="Protection" style={{ marginTop: 18 }}>
        <Card padded={false} style={{ paddingHorizontal: 16 }}>
          <Row left={<IconMark icon="lock" tint="pin" />} title="Change app PIN" subtitle="Unlocks the app and confirms UPI payments of ₹2,000+" onPress={() => setPinStep('current')} chevron testID="change-pin" />
          {toggles.map((t) => (
            <View key={t.key}>
              <Divider />
              <Row title={t.title} subtitle={t.sub} right={<Toggle value={!!data.settings[t.key]} onChange={(v) => toggle(t.key, v)} label={t.title} />} />
            </View>
          ))}
        </Card>
        <Small style={{ marginTop: 10 }}>CoinQuest locks itself after 15 minutes without activity, and when you come back after a minute away.</Small>
      </Section>

      <Section title="Signed in on">
        <Card padded={false} style={{ paddingHorizontal: 16 }}>
          {data.sessions.map((s, i) => (
            <View key={s.id}>
              {i > 0 && <Divider inset={54} />}
              <Row
                left={<IconMark icon="smartphone" tint={s.device} />}
                title={s.device}
                subtitle={s.current ? 'This device' : `Last active ${formatDate(s.last_seen)}, ${formatTime(s.last_seen)}`}
                right={s.current ? <Pill label="Current" tone="green" /> : undefined}
                onPress={s.current ? undefined : () => Alert.alert(`Sign out ${s.device}?`, undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => endOne(s) }])}
                testID={`session-${i}`}
              />
            </View>
          ))}
          {data.sessions.length > 1 && (
            <>
              <Divider />
              <Row title="Sign out all other devices" onPress={signOutOthers} testID="revoke-others" />
            </>
          )}
        </Card>
      </Section>

      <Section title="Your data">
        <Card padded={false} style={{ paddingHorizontal: 16 }}>
          <Row left={<IconMark icon="download" tint="export" />} title={busy ? 'Preparing…' : 'Download my data'} subtitle="Everything we store about you" onPress={busy ? undefined : exportData} chevron />
          <Divider inset={54} />
          <Row left={<IconMark icon="trash-2" tint="delete" />} title="Delete account" subtitle="Erase your personal data" onPress={remove} chevron />
        </Card>
      </Section>

      <Section title="Recent activity">
        <Card padded={false} style={{ paddingHorizontal: 16 }}>
          {data.log.slice(0, 6).map((l, i) => (
            <View key={i}>
              {i > 0 && <Divider />}
              <Row
                title={eventLabel(String(l.action))}
                subtitle={`${formatDate(l.timestamp)}, ${formatTime(l.timestamp)}${l.device ? ` · ${l.device}` : ''}${l.location ? ` · ${l.location}` : ''}`}
              />
            </View>
          ))}
        </Card>
      </Section>
      <Small style={{ marginTop: 18 }} color={C.ink3}>
        Something here you don&apos;t recognise? Sign out other devices, change your PIN and write to support straight away.
      </Small>
      <Sheet visible={!!pinStep} onClose={closePin} title={pinStep === 'new' ? 'New PIN' : pinStep === 'delete' ? 'Delete account' : 'Current PIN'}>
        <PinPad
          key={pinStep ?? 'none'}
          title={pinStep === 'new' ? 'Choose a new PIN' : pinStep === 'delete' ? 'Enter your PIN to delete your account' : 'Enter your current PIN'}
          subtitle={pinStep === 'new' ? '4 to 6 digits. Avoid 1234, 0000 and your birth year.' : undefined}
          error={pinError}
          busy={busy}
          onSubmit={onPin}
          testID="pin-change"
        />
      </Sheet>
    </Screen>
  );
}

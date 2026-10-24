import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { errorMessage, requestDeletion, sendOTP } from '../src/services/api';
import { useAuth } from '../src/context/AuthContext';
import { Body, Button, Card, Field, Pill, Screen, Small, Strong } from '../src/ui/kit';
import { LegalFooter } from '../src/ui/LegalFooter';
import { C } from '../src/ui/theme';

const PHONE_RE = /^[6-9]\d{9}$/;

/**
 * Public deletion request: for people who can't sign in (lost PIN, uninstalled app).
 * The one-time code proves the number is theirs. App stores require a page like this.
 */
export default function DeleteAccount() {
  const { user, logout } = useAuth();
  const [phone, setPhone] = useState('');
  const [sent, setSent] = useState(false);
  const [demoCode, setDemoCode] = useState('');
  const [otp, setOtp] = useState('');
  const [pin, setPin] = useState('');
  const [needsPin, setNeedsPin] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await sendOTP(phone);
      setDemoCode(res.demo_otp ?? '');
      setSent(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await requestDeletion(phone, otp, pin || undefined);
      setDone(res.deleted ? `${res.message} Payment and KYC records are kept until ${res.retain_until} because anti-money-laundering law requires it, and used for nothing else.` : res.message);
      if (res.deleted && user?.phone === phone) await logout().catch(() => {});
    } catch (e: any) {
      // Accounts with a PIN need it too: an OTP alone (say, after a SIM swap) can't erase one.
      if (e?.response?.status === 428) setNeedsPin(true);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Delete my data" kicker="Privacy">
      {done ? (
        <Card style={{ marginTop: 16, backgroundColor: C.greenSoft, borderColor: 'transparent' }} testID="deletion-done">
          <Strong>Done</Strong>
          <Body style={{ marginTop: 4 }}>{done}</Body>
        </Card>
      ) : (
        <>
          <Body style={{ marginTop: 6 }}>
            If you can sign in, the quickest way is Me → Security & privacy → Delete account. If you can’t, enter the mobile number on your account and we’ll send a code to confirm it’s yours.
          </Body>
          <Card style={{ marginTop: 18 }}>
            <Field
              label="Mobile number"
              prefix="+91"
              keyboardType="phone-pad"
              maxLength={10}
              value={phone}
              onChangeText={(t) => {
                setPhone(t.replace(/\D/g, ''));
                setSent(false);
              }}
              testID="delete-phone"
            />
            {!sent ? (
              <Button label="Send code" disabled={!PHONE_RE.test(phone)} loading={busy} onPress={send} testID="delete-send" />
            ) : (
              <>
                <Field label="6-digit code" keyboardType="number-pad" maxLength={6} value={otp} onChangeText={(t) => setOtp(t.replace(/\D/g, ''))} testID="delete-otp" />
                {demoCode ? (
                  <View style={{ marginBottom: 12 }}>
                    <Pill tone="gold" icon="info" label={`Demo mode · code ${demoCode}`} />
                  </View>
                ) : null}
                {needsPin ? (
                  <Field
                    label="App PIN"
                    keyboardType="number-pad"
                    secureTextEntry
                    maxLength={6}
                    value={pin}
                    onChangeText={(t) => setPin(t.replace(/\D/g, ''))}
                    testID="delete-pin"
                  />
                ) : null}
                <Pressable onPress={() => setConfirm((c) => !c)} style={{ flexDirection: 'row', alignItems: 'flex-start' }} accessibilityRole="checkbox" accessibilityState={{ checked: confirm }} aria-checked={confirm} testID="delete-confirm">
                  <Feather name={confirm ? 'check-square' : 'square'} size={20} color={confirm ? C.red : C.ink3} />
                  <Small color={C.ink2} style={{ flex: 1, marginLeft: 10 }}>
                    Delete my CoinQuest account and personal data. I understand this can’t be undone and I’ll lose my coins, goals and history.
                  </Small>
                </Pressable>
                <Button label="Delete my account" kind="danger" style={{ marginTop: 16 }} disabled={otp.length !== 6 || !confirm || (needsPin && pin.length < 4)} loading={busy} onPress={submit} testID="delete-submit" />
              </>
            )}
            {error ? (
              <View accessibilityLiveRegion="polite" accessibilityRole="alert">
                <Small color={C.red} style={{ marginTop: 12 }}>
                  {error}
                </Small>
              </View>
            ) : null}
          </Card>
          <Small style={{ marginTop: 14 }}>
            What we keep: payment and KYC records for 5 years, because the Prevention of Money Laundering Act requires it. They’re stored restricted and used for nothing else. Everything else is deleted straight away.
          </Small>
        </>
      )}
      <LegalFooter />
    </Screen>
  );
}

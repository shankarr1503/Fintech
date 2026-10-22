import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { errorMessage, getUPIHistory, getUPILinkedAccounts, isStepUpExpired, paymentByKey, requestMoneyUPI, sendMoneyUPI, verifyPin } from '../../src/services/api';
import { useOnline } from '../../src/ui/OfflineBanner';
import { PinPad } from '../../src/ui/PinPad';
import { MAX_PAYMENT, MIN_PAYMENT, setReceipt } from '../../src/services/receipt';
import { useUserData } from '../../src/game/useData';
import { useGame } from '../../src/game/GameContext';
import { Alert } from '../../src/ui/dialog';
import { Avatar, Button, haptic, IconButton, NATIVE, NO_OUTLINE, Row, Sheet, Small, Strong, useStatusBar } from '../../src/ui/kit';
import { SwipeToPay } from '../../src/ui/SwipeToPay';
import { C, F, GUTTER, R, themed } from '../../src/ui/theme';

// Must match STEP_UP_AMOUNT on the server: at or above this, the PIN is asked for.
const STEP_UP_AMOUNT = 2000;

const newKey = () => `pay-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'];

/** Ask the server about a payment by key a few times. Null while that's still unknown: unreachable, or a 404
 * that may come before the delayed original request, so a miss here doesn't prove nothing was sent. */
async function lookupPayment(key: string) {
  for (const wait of [0, 1500, 3000, 5000]) {
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    try {
      return await paymentByKey(key);
    } catch {
      // not received yet, or still offline: ask again
    }
  }
  return null;
}

type Account = { id: string; bank: string; account_number: string; is_primary: boolean; balance: number };

export default function AmountScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ to: string; name?: string; am?: string; tn?: string; mode?: string; src?: string }>();
  const request = params.mode === 'request';
  // Merchant QR with a set amount. Only lock it if it can actually be paid; otherwise they type one.
  const am = params.am && /^\d+(\.\d{1,2})?$/.test(params.am) && Number(params.am) >= MIN_PAYMENT && Number(params.am) <= MAX_PAYMENT ? params.am : '';
  const fixedAmount = !!am;
  const [amount, setAmount] = useState(am);
  const [note, setNote] = useState(params.tn ?? '');
  const [editingNote, setEditingNote] = useState(false);
  const [source, setSource] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [askPin, setAskPin] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const online = useOnline();
  const shake = useRef(new Animated.Value(0)).current;
  const { refresh } = useGame();
  useStatusBar('dark');
  const { data, userId } = useUserData((id) => getUPILinkedAccounts(id));
  // Anyone can put any name in a QR code or link, so the new-payee warning depends only on the UPI ID.
  const { data: history } = useUserData((id) => getUPIHistory(id));
  const payee = params.to?.toLowerCase();
  const paidBefore = Array.isArray(history) && history.some((t: any) => t.status === 'success' && (t.recipient ?? t.to)?.toLowerCase() === payee);

  const accounts: Account[] = data?.linked_accounts ?? [];
  const account = accounts.find((a) => a.id === source) ?? accounts.find((a) => a.is_primary) ?? accounts[0];
  const value = Number(amount || 0);
  const name = params.name || params.to?.split('@')[0] || '';
  const valid = value >= MIN_PAYMENT && value <= MAX_PAYMENT;

  useEffect(() => {
    if (!params.to) router.replace('/pay');
  }, [params.to, router]);

  const badAmount = !!params.am && !am;
  useEffect(() => {
    if (badAmount) Alert.alert("Can't use this amount", `The amount in this code can't be paid. Enter an amount from ₹${MIN_PAYMENT} to ₹${MAX_PAYMENT.toLocaleString('en-IN')}.`);
  }, [badAmount]);

  const nudge = () => {
    haptic('medium');
    Animated.sequence(
      [8, -8, 5, -5, 0].map((v) => Animated.timing(shake, { toValue: v, duration: 50, useNativeDriver: NATIVE })),
    ).start();
  };

  const press = (k: string) => {
    if (fixedAmount) return;
    haptic();
    setAmount((a) => {
      if (k === 'del') return a.slice(0, -1);
      if (k === '.') return a.includes('.') ? a : (a || '0') + '.';
      const [whole, frac] = (a + k).split('.');
      if (frac !== undefined && frac.length > 2) return a;
      const next = (whole.replace(/^0+(?=\d)/, '') || '0') + (frac !== undefined ? `.${frac}` : '');
      if (Number(next) > MAX_PAYMENT) {
        nudge();
        return a;
      }
      return next === '0' && k !== '0' ? k : next;
    });
  };

  // One key per payment attempt: retries after a timeout reuse it, so the server can never pay twice.
  const idemKey = useRef(newKey());
  useEffect(() => {
    idemKey.current = newKey();
  }, [value, note, params.to, account?.id]);

  const finish = useCallback(
    (res: any) => {
      setReceipt({
        status: res.status,
        reason: res.reason,
        txnId: res.transaction_id,
        key: idemKey.current,
        amount: res.amount,
        name: params.name || params.to,
        upi: params.to,
        ref: res.rail_ref || res.transaction_id,
        note,
        from: account ? `${account.bank} ··${account.account_number.slice(-4)}` : '',
        at: new Date().toISOString(),
        coins: res.coins_earned ?? 0,
        reward: res.reward,
      });
      refresh();
      router.replace('/pay/success');
    },
    [params.name, params.to, note, account, refresh, router],
  );

  const pay = useCallback(
    async (opts: { stepUpToken?: string; confirmDuplicate?: boolean; rekeyed?: boolean } = {}) => {
      setBusy(true);
      try {
        const { rekeyed, ...send } = opts;
        finish(await sendMoneyUPI(userId, params.to, value, note, account?.id ?? '', { idempotencyKey: idemKey.current, ...send }));
      } catch (e: any) {
        const status = e?.response?.status;
        const detail = errorMessage(e);
        if (!e?.response) {
          // Timed out or connection dropped: ask the server whether it got the payment before saying anything.
          const known = await lookupPayment(idemKey.current);
          // Still unknown (unreachable, or not seen yet while the original request may be on its way):
          // the receipt keeps checking by idempotency key and tells them not to pay again.
          if (!known) finish({ status: 'unknown', amount: value, transaction_id: '' });
          // Received but not finished yet: the receipt looks the transaction up by idempotency key.
          else if (known.status === 'processing') finish({ status: 'pending', amount: value, transaction_id: '', reason: 'Waiting for the bank to confirm' });
          else finish(known);
        } else if (status === 428) {
          setAskPin(true);
        } else if (isStepUpExpired(e)) {
          // Only the 5-minute PIN confirmation lapsed; nothing was sent.
          setPinError('Your PIN confirmation expired. Confirm your PIN again.');
          setAskPin(true);
        } else if (status === 409 && detail.includes('still being processed')) {
          // An earlier try with this key reached the server and is still running: wait for it, don't pay again.
          finish({ status: 'pending', amount: value, transaction_id: '', reason: 'Waiting for the bank to confirm' });
        } else if (status === 409 && detail.includes('already used for a different payment')) {
          // The key belongs to an attempt with other details, and nothing was sent for this one: retry once with a new key.
          idemKey.current = newKey();
          if (!opts.rekeyed) await pay({ ...opts, rekeyed: true });
          else Alert.alert('Payment not sent', 'Something went wrong on our side. No money has left your account. Please try again.');
        } else if (status === 409 && detail.includes('a moment ago')) {
          Alert.alert('Pay again?', detail, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Pay again',
              onPress: () => {
                idemKey.current = newKey();
                pay({ ...opts, confirmDuplicate: true });
              },
            },
          ]);
        } else if (status === 403 && detail.includes('KYC')) {
          Alert.alert('Limit reached', detail, [
            { text: 'Not now', style: 'cancel' },
            { text: 'Complete KYC', onPress: () => router.push('/kyc') },
          ]);
        } else {
          Alert.alert('Payment not sent', `${detail}${status === 503 ? '' : '\n\nNo money has left your account.'}`);
        }
      } finally {
        setBusy(false);
      }
    },
    [userId, params.to, value, note, account, finish, router],
  );

  const submit = useCallback(async () => {
    if (!valid || busy) return;
    if (request) {
      setBusy(true);
      try {
        await requestMoneyUPI(userId, params.to, value, note);
        Alert.alert('Request saved', `Your request to ${name} for ₹${value.toLocaleString('en-IN')} is saved under Pay. CoinQuest can’t send UPI collect requests yet, so share your UPI ID with them to get paid.`);
        router.back();
      } catch (e) {
        Alert.alert('Request failed', errorMessage(e));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (value >= STEP_UP_AMOUNT) setAskPin(true);
    else pay();
  }, [valid, busy, request, userId, params.to, value, note, name, router, pay]);

  const confirmPin = async (pin: string) => {
    setPinBusy(true);
    setPinError(null);
    try {
      const { step_up_token } = await verifyPin(pin);
      setAskPin(false);
      pay({ stepUpToken: step_up_token });
    } catch (e) {
      setPinError(errorMessage(e, 'Wrong PIN'));
    } finally {
      setPinBusy(false);
    }
  };

  const fontSize = amount.length > 7 ? 52 : amount.length > 5 ? 62 : 72;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.top}>
        <IconButton icon="x" label="Cancel" onPress={() => router.back()} />
        <Small>{request ? 'Requesting from' : 'Paying'}</Small>
        <View style={{ width: 42 }} />
      </View>

      <View style={styles.payee}>
        <Avatar name={name} size={60} />
        <Strong style={{ marginTop: 10, fontSize: 18 }} numberOfLines={1}>
          {params.name || name}
        </Strong>
        <View style={[styles.row, { marginTop: 3 }]}>
          <Small>{params.to}</Small>
        </View>
        {params.src === 'qr' && params.name ? <Small style={{ marginTop: 4 }}>Name from the QR code, not verified</Small> : null}
        {!paidBefore && <Small style={{ marginTop: 4 }}>New payee: check the UPI ID carefully before you pay</Small>}
      </View>

      <Animated.View style={[styles.amountWrap, { transform: [{ translateX: shake }] }]} accessible accessibilityLabel={`Amount ${value || 0} rupees`} testID="amount-display">
        <Text style={[styles.rupee, { fontSize: fontSize * 0.5 }]}>₹</Text>
        <Text style={[styles.amount, { fontSize, color: amount ? C.ink : C.lineStrong }]}>{amount ? Number(amount.split('.')[0]).toLocaleString('en-IN') + (amount.includes('.') ? '.' + (amount.split('.')[1] ?? '') : '') : '0'}</Text>
      </Animated.View>
      {fixedAmount ? (
        <Small center>Amount set by the merchant</Small>
      ) : null}

      <View style={{ alignItems: 'center', marginTop: 12 }}>
        {editingNote ? (
          <TextInput selectionColor={C.ink} cursorColor={C.ink}
            autoFocus
            value={note}
            onChangeText={setNote}
            onBlur={() => setEditingNote(false)}
            placeholder="What's it for?"
            placeholderTextColor={C.ink3}
            maxLength={50}
            style={styles.noteInput}
          />
        ) : (
          <Pressable onPress={() => setEditingNote(true)} style={styles.note} accessibilityRole="button" accessibilityLabel={note ? `Note: ${note}. Edit` : 'Add a note'}>
            <Feather name={note ? 'edit-3' : 'plus'} size={13} color={C.ink2} />
            <Text style={styles.noteText} numberOfLines={1}>
              {note || 'Add a note'}
            </Text>
          </Pressable>
        )}
      </View>

      <View style={{ flex: 1 }} />

      {!fixedAmount && (
        <View style={styles.keypad}>
          {KEYS.map((k) => (
            <Pressable
              key={k}
              onPress={() => press(k)}
              onLongPress={k === 'del' ? () => setAmount('') : undefined}
              style={({ pressed }) => [styles.key, pressed && { backgroundColor: C.paperDeep }]}
              accessibilityRole="button"
              accessibilityLabel={k === 'del' ? 'Delete' : k === '.' ? 'Decimal point' : k}
            >
              {k === 'del' ? <Feather name="delete" size={22} color={C.ink} /> : <Text style={styles.keyText}>{k}</Text>}
            </Pressable>
          ))}
        </View>
      )}

      <View style={styles.bottom}>
        {!request && account && (
          <Pressable onPress={() => setPicking(true)} style={styles.from} accessibilityRole="button" accessibilityLabel={`Pay from ${account.bank}. Change`} testID="pay-from">
            <View style={styles.bankDot}>
              <Feather name="credit-card" size={14} color={C.ink} />
            </View>
            <Text style={styles.fromText} numberOfLines={1}>
              {account.bank} ··{account.account_number.slice(-4)}
            </Text>
            <Text style={styles.change}>Change</Text>
          </Pressable>
        )}
        {request ? (
          <Button label={value ? `Request ₹${value.toLocaleString('en-IN')}` : 'Enter an amount'} disabled={!valid} loading={busy} onPress={submit} testID="request-btn" />
        ) : (
          <SwipeToPay
            label={!online ? 'You’re offline' : value ? `Swipe to pay ₹${value.toLocaleString('en-IN')}` : 'Enter an amount'}
            disabled={!valid || !online}
            busy={busy}
            onComplete={submit}
            testID="swipe-pay"
          />
        )}
      </View>

      <Sheet visible={picking} onClose={() => setPicking(false)} title="Pay from">
        {accounts.map((a) => {
          const on = a.id === account?.id;
          return (
            <Row
              key={a.id}
              left={<View style={styles.bankDot}><Feather name="credit-card" size={14} color={C.ink} /></View>}
              title={`${a.bank} ··${a.account_number.slice(-4)}`}
              subtitle={a.is_primary ? 'Primary · balance hidden' : 'Balance hidden'}
              right={<Feather name={on ? 'check-circle' : 'circle'} size={20} color={on ? C.green : C.lineStrong} />}
              onPress={() => {
                setSource(a.id);
                setPicking(false);
              }}
            />
          );
        })}
        <Small style={{ marginTop: 10 }}>Your balance is checked by the bank when you pay. We never store your UPI PIN.</Small>
      </Sheet>
      <Sheet visible={askPin} onClose={() => setAskPin(false)} title="Confirm with PIN">
        <PinPad
          title={`₹${value.toLocaleString('en-IN')} to ${params.name || name}`}
          subtitle="Payments of ₹2,000 or more need your PIN"
          error={pinError}
          busy={pinBusy}
          onSubmit={confirmPin}
          testID="stepup-pin"
        />
      </Sheet>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  root: { flex: 1, backgroundColor: C.paper },
  row: { flexDirection: 'row', alignItems: 'center' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: GUTTER, paddingTop: 6 },
  payee: { alignItems: 'center', marginTop: 10, paddingHorizontal: GUTTER },
  amountWrap: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', marginTop: 18 },
  rupee: { fontFamily: F.display, color: C.ink2, marginTop: 10, marginRight: 4 },
  amount: { fontFamily: F.display, letterSpacing: -1, fontVariant: ['tabular-nums'] },
  note: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 14, borderRadius: R.pill, backgroundColor: C.paperDeep, maxWidth: 260 },
  noteText: { fontFamily: F.medium, fontSize: 14, color: C.ink2 },
  noteInput: { minWidth: 200, height: 36, textAlign: 'center', fontFamily: F.medium, fontSize: 15, color: C.ink, borderBottomWidth: 1, borderColor: C.lineStrong, ...NO_OUTLINE },
  keypad: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: GUTTER - 6 },
  key: { width: '33.33%', height: 58, alignItems: 'center', justifyContent: 'center', borderRadius: R.sm },
  keyText: { fontFamily: F.medium, fontSize: 26, color: C.ink, fontVariant: ['tabular-nums'] },
  bottom: { paddingHorizontal: GUTTER, paddingTop: 10, paddingBottom: 8, gap: 12 },
  from: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  bankDot: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: C.lineStrong, alignItems: 'center', justifyContent: 'center' },
  fromText: { flex: 1, fontFamily: F.semibold, fontSize: 15, color: C.ink },
  change: { fontFamily: F.semibold, fontSize: 14, color: C.blue },
}));

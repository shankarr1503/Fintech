import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { analyzeDebts, createDebt, deleteDebt, errorMessage, getDebts, payDebt } from '../src/services/api';
import { useGame } from '../src/game/GameContext';
import { useUserData } from '../src/game/useData';
import { Alert } from '../src/ui/dialog';
import { Amount, Body, Button, Card, Chip, Display, Divider, Empty, ErrorState, Field, IconButton, Label, Pill, Progress, Screen, Section, Segmented, Sheet, SkeletonScreen, Small, Strong } from '../src/ui/kit';
import { C, R, themed } from '../src/ui/theme';
import { formatCompact, parseAmount } from '../src/utils/format';

type Debt = { id: string; name: string; type: string; principal: number; outstanding: number; interest_rate: number; emi_amount: number; remaining_tenure: number };

const TYPES = [
  { value: 'credit_card', label: 'Credit card' },
  { value: 'personal_loan', label: 'Loan' },
  { value: 'emi', label: 'EMI' },
  { value: 'other', label: 'Other' },
];
const EMPTY = { name: '', type: 'credit_card', outstanding: '', principal: '', interest_rate: '', emi_amount: '', remaining_tenure: '' };

export default function Debts() {
  const { celebrate } = useGame();
  const [plan, setPlan] = useState<'avalanche' | 'snowball'>('avalanche');
  const [extra, setExtra] = useState(0);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [target, setTarget] = useState<Debt | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const { data, loading, refreshing, refresh, reload, userId, error } = useUserData(
    async (id) => {
      const [debts, analysis] = await Promise.all([getDebts(id), analyzeDebts(id, extra)]);
      return { debts: debts as Debt[], analysis };
    },
    [extra],
  );

  if (loading || !data)
    return (
      <Screen title="Debts">
        {error ? <ErrorState onRetry={reload} /> : <SkeletonScreen />}
      </Screen>
    );

  const { debts, analysis } = data;
  const active = plan === 'avalanche' ? analysis.avalanche_analysis : analysis.snowball_analysis;
  // Same priority the payoff engine uses: extra money goes to the first unpaid debt in this order.
  const sorted = [...debts].sort((a, b) => {
    if ((a.outstanding <= 0) !== (b.outstanding <= 0)) return a.outstanding <= 0 ? 1 : -1;
    return plan === 'avalanche' ? b.interest_rate - a.interest_rate : a.outstanding - b.outstanding;
  });
  const borrowed = debts.reduce((s, d) => s + d.principal, 0);
  const progress = borrowed ? 1 - analysis.total_debt / borrowed : 0;

  const add = async () => {
    const outstanding = parseAmount(form.outstanding);
    const emi = parseAmount(form.emi_amount);
    const principal = form.principal.trim() ? parseAmount(form.principal) : outstanding;
    const rate = form.interest_rate.trim() ? parseAmount(form.interest_rate.replace('%', '')) : 0;
    if (!form.name.trim() || !(outstanding > 0) || !(emi > 0)) return Alert.alert('A few details missing', 'Name, amount owed and monthly payment are needed.');
    if (!(principal > 0) || !(rate >= 0 && rate <= 100)) return Alert.alert('Check the numbers', 'Enter amounts like 1,00,000 and the interest rate as a percentage, like 36.');
    setBusy(true);
    try {
      const res = await createDebt({
        user_id: userId,
        name: form.name.trim(),
        type: form.type,
        principal,
        outstanding,
        interest_rate: rate,
        emi_amount: emi,
        remaining_tenure: parseInt(form.remaining_tenure, 10) || 12,
      });
      setAdding(false);
      setForm(EMPTY);
      celebrate('Debt added to your plan', res.reward);
      reload();
    } catch (e) {
      Alert.alert("Couldn't add it", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const pay = async () => {
    if (!target) return;
    const a = parseAmount(amount);
    if (!(a > 0)) return Alert.alert('Check the amount', 'Enter it as a number, like 1,000.');
    setBusy(true);
    try {
      const res = await payDebt(target.id, a);
      setTarget(null);
      celebrate(res.defeated ? `${target.name} is paid off` : `${formatCompact(res.paid)} off ${target.name}`, res.reward);
      reload();
    } catch (e) {
      Alert.alert("Couldn't log that payment", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = (d: Debt) =>
    Alert.alert(`Remove ${d.name}?`, 'It will be taken out of your payoff plan.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteDebt(d.id);
            reload();
          } catch (e) {
            Alert.alert('Error', errorMessage(e));
          }
        },
      },
    ]);

  return (
    <Screen title="Debts" right={<IconButton icon="plus" label="Add a debt" onPress={() => setAdding(true)} testID="add-debt" />} refreshing={refreshing} onRefresh={refresh}>
      {debts.length === 0 ? (
        <Empty icon="check-circle" title="You owe nothing" body="Add a card or loan to plan your payoff." action={<Button label="Add a debt" small onPress={() => setAdding(true)} />} />
      ) : (
        <>
          <Card dark style={{ marginTop: 14, borderRadius: R.lg, padding: 22 }}>
            <Label color={C.nightMuted}>Debt-free by</Label>
            <Display color={C.nightText} style={{ fontSize: 38, lineHeight: 42, marginTop: 6 }}>
              {active?.debt_free_date ?? (active?.pays_off === false ? 'Not yet' : '—')}
            </Display>
            <Small color={C.nightMuted} style={{ marginTop: 4 }}>
              {active?.pays_off === false
                ? 'Your payments don’t cover the interest. Pay more each month to see a date.'
                : `${active?.total_months} months · ${formatCompact(active?.total_interest ?? 0)} total interest`}
            </Small>
            <View style={{ marginTop: 18 }}>
              <Progress value={progress} max={1} color={C.gold} track={C.night3} height={4} />
            </View>
            <View style={[styles.between, { marginTop: 10 }]}>
              <Small color={C.nightMuted}>{formatCompact(analysis.total_debt)} left</Small>
              <Small color={C.nightMuted}>{formatCompact(analysis.total_emi)}/mo</Small>
            </View>
          </Card>

          <Section title="Your plan">
            <Segmented
              value={plan}
              onChange={setPlan}
              options={[
                { value: 'avalanche', label: 'Highest interest first' },
                { value: 'snowball', label: 'Smallest first' },
              ]}
            />
            <Body style={{ marginTop: 12 }}>
              {plan === 'avalanche'
                ? analysis.interest_saved_with_avalanche > 0
                  ? `Saves ${formatCompact(analysis.interest_saved_with_avalanche)} in interest compared with paying the smallest first.`
                  : 'Puts every spare rupee on the most expensive debt.'
                : 'Clears small debts quickly so you see progress sooner. Costs a little more interest.'}
            </Body>
            <Small style={{ marginTop: 14, marginBottom: 8 }}>Pay extra each month</Small>
            <View style={{ flexDirection: 'row' }}>
              {[0, 2000, 5000, 10000].map((v) => (
                <Chip key={v} label={v ? `+${formatCompact(v)}` : 'Nothing'} active={extra === v} onPress={() => setExtra(v)} />
              ))}
            </View>
          </Section>

          <Section title={plan === 'avalanche' ? 'Highest interest first' : 'Smallest balance first'}>
            {sorted.map((d, i) => {
              const paid = d.principal ? 1 - d.outstanding / d.principal : 0;
              const done = d.outstanding <= 0;
              return (
                <Card key={d.id} style={{ marginBottom: 10 }}>
                  <View style={styles.between}>
                    <View style={{ flex: 1 }}>
                      <Small>{done ? 'Paid off' : i === 0 ? 'Put extra money here' : `Then #${i + 1}`}</Small>
                      <Strong style={{ marginTop: 2, fontSize: 16 }}>{d.name}</Strong>
                    </View>
                    <Pressable onPress={() => remove(d)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${d.name}`}>
                      <Small>Remove</Small>
                    </Pressable>
                  </View>
                  <View style={[styles.between, { marginTop: 14, alignItems: 'flex-end' }]}>
                    <Amount value={d.outstanding} size={24} />
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <Pill label={`${d.interest_rate}%`} tone={d.interest_rate >= 24 ? 'red' : 'neutral'} />
                      <Pill label={`${formatCompact(d.emi_amount)}/mo`} />
                    </View>
                  </View>
                  <View style={{ marginTop: 12 }}>
                    <Progress value={paid} max={1} color={done ? C.green : C.ink} height={4} />
                  </View>
                  <Small style={{ marginTop: 6 }}>{Math.round(paid * 100)}% paid of {formatCompact(d.principal)}</Small>
                  {!done && (
                    <>
                      <Divider />
                      <Pressable
                        onPress={() => {
                          setTarget(d);
                          setAmount(String(Math.min(d.emi_amount, d.outstanding)));
                        }}
                        style={{ paddingTop: 12 }}
                        accessibilityRole="button"
                        testID={`log-payment-${i}`}
                      >
                        <Strong color={C.blue}>Log a payment</Strong>
                      </Pressable>
                    </>
                  )}
                </Card>
              );
            })}
          </Section>
        </>
      )}

      <Sheet visible={!!target} onClose={() => setTarget(null)} title="Log a payment">
        <Body style={{ marginBottom: 16 }}>How much did you pay towards {target?.name}?</Body>
        <Field prefix="₹" keyboardType="numeric" value={amount} onChangeText={setAmount} autoFocus />
        <Button label="Save payment" loading={busy} onPress={pay} testID="save-payment" />
      </Sheet>

      <Sheet visible={adding} onClose={() => setAdding(false)} title="Add a debt">
        <Field label="Name" placeholder="HDFC credit card" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 8, marginBottom: 16 }}>
          {TYPES.map((t) => (
            <Chip key={t.value} label={t.label} active={form.type === t.value} onPress={() => setForm({ ...form, type: t.value })} />
          ))}
        </View>
        <Field label="Amount you owe" prefix="₹" keyboardType="numeric" value={form.outstanding} onChangeText={(v) => setForm({ ...form, outstanding: v })} />
        <Field label="Monthly payment" prefix="₹" keyboardType="numeric" value={form.emi_amount} onChangeText={(v) => setForm({ ...form, emi_amount: v })} />
        <Field label="Interest rate (% a year)" keyboardType="numeric" value={form.interest_rate} onChangeText={(v) => setForm({ ...form, interest_rate: v })} hint="Credit cards are usually 36–42%." />
        <Field label="Original amount (optional)" prefix="₹" keyboardType="numeric" value={form.principal} onChangeText={(v) => setForm({ ...form, principal: v })} />
        <Button label="Add to plan" loading={busy} onPress={add} />
      </Sheet>
    </Screen>
  );
}

const styles = themed(() => StyleSheet.create({
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
}));

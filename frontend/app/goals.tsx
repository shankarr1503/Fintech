import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { contributeSavings, createSavingsGoal, deleteSavingsGoal, errorMessage, getSavingsGoals, getSavingsSuggestions } from '../src/services/api';
import { useGame } from '../src/game/GameContext';
import { useUserData } from '../src/game/useData';
import { Alert } from '../src/ui/dialog';
import { Amount, Body, Button, Card, Chip, Empty, ErrorState, Field, IconButton, Label, Ring, Screen, Section, Sheet, SkeletonScreen, Small, Strong } from '../src/ui/kit';
import { C, themed } from '../src/ui/theme';
import { formatCompact, formatDate, parseAmount } from '../src/utils/format';

type Goal = { id: string; name: string; target_amount: number; current_amount: number; monthly_contribution: number; target_date?: string };

const PLAN_LABEL: Record<string, string> = { safe: 'Comfortable', moderate: 'Steady', aggressive: 'Ambitious' };

export default function Goals() {
  const { celebrate } = useGame();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', target: '', monthly: '' });
  const [target, setTarget] = useState<Goal | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const { data, loading, refreshing, refresh, reload, userId, error } = useUserData(async (id) => {
    const [goals, suggestions] = await Promise.all([getSavingsGoals(id), getSavingsSuggestions(id)]);
    return { goals: goals as Goal[], suggestions: suggestions as { type: string; amount: number; description: string }[] };
  });

  if (loading || !data)
    return (
      <Screen title="Goals">
        {error ? <ErrorState onRetry={reload} /> : <SkeletonScreen />}
      </Screen>
    );

  const saved = data.goals.reduce((s, g) => s + g.current_amount, 0);

  const create = async () => {
    const t = parseAmount(form.target);
    const monthly = form.monthly.trim() ? parseAmount(form.monthly) : 0;
    if (!form.name.trim() || !(t > 0)) return Alert.alert('Almost there', 'Give the goal a name and an amount.');
    if (!(monthly >= 0)) return Alert.alert('Check the monthly amount', 'Enter it as a number, like 5,000.');
    setBusy(true);
    try {
      const res = await createSavingsGoal({ user_id: userId, name: form.name.trim(), target_amount: t, monthly_contribution: monthly });
      setCreating(false);
      setForm({ name: '', target: '', monthly: '' });
      celebrate('Goal created', res.reward);
      reload();
    } catch (e) {
      Alert.alert("Couldn't create it", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (!target) return;
    const a = parseAmount(amount);
    if (!(a > 0)) return Alert.alert('Check the amount', 'Enter it as a number, like 1,000.');
    setBusy(true);
    try {
      const res = await contributeSavings(target.id, a);
      setTarget(null);
      celebrate(res.completed ? `${target.name}: goal reached` : `${formatCompact(a)} saved`, res.reward);
      reload();
    } catch (e) {
      Alert.alert("Couldn't save", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = (g: Goal) =>
    Alert.alert(`Delete ${g.name}?`, 'This only removes the goal from CoinQuest. No money moves.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteSavingsGoal(g.id);
            reload();
          } catch (e) {
            Alert.alert('Error', errorMessage(e));
          }
        },
      },
    ]);

  return (
    <Screen title="Goals" right={<IconButton icon="plus" label="New goal" onPress={() => setCreating(true)} testID="add-goal" />} refreshing={refreshing} onRefresh={refresh}>
      <Small style={{ marginTop: 4 }}>
        {formatCompact(saved)} saved across {data.goals.length} {data.goals.length === 1 ? 'goal' : 'goals'}
      </Small>

      {data.goals.length === 0 ? (
        <Empty icon="target" title="What are you saving for?" body="A trip, a new phone, three months of rent as a cushion…" action={<Button label="Start a goal" small onPress={() => setCreating(true)} />} />
      ) : (
        <View style={{ marginTop: 16, gap: 10 }}>
          {data.goals.map((g) => {
            const pct = g.target_amount ? g.current_amount / g.target_amount : 0;
            const left = Math.max(0, g.target_amount - g.current_amount);
            const months = g.monthly_contribution > 0 ? Math.ceil(left / g.monthly_contribution) : null;
            const done = pct >= 1;
            return (
              <Card key={g.id}>
                <View style={styles.row}>
                  <Ring value={pct} size={64} stroke={5} color={done ? C.green : C.ink}>
                    <Strong style={{ fontSize: 14 }}>{Math.min(100, Math.round(pct * 100))}%</Strong>
                  </Ring>
                  <View style={{ flex: 1, marginLeft: 16 }}>
                    <Strong style={{ fontSize: 16 }}>{g.name}</Strong>
                    <View style={[styles.row, { marginTop: 4 }]}>
                      <Amount value={g.current_amount} size={15} />
                      <Small> of {formatCompact(g.target_amount)}</Small>
                    </View>
                    <Small style={{ marginTop: 2 }}>
                      {done
                        ? 'Done. Time to spend it, or set a bigger one.'
                        : months
                          ? `${months} more months at ${formatCompact(g.monthly_contribution)}/month`
                          : g.target_date
                            ? `Target ${formatDate(g.target_date)}`
                            : `${formatCompact(left)} to go`}
                    </Small>
                  </View>
                </View>
                <View style={[styles.row, { marginTop: 14, gap: 10 }]}>
                  {!done && <Button label="Add money" small onPress={() => { setTarget(g); setAmount(g.monthly_contribution ? String(g.monthly_contribution) : ''); }} />}
                  <Pressable onPress={() => remove(g)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Delete ${g.name}`}>
                    <Small>Delete</Small>
                  </Pressable>
                </View>
              </Card>
            );
          })}
        </View>
      )}

      {data.suggestions.length > 0 && (
        <Section title="How much could you save a month?">
          <Card padded={false}>
            {data.suggestions.map((sug, i) => (
              <View key={sug.type} style={[styles.plan, i > 0 && styles.planLine]}>
                <View style={{ flex: 1 }}>
                  <Label>{PLAN_LABEL[sug.type] ?? sug.type}</Label>
                  <Body style={{ marginTop: 4, fontSize: 13, lineHeight: 18 }}>{sug.description}</Body>
                </View>
                <Amount value={Math.round(sug.amount)} size={17} />
              </View>
            ))}
          </Card>
        </Section>
      )}

      <Sheet visible={!!target} onClose={() => setTarget(null)} title="Add money">
        <Body style={{ marginBottom: 14 }}>Log money you’ve set aside for {target?.name}. CoinQuest keeps track; the money stays in your bank account.</Body>
        <View style={{ flexDirection: 'row', marginBottom: 14 }}>
          {[500, 1000, 5000].map((v) => (
            <Chip key={v} label={`₹${v.toLocaleString('en-IN')}`} active={amount === String(v)} onPress={() => setAmount(String(v))} />
          ))}
        </View>
        <Field prefix="₹" keyboardType="numeric" value={amount} onChangeText={setAmount} />
        <Button label="Save" loading={busy} onPress={add} testID="save-goal-money" />
      </Sheet>

      <Sheet visible={creating} onClose={() => setCreating(false)} title="New goal">
        <Field label="What for?" placeholder="Goa in December" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} />
        <Field label="How much?" prefix="₹" keyboardType="numeric" value={form.target} onChangeText={(v) => setForm({ ...form, target: v })} />
        <Field label="Monthly amount (optional)" prefix="₹" keyboardType="numeric" value={form.monthly} onChangeText={(v) => setForm({ ...form, monthly: v })} hint="We'll tell you when you'll get there." />
        <Button label="Create goal" loading={busy} onPress={create} />
      </Sheet>
    </Screen>
  );
}

const styles = themed(() => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  plan: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  planLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
}));


import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { analyzeDebts, getAllAccounts, getCreditScore, getDashboard, getSavingsGoals } from '../../src/services/api';
import { useUserData } from '../../src/game/useData';
import { TxnRow } from '../../src/ui/rows';
import { Amount, Body, Card, Divider, ErrorState, IconMark, IconName, Label, Ring, Row, Screen, Section, SkeletonScreen, Small, Strong, Title } from '../../src/ui/kit';
import { C, R, SERIES, themed } from '../../src/ui/theme';
import { formatCompact } from '../../src/utils/format';

export default function MoneyTab() {
  const router = useRouter();
  const go = (r: string) => router.push(r as any);
  const { data, loading, refreshing, refresh } = useUserData(async (id) => {
    const [dash, accounts, goals, debts, credit] = await Promise.all([
      getDashboard(id),
      getAllAccounts(id),
      getSavingsGoals(id),
      analyzeDebts(id),
      getCreditScore(id).catch(() => null),
    ]);
    return { dash, accounts, goals: goals as any[], debts, credit };
  });

  if (loading)
    return (
      <Screen title="Money" back={false}>
        <SkeletonScreen />
      </Screen>
    );
  if (!data)
    return (
      <Screen title="Money" back={false}>
        <ErrorState onRetry={refresh} />
      </Screen>
    );

  const { dash, accounts, goals, debts, credit } = data;
  const s = accounts.summary;
  const assets = s.total_balance + s.total_deposits + s.total_investments;
  const net = assets - debts.total_debt;
  const cats = Object.entries(dash.category_breakdown as Record<string, number>)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const spent = dash.spending.this_month || 1;

  return (
    <Screen title="Money" back={false} refreshing={refreshing} onRefresh={refresh}>
      {/* Net worth */}
      <Card style={{ marginTop: 14, borderRadius: R.lg }} padded={false}>
        <View style={{ padding: 20 }}>
          <Label>Net worth</Label>
          <Amount value={net} display size={42} style={{ marginTop: 8 }} color={net < 0 ? C.red : C.ink} />
          <Small style={{ marginTop: 4 }}>What you own minus what you owe</Small>
        </View>
        <Divider />
        <View style={styles.split}>
          <View style={styles.splitCell}>
            <Small>You own</Small>
            <Strong style={{ marginTop: 2 }}>{formatCompact(assets)}</Strong>
          </View>
          <View style={[styles.splitCell, styles.splitLine]}>
            <Small>You owe</Small>
            <Strong style={{ marginTop: 2 }}>{formatCompact(debts.total_debt)}</Strong>
          </View>
          <View style={[styles.splitCell, styles.splitLine]}>
            <Small>Credit score</Small>
            <Strong style={{ marginTop: 2 }}>{credit?.score ?? '—'}</Strong>
          </View>
        </View>
      </Card>

      {/* Where it went */}
      <Section title="Spent this month" action="Details" onAction={() => go('/expenses')}>
        <Card>
          <Amount value={dash.spending.this_month} size={24} />
          <Small style={{ marginTop: 2 }}>
            {dash.spending.change_percentage > 0 ? `${dash.spending.change_percentage}% more` : `${Math.abs(dash.spending.change_percentage)}% less`} than this point last month
          </Small>
          <View style={styles.stack}>
            {cats.map(([cat, v], i) => (
              <View key={cat} style={{ flex: v, backgroundColor: STACK[i % STACK.length] }} />
            ))}
          </View>
          {cats.map(([cat, v], i) => (
            <View key={cat} style={styles.catRow}>
              <View style={[styles.swatch, { backgroundColor: STACK[i % STACK.length] }]} />
              <Body style={{ flex: 1, color: C.ink, textTransform: 'capitalize' }}>{cat === 'emi' ? 'EMIs' : cat}</Body>
              <Small style={{ marginRight: 10 }}>{Math.round((v / spent) * 100)}%</Small>
              <Amount value={Math.round(v)} size={15} />
            </View>
          ))}
        </Card>
      </Section>

      {/* Accounts */}
      <Section title="Accounts" action="All" onAction={() => go('/my-wallet')}>
        <Card padded={false} style={{ paddingHorizontal: 16 }}>
          {(accounts.bank_accounts as any[]).map((a, i) => (
            <View key={a.id}>
              {i > 0 && <Divider inset={54} />}
              <Row
                left={<IconMark icon="credit-card" tint={a.bank} />}
                title={a.bank}
                subtitle={`${a.type} ··${a.account_number.slice(-4)}${a.is_salary_account ? ' · Salary' : ''}`}
                right={<Amount value={a.balance} size={15} />}
                onPress={() => go('/my-wallet')}
              />
            </View>
          ))}
          <Divider inset={54} />
          <Row left={<IconMark icon="link-2" tint="link" />} title="Link more accounts" subtitle="With your consent, via an Account Aggregator" onPress={() => go('/account-aggregator')} chevron />
        </Card>
      </Section>

      {/* Debts & goals */}
      <Section title="Paying off" action="Plan" onAction={() => go('/debts')}>
        <Card onPress={() => go('/debts')} accessibilityLabel="Debt payoff plan">
          <View style={styles.between}>
            <View>
              <Title>{debts.avalanche_analysis?.debt_free_date
                  ? `Debt-free by ${debts.avalanche_analysis.debt_free_date}`
                  : debts.avalanche_analysis?.pays_off === false
                    ? 'Payments don’t cover interest'
                    : 'No debts'}</Title>
              <Small style={{ marginTop: 2 }}>
                {formatCompact(debts.total_debt)} left · {formatCompact(debts.total_emi)}/month in EMIs
              </Small>
            </View>
          </View>
        </Card>
      </Section>

      <Section title="Saving for" action="Goals" onAction={() => go('/goals')}>
        <Card padded={false} style={{ paddingHorizontal: 16 }}>
          {goals.length === 0 ? (
            <Row left={<IconMark icon="plus" tint="goal" />} title="Start a goal" subtitle="Trip, phone, emergency fund…" onPress={() => go('/goals')} chevron />
          ) : (
            goals.slice(0, 3).map((g, i) => {
              const pct = g.target_amount ? g.current_amount / g.target_amount : 0;
              return (
                <View key={g.id}>
                  {i > 0 && <Divider inset={60} />}
                  <Row
                    left={
                      <Ring value={pct} size={44} stroke={4} color={C.green}>
                        <Small color={C.ink} style={{ fontSize: 11 }}>{Math.round(pct * 100)}%</Small>
                      </Ring>
                    }
                    title={g.name}
                    subtitle={`${formatCompact(g.current_amount)} of ${formatCompact(g.target_amount)}`}
                    onPress={() => go('/goals')}
                    chevron
                  />
                </View>
              );
            })
          )}
        </Card>
      </Section>

      {/* Activity */}
      <Section title="Recent activity" action="See all" onAction={() => go('/activity')}>
        <Card padded={false} style={{ paddingHorizontal: 16 }}>
          {(dash.recent_transactions as any[]).slice(0, 5).map((t, i) => (
            <View key={t.id || i}>
              {i > 0 && <Divider inset={54} />}
              <TxnRow txn={t} />
            </View>
          ))}
        </Card>
      </Section>

      <Section title="Tools">
        <Card padded={false} style={{ paddingHorizontal: 16 }}>
          {(
            [
              ['activity', 'Credit score', 'Score, factors and cards', '/credit-score'],
              ['layers', 'Loans against investments', 'See rates and all costs first', '/digital-loans'],
              ['file-text', 'Bills & recharges', 'Rent, power, broadband', '/bills'],
            ] as [IconName, string, string, string][]
          ).map(([icon, title, sub, route], i) => (
            <View key={route}>
              {i > 0 && <Divider inset={54} />}
              <Row left={<IconMark icon={icon} tint={title} />} title={title} subtitle={sub} onPress={() => go(route)} chevron />
            </View>
          ))}
        </Card>
      </Section>
    </Screen>
  );
}

// Muted, distinguishable steps (not a rainbow) for the spending bar; the legend names each slice.
const STACK = SERIES;


const styles = themed(() => StyleSheet.create({
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  split: { flexDirection: 'row' },
  splitCell: { flex: 1, paddingVertical: 14, paddingHorizontal: 16 },
  splitLine: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: C.line },
  stack: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', marginTop: 16, marginBottom: 6, gap: 2 },
  catRow: { flexDirection: 'row', alignItems: 'center', paddingTop: 12 },
  swatch: { width: 10, height: 10, borderRadius: 3, marginRight: 10 },
}));

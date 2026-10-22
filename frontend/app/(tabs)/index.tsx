import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { analyzeDebts, errorMessage, getBills, getDashboard, getInsights, getNotifications, getRecentPayees } from '../../src/services/api';
import { PushPrompt } from '../../src/ui/PushPrompt';
import { useDemo } from '../../src/services/appConfig';
import { Alert } from '../../src/ui/dialog';
import { useAuth } from '../../src/context/AuthContext';
import { useGame } from '../../src/game/GameContext';
import { Coin } from '../../src/game/Coin';
import { useUserData } from '../../src/game/useData';
import {
  ActionTile,
  Amount,
  Avatar,
  Body,
  Button,
  Card,
  Display,
  ErrorState,
  IconButton,
  IconMark,
  IconName,
  Label,
  Progress,
  Ring,
  Row,
  Section,
  SkeletonScreen,
  Small,
  Strong,
  Title,
  haptic,
  useStatusBar,
} from '../../src/ui/kit';
import { C, F, GUTTER, R, themed } from '../../src/ui/theme';
import { daysUntil, formatCompact } from '../../src/utils/format';

const SERVICES: { label: string; icon: IconName; route: string }[] = [
  { label: 'Credit score', icon: 'activity', route: '/credit-score' },
  { label: 'Loans', icon: 'layers', route: '/digital-loans' },
  { label: 'Link banks', icon: 'link-2', route: '/account-aggregator' },
  { label: 'Accounts', icon: 'credit-card', route: '/my-wallet' },
  { label: 'Spending', icon: 'bar-chart-2', route: '/expenses' },
  { label: 'Learn', icon: 'book-open', route: '/learn' },
  { label: 'Goals', icon: 'target', route: '/goals' },
  { label: 'Help', icon: 'help-circle', route: '/help' },
];

const BILL_ICON: Record<string, IconName> = { rent: 'home', utility: 'zap', recharge: 'smartphone', insurance: 'shield' };

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Up late';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function Home() {
  const router = useRouter();
  const { user } = useAuth();
  const demo = useDemo();
  const { profile, checkIn, refresh: refreshGame } = useGame();
  const [checking, setChecking] = useState(false);
  useStatusBar('dark');
  const { data, loading, refreshing, refresh, error } = useUserData(async (id) => {
    const [dashboard, insights, payees, bills, debts] = await Promise.all([
      getDashboard(id),
      getInsights(id).catch(() => []),
      getRecentPayees(id).catch(() => []),
      getBills(id).catch(() => []),
      analyzeDebts(id).catch(() => null),
    ]);
    return { dashboard, insights, payees, bills, debts };
  });

  // Unread alerts, refreshed whenever Home comes back into view.
  const [unread, setUnread] = useState(0);
  useFocusEffect(
    useCallback(() => {
      if (user?.id) getNotifications(user.id).then((n) => setUnread(n.unread ?? 0)).catch(() => {});
    }, [user?.id]),
  );

  const dueSoon = useMemo(
    () =>
      ((data?.bills ?? []) as any[])
        .filter((b) => b.status !== 'paid')
        .sort((a, b) => a.due_date.localeCompare(b.due_date))
        .slice(0, 3),
    [data],
  );

  const go = (route: string) => router.push(route as any);
  const firstName = (user?.name || '').split(' ')[0];

  if (loading)
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <SkeletonScreen />
      </SafeAreaView>
    );
  if (!data?.dashboard)
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ErrorState onRetry={refresh} />
      </SafeAreaView>
    );

  const d = data.dashboard;
  const spentShare = d.income > 0 ? d.spending.this_month / d.income : 0;
  const insight = (data.insights as any[])[0];
  const debtFree = data.debts?.avalanche_analysis?.debt_free_date ?? (data.debts?.avalanche_analysis?.pays_off === false ? 'Not yet' : undefined);
  const questsLeft = profile ? profile.quests.filter((q) => !q.done).length : 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              refresh();
              refreshGame();
            }}
            tintColor={C.ink}
          />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Small>{greeting()}{firstName ? ',' : ''}</Small>
            <Display style={{ fontSize: 34, lineHeight: 38 }} numberOfLines={1}>
              {firstName || 'Welcome'}
            </Display>
          </View>
          <IconButton icon="bell" label={unread ? `Notifications, ${unread} unread` : 'Notifications'} badge={unread > 0} onPress={() => go('/notifications')} testID="home-bell" />
          <Pressable onPress={() => go('/(tabs)/me')} accessibilityRole="button" accessibilityLabel="Your profile" style={{ marginLeft: 10 }}>
            <Avatar name={user?.name || ''} size={42} />
          </Pressable>
        </View>

        {demo && (
          <View style={styles.demo} accessibilityRole={'note' as any} testID="demo-notice">
            <Feather name="info" size={14} color={C.ink2} />
            <Small color={C.ink2} style={{ flex: 1, marginLeft: 8 }}>
              Demo mode: balances, bills and scores are sample data, and no real money moves.
            </Small>
          </View>
        )}

        {/* Hero: money left this month */}
        <Card dark style={styles.hero} onPress={() => go('/expenses')} accessibilityLabel="Spending this month" testID="hero">
          <View style={styles.between}>
            <Label color={C.nightMuted}>Left this month</Label>
            <View style={styles.row}>
              <Small color={C.nightMuted}>Spending</Small>
              <Feather name="arrow-up-right" size={14} color={C.nightMuted} style={{ marginLeft: 2 }} />
            </View>
          </View>
          <Amount value={d.spending.remaining_balance} size={46} display color={C.nightText} style={{ marginTop: 10 }} testID="left-this-month" />
          <View style={{ marginTop: 18 }}>
            <Progress value={spentShare} max={1} color={C.gold} track={C.night3} height={4} />
          </View>
          <View style={[styles.between, { marginTop: 12 }]}>
            <Small color={C.nightMuted}>
              In <Text style={styles.heroNum}>{formatCompact(d.income)}</Text>
            </Small>
            <Small color={C.nightMuted}>
              Spent <Text style={styles.heroNum}>{formatCompact(d.spending.this_month)}</Text>
              <Text style={{ color: C.nightText }}>
                {'  '}
                {d.spending.change_percentage > 0 ? '↑' : '↓'}
                {Math.abs(d.spending.change_percentage)}%
              </Text>
            </Small>
          </View>
        </Card>

        {/* The four jobs */}
        <View style={styles.actions}>
          <ActionTile icon="maximize" label="Scan QR" tone="dark" onPress={() => go('/scan')} testID="action-scan" />
          <ActionTile icon="send" label="Pay anyone" onPress={() => go('/pay')} testID="action-pay" />
          <ActionTile icon="file-text" label="Pay bills" onPress={() => go('/bills')} testID="action-bills" />
          <ActionTile icon="eye" label="Balances" onPress={() => go('/my-wallet')} />
        </View>

        {/* People */}
        <Section title="People" action="See all" onAction={() => go('/pay')}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -GUTTER }} contentContainerStyle={{ paddingHorizontal: GUTTER, gap: 14 }}>
            <Pressable onPress={() => go('/pay')} style={styles.person} accessibilityRole="button" accessibilityLabel="Pay someone new">
              <View style={styles.newPerson}>
                <Feather name="plus" size={20} color={C.ink} />
              </View>
              <Small color={C.ink} style={styles.personName}>
                New
              </Small>
            </Pressable>
            {(data.payees as any[]).map((p) => (
              <Pressable
                key={p.id}
                onPress={() => {
                  haptic();
                  router.push({ pathname: '/pay/amount', params: { to: p.upi_id, name: p.name } });
                }}
                style={styles.person}
                accessibilityRole="button"
                accessibilityLabel={`Pay ${p.name}`}
              >
                <Avatar name={p.name} size={52} />
                <Small color={C.ink} style={styles.personName} numberOfLines={1}>
                  {p.name.split(' ')[0]}
                </Small>
              </Pressable>
            ))}
          </ScrollView>
        </Section>

        {/* The game, in one quiet strip */}
        {profile && (
          <Card style={{ marginTop: 24 }} padded={false} onPress={() => go('/(tabs)/rewards')} accessibilityLabel="Rewards and streak" testID="streak-strip">
            <View style={[styles.row, { padding: 14 }]}>
              <Ring value={profile.progress / 100} size={48} stroke={4} color={C.gold}>
                <Text style={styles.level}>{profile.level}</Text>
              </Ring>
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Strong>
                  {profile.streak > 0 ? `${profile.streak}-day streak` : 'Start a streak'}
                  <Text style={{ color: C.ink3, fontFamily: F.regular }}>{'  ·  '}Level {profile.level}</Text>
                </Strong>
                <Small style={{ marginTop: 2 }}>
                  {questsLeft ? `${questsLeft} of ${profile.quests.length} quests left today` : 'All quests done today'}
                </Small>
              </View>
              {!profile.checked_in_today ? (
                <Button
                  label="Check in"
                  kind="gold"
                  small
                  loading={checking}
                  testID="checkin"
                  onPress={async () => {
                    setChecking(true);
                    try {
                      await checkIn();
                    } catch (e) {
                      Alert.alert("Couldn't check in", errorMessage(e));
                    } finally {
                      setChecking(false);
                    }
                  }}
                />
              ) : (
                <View style={styles.row}>
                  <Coin size={16} />
                  <Strong style={{ marginLeft: 6, fontVariant: ['tabular-nums'] }}>{profile.coins.toLocaleString('en-IN')}</Strong>
                </View>
              )}
            </View>
          </Card>
        )}

        {user?.id ? <PushPrompt userId={user.id} /> : null}

        {/* Due soon */}
        {dueSoon.length > 0 && (
          <Section title="Due soon" action="All bills" onAction={() => go('/bills')}>
            <Card padded={false} style={{ paddingHorizontal: 16 }}>
              {dueSoon.map((b, i) => {
                const days = daysUntil(b.due_date);
                return (
                  <View key={b.id} style={i > 0 ? styles.hairTop : undefined}>
                    <Row
                      left={<IconMark icon={BILL_ICON[b.type] ?? 'file-text'} tint={b.type} />}
                      title={b.title}
                      subtitle={days <= 0 ? 'Due today' : days === 1 ? 'Due tomorrow' : `Due in ${days} days · ${b.biller}`}
                      right={<Amount value={b.amount} size={15} color={days <= 3 ? C.red : C.ink} />}
                      onPress={() => go('/bills')}
                    />
                  </View>
                );
              })}
            </Card>
          </Section>
        )}

        {/* One insight, written like a person would say it */}
        {insight && (
          <Section title="Worth a look">
            <Card onPress={() => go('/expenses')} accessibilityLabel={insight.title}>
              <Title>{insight.title}</Title>
              <Body style={{ marginTop: 6 }}>{insight.description}</Body>
            </Card>
          </Section>
        )}

        {/* Debts and goals side by side */}
        <View style={[styles.row, { gap: 12, marginTop: 12, alignItems: 'stretch' }]}>
          <Card style={{ flex: 1 }} onPress={() => go('/debts')} accessibilityLabel="Debts">
            <Label>Debt-free by</Label>
            <Title style={{ marginTop: 8 }}>{debtFree ?? '—'}</Title>
            <Small style={{ marginTop: 4 }}>{formatCompact(d.debts.total)} across {d.debts.count}</Small>
          </Card>
          <Card style={{ flex: 1 }} onPress={() => go('/goals')} accessibilityLabel="Savings goals">
            <Label>Saved</Label>
            <Title style={{ marginTop: 8 }}>{formatCompact(d.savings.total_saved)}</Title>
            <View style={{ marginTop: 10 }}>
              <Progress value={d.savings.progress} color={C.green} height={4} />
            </View>
          </Card>
        </View>

        {/* Services */}
        <Section title="Everything else">
          <View style={styles.grid}>
            {SERVICES.map((s) => (
              <ActionTile key={s.route} icon={s.icon} label={s.label} onPress={() => go(s.route)} />
            ))}
          </View>
        </Section>

        {error ? (
          <Small center color={C.red} style={{ marginTop: 24 }}>
            Some of this didn&apos;t load. Pull down to try again.
          </Small>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  demo: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.amberSoft, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginTop: 12 },
  safe: { flex: 1, backgroundColor: 'transparent' },
  content: { paddingHorizontal: GUTTER, paddingBottom: 120 },
  header: { flexDirection: 'row', alignItems: 'center', paddingTop: 10, paddingBottom: 18 },
  row: { flexDirection: 'row', alignItems: 'center' },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  hero: { borderRadius: R.lg, padding: 22 },
  heroNum: { color: C.nightText, fontFamily: F.semibold },
  actions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 22 },
  person: { alignItems: 'center', width: 60 },
  personName: { marginTop: 6, fontFamily: F.medium },
  newPerson: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderStyle: 'dashed', borderColor: C.lineStrong, alignItems: 'center', justifyContent: 'center' },
  level: { fontFamily: F.display, fontSize: 22, color: C.ink },
  hairTop: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 18 },
}));

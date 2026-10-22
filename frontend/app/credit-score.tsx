import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { errorMessage, getCreditScore, payCreditCardBill } from '../src/services/api';
import { useGame } from '../src/game/GameContext';
import { useUserData } from '../src/game/useData';
import { Alert } from '../src/ui/dialog';
import { Amount, Body, Button, Card, Divider, Empty, ErrorState, Label, Pill, Progress, Screen, Section, SkeletonScreen, Small, Strong } from '../src/ui/kit';
import { C, F, R, themed } from '../src/ui/theme';
import { daysUntil, formatCompact, formatDate } from '../src/utils/format';

const MIN = 300;
const MAX = 900;
const BANDS = [
  // Brick → ochre → slate blue → green: muted, and each band is also named in words.
  { to: 550, label: 'Needs work', color: '#A8674F', text: () => C.ink },
  { to: 650, label: 'Fair', color: '#B39A5E', text: () => C.ink },
  { to: 750, label: 'Good', color: '#3A5973', text: () => C.ink },
  { to: 900, label: 'Excellent', color: '#36603F', text: () => C.ink },
];

const FACTORS: Record<string, { label: string; good: (v: number) => boolean; show: (v: number) => string; bar: (v: number) => number; tip: string }> = {
  payment_history: { label: 'On-time payments', good: (v) => v >= 95, show: (v) => `${v}%`, bar: (v) => v / 100, tip: 'One missed payment can cost 50+ points. Turn on autopay for EMIs.' },
  credit_utilization: { label: 'Card limit used', good: (v) => v <= 30, show: (v) => `${v}%`, bar: (v) => v / 100, tip: 'Keep it under 30%. Paying before the statement date helps.' },
  credit_age: { label: 'Age of credit', good: (v) => v >= 5, show: (v) => `${v} yrs`, bar: (v) => Math.min(1, v / 10), tip: "Don't close your oldest card." },
  credit_mix: { label: 'Credit mix', good: (v) => v >= 70, show: (v) => `${v}%`, bar: (v) => v / 100, tip: 'A mix of loans and cards, handled well, helps.' },
  recent_inquiries: { label: 'Recent applications', good: (v) => v <= 1, show: (v) => String(v), bar: (v) => Math.min(1, v / 5), tip: 'Space out loan and card applications.' },
};

/** Half-circle gauge from 300 to 900. */
function Gauge({ score }: { score: number }) {
  const size = 280;
  const stroke = 14;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const angle = (v: number) => Math.PI * (1 - (v - MIN) / (MAX - MIN));
  const point = (v: number) => [cx + r * Math.cos(angle(v)), cy - r * Math.sin(angle(v))];
  const arc = (from: number, to: number) => {
    const [x1, y1] = point(from);
    const [x2, y2] = point(to);
    return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
  };
  let start = MIN;
  const [mx, my] = point(score);
  return (
    <Svg width={size} height={size / 2 + stroke} viewBox={`0 0 ${size} ${size / 2 + stroke}`}>
      {BANDS.map((b, i) => {
        const from = start;
        start = b.to;
        const current = score >= from && (score < b.to || i === BANDS.length - 1);
        return <Path key={b.label} d={arc(from + 2, b.to - 2)} stroke={b.color} strokeWidth={stroke} fill="none" strokeLinecap="round" opacity={current ? 1 : 0.3} />;
      })}
      <Circle cx={mx} cy={my} r={11} fill={C.surface} stroke={C.ink} strokeWidth={3} />
    </Svg>
  );
}

export default function CreditScore() {
  const { celebrate } = useGame();
  const [paying, setPaying] = useState<string | null>(null);
  const { data, loading, refreshing, refresh, reload, error, userId } = useUserData((id) => getCreditScore(id));

  if (loading || !data)
    return (
      <Screen title="Credit score">
        {error ? <ErrorState onRetry={reload} /> : <SkeletonScreen />}
      </Screen>
    );

  if (data.available === false)
    return (
      <Screen title="Credit score">
        <Empty icon="activity" title="Not available yet" body={data.message} />
      </Screen>
    );

  const score: number = data.score;
  const band = BANDS.find((b) => score < b.to) ?? BANDS[BANDS.length - 1];
  const prev = data.history?.[0]?.score;
  const delta = prev ? score - prev : 0;

  const pay = (card: any) =>
    Alert.alert(`Pay ${card.bank} ${card.card_type}?`, `₹${card.total_due.toLocaleString('en-IN')} total due.\nNo fee from CoinQuest.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Pay',
        onPress: async () => {
          setPaying(card.bank);
          try {
            const res = await payCreditCardBill(userId, card.bank, card.total_due);
            celebrate(`${card.bank} card paid`, res.reward, res.coins_earned);
            reload();
          } catch (e) {
            Alert.alert('Payment failed', errorMessage(e));
          } finally {
            setPaying(null);
          }
        },
      },
    ]);

  return (
    <Screen title="Credit score" refreshing={refreshing} onRefresh={refresh}>
      <Card style={{ marginTop: 14, alignItems: 'center', paddingTop: 26, borderRadius: R.lg }}>
        <Gauge score={score} />
        <View style={styles.scoreWrap}>
          <Text style={styles.score} testID="credit-score">
            {score}
          </Text>
          <Strong color={band.text()}>{band.label}</Strong>
        </View>
        <View style={[styles.row, { gap: 6, marginTop: 14 }]}>
          {delta !== 0 && <Pill label={`${delta > 0 ? '↑' : '↓'} ${Math.abs(delta)} since last month`} tone={delta > 0 ? 'green' : 'red'} />}
          <Pill label={`Next update ${formatDate(data.next_update)}`} />
        </View>
        <Small style={{ marginTop: 14 }} center>
          {data.sample ? 'Sample score for the demo. It isn’t from a credit bureau.' : 'Checking your own score never lowers it.'}
        </Small>
      </Card>

      <Section title="What's shaping it">
        <Card padded={false}>
          {Object.entries(data.factors as Record<string, number>).map(([key, v], i) => {
            const f = FACTORS[key];
            if (!f) return null;
            const good = f.good(v);
            return (
              <View key={key} style={[{ padding: 16 }, i > 0 && styles.line]}>
                <View style={styles.between}>
                  <Strong>{f.label}</Strong>
                  <View style={styles.row}>
                    <Strong color={good ? C.green : C.red}>{f.show(v)}</Strong>
                  </View>
                </View>
                <View style={{ marginTop: 10 }}>
                  <Progress value={f.bar(v)} max={1} color={good ? C.ink : C.ink3} height={4} />
                </View>
                {!good && <Body style={{ marginTop: 8, fontSize: 13, lineHeight: 18 }}>{f.tip}</Body>}
              </View>
            );
          })}
        </Card>
      </Section>

      <Section title="Your cards">
        <View style={{ gap: 10 }}>
          {(data.credit_cards ?? []).map((card: any) => {
            const used = card.limit ? Math.round((card.used / card.limit) * 100) : 0;
            const days = daysUntil(card.due_date);
            return (
              <Card key={card.bank} dark style={{ borderRadius: R.lg, padding: 20 }}>
                <View style={styles.between}>
                  <View>
                    <Strong color={C.nightText}>{card.bank}</Strong>
                    <Small color={C.nightMuted}>{card.card_type} · {card.reward_points.toLocaleString('en-IN')} points</Small>
                  </View>
                  <Pill label={days <= 0 ? 'Due today' : `Due in ${days} days`} tone={days <= 5 ? 'red' : 'dark'} />
                </View>
                <Label color={C.nightMuted} style={{ marginTop: 22 }}>Total due</Label>
                <Amount value={card.total_due} display size={36} color={C.nightText} style={{ marginTop: 4 }} />
                <Small color={C.nightMuted}>Minimum {formatCompact(card.min_due)}</Small>
                <View style={{ marginTop: 16 }}>
                  <Progress value={used} color={C.gold} track={C.night3} height={4} />
                </View>
                <Small color={C.nightMuted} style={{ marginTop: 6 }}>
                  {used}% of {formatCompact(card.limit)} limit used
                </Small>
                <Divider dark />
                <Button label="Pay full amount" kind="gold" small style={{ marginTop: 14, alignSelf: 'flex-start' }} loading={paying === card.bank} onPress={() => pay(card)} />
              </Card>
            );
          })}
        </View>
      </Section>

      <Section title="Last six months">
        <Card>
          <View style={styles.chart}>
            {[...(data.history ?? [])].reverse().concat([{ month: 'Now', score }]).map((h: any, i: number, arr: any[]) => {
              const last = i === arr.length - 1;
              return (
                <View key={h.month} style={{ flex: 1, alignItems: 'center' }}>
                  <Small color={last ? C.ink : C.ink3} style={{ fontVariant: ['tabular-nums'] }}>{h.score}</Small>
                  <View style={[styles.bar, { height: Math.max(6, ((h.score - 550) / 350) * 90), backgroundColor: last ? C.ink : C.paperDeep }]} />
                  <Small style={{ marginTop: 6, fontSize: 11 }}>{h.month.split(' ')[0]}</Small>
                </View>
              );
            })}
          </View>
        </Card>
      </Section>
    </Screen>
  );
}

const styles = themed(() => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  scoreWrap: { alignItems: 'center', marginTop: -74 },
  score: { fontFamily: F.display, fontSize: 64, lineHeight: 66, color: C.ink, fontVariant: ['tabular-nums'] },
  line: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: 140, gap: 6 },
  bar: { width: 20, borderRadius: 6, marginTop: 6 },
}));

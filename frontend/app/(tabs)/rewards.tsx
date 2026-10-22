import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { errorMessage, getRewards, redeemReward } from '../../src/services/api';
import { useGame } from '../../src/game/GameContext';
import { Coin } from '../../src/game/Coin';
import { useUserData } from '../../src/game/useData';
import { Alert } from '../../src/ui/dialog';
import { Body, Button, Divider, ErrorState, Heading, IconName, Label, Ring, Screen, Section, Sheet, SkeletonScreen, Small, Strong } from '../../src/ui/kit';
import { C, F, GUTTER, ON_ACCENT, R, tintFor, themed } from '../../src/ui/theme';

type Deal = { id: string; brand: string; title: string; coins_required: number; category: string; discount: string };

const BADGE_ICON: Record<string, IconName> = {
  coin: 'disc', brick: 'zap', piggy: 'target', castle: 'flag', sword: 'shield', book: 'book-open', pipe: 'link-2', fire: 'trending-up', star: 'star',
};

export default function RewardsTab() {
  const { profile, checkIn, celebrate } = useGame();
  const [busy, setBusy] = useState<string | null>(null);
  const [voucher, setVoucher] = useState<{ code: string; deal: Deal; until: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const { data, loading, refreshing, refresh, reload, error, userId } = useUserData(async (id) => ({ rewards: await getRewards(id) }));

  if (loading || !data || !profile)
    return (
      <Screen title="Rewards" back={false} dark>
        {error ? <ErrorState onRetry={reload} /> : <SkeletonScreen dark />}
      </Screen>
    );

  const coins = profile.coins;
  const deals: Deal[] = data.rewards.deals;
  const coinValue: number = data.rewards.coin_value;
  const storeOpen: boolean = data.rewards.store_open;

  const redeem = (deal: Deal) => {
    if (!storeOpen) {
      Alert.alert('Store not open yet', 'The rewards store opens once our voucher partner is connected. Your coins are safe.');
      return;
    }
    if (coins < deal.coins_required) {
      Alert.alert('Not enough coins yet', `You need ${(deal.coins_required - coins).toLocaleString('en-IN')} more. Paying bills and finishing quests is the fastest way.`);
      return;
    }
    const sample = data.rewards.sample_codes ? '\n\nDemo mode: you get a sample code that shops won’t accept.' : '';
    Alert.alert(deal.title, `Use ${deal.coins_required.toLocaleString('en-IN')} coins?\n\n${deal.discount}${sample}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Redeem',
        onPress: async () => {
          setBusy(deal.id);
          try {
            const res = await redeemReward(userId, deal.id);
            setVoucher({ code: res.voucher_code, deal, until: res.valid_until });
            celebrate('Reward redeemed', res.reward);
            reload();
          } catch (e) {
            Alert.alert("Couldn't redeem", errorMessage(e));
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  };

  return (
    <Screen title="Rewards" back={false} dark refreshing={refreshing} onRefresh={refresh}>
      {/* Balance */}
      <View style={styles.balance}>
        <Coin size={34} />
        <Text style={styles.coins} testID="coin-balance">
          {coins.toLocaleString('en-IN')}
        </Text>
      </View>
      <Small color={C.nightMuted}>coins · worth ₹{(coins * coinValue).toLocaleString('en-IN', { maximumFractionDigits: 2 })} in vouchers · {data.rewards.tier} member</Small>

      {/* Level + streak */}
      <View style={[styles.panel, { marginTop: 24 }]}>
        <View style={styles.row}>
          <Ring value={profile.progress / 100} size={74} stroke={5} color={C.gold} track={C.night3}>
            <Text style={styles.levelNum}>{profile.level}</Text>
          </Ring>
          <View style={{ marginLeft: 16, flex: 1 }}>
            <Label color={C.nightMuted}>Level {profile.level}</Label>
            <Heading color={C.nightText} style={{ fontSize: 26, lineHeight: 30, marginTop: 2 }}>
              {profile.title}
            </Heading>
            <Small color={C.nightMuted} style={{ marginTop: 2 }}>
              {profile.xp_for_next - profile.xp_into_level} XP to level {profile.level + 1}
            </Small>
          </View>
        </View>
        <Divider dark />
        <View style={[styles.row, { paddingTop: 16 }]}>
          <View style={{ flex: 1 }}>
            <Strong color={C.nightText}>{profile.streak ? `${profile.streak}-day streak` : 'No streak yet'}</Strong>
            <View style={styles.week}>
              {Array.from({ length: 7 }).map((_, i) => (
                <View key={i} style={[styles.day, i < Math.min(profile.streak, 7) && styles.dayOn]} />
              ))}
            </View>
            <Small color={C.nightMuted} style={{ marginTop: 6 }}>Best: {profile.best_streak} {profile.best_streak === 1 ? 'day' : 'days'}</Small>
          </View>
          {!profile.checked_in_today ? (
            <Button
              label="Check in"
              kind="gold"
              small
              loading={checking}
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
              <Feather name="check" size={16} color={C.gold} />
              <Small color={C.gold} style={{ marginLeft: 4 }}>
                Checked in
              </Small>
            </View>
          )}
        </View>
      </View>

      {/* Quests */}
      <Section title="Today's quests" dark>
        <View style={styles.panel}>
          {profile.quests.map((q, i) => (
            <View key={q.id}>
              {i > 0 && <Divider dark inset={40} />}
              <View style={[styles.row, { paddingVertical: 12 }]}>
                <View style={[styles.check, q.done && { backgroundColor: C.gold, borderColor: C.gold }]}>{q.done && <Feather name="check" size={14} color="#000000" />}</View>
                <View style={{ flex: 1, marginLeft: 14 }}>
                  <Strong color={q.done ? C.nightMuted : C.nightText} style={q.done ? { textDecorationLine: 'line-through' } : undefined}>
                    {q.desc}
                  </Strong>
                  <Small color={C.nightMuted}>
                    {q.title} · {q.progress}/{q.target}
                  </Small>
                </View>
                <View style={styles.row}>
                  <Coin size={14} />
                  <Small color={C.nightText} style={{ marginLeft: 5 }}>
                    {q.reward_coins}
                  </Small>
                </View>
              </View>
            </View>
          ))}
        </View>
      </Section>

      {/* Store */}
      <Section title={storeOpen ? "Spend your coins" : "Spend your coins · opening soon"} dark>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -GUTTER }} contentContainerStyle={{ paddingHorizontal: GUTTER, gap: 12 }}>
          {deals.map((d) => {
            const t = tintFor(d.brand);
            const short = coins < d.coins_required;
            return (
              <Pressable key={d.id} onPress={() => redeem(d)} style={({ pressed }) => [styles.deal, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel={`${d.title}, ${d.coins_required} coins`}>
                <View style={[styles.brand, { backgroundColor: t.bg }]}>
                  <Text style={[styles.brandText, { color: t.fg }]}>{d.brand.charAt(0)}</Text>
                </View>
                <Small color={C.nightMuted} style={{ marginTop: 14 }}>
                  {d.brand}
                </Small>
                <Strong color={C.nightText} numberOfLines={2} style={{ marginTop: 2, minHeight: 40 }}>
                  {d.title}
                </Strong>
                <View style={[styles.row, { marginTop: 12 }]}>
                  <Coin size={14} />
                  <Text style={[styles.price, short && { color: C.nightMuted }]}>{d.coins_required.toLocaleString('en-IN')}</Text>
                  {busy === d.id && <Small color={C.nightMuted}> · …</Small>}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </Section>

      {/* Badges */}
      <Section title={`Badges · ${profile.achievements.filter((a) => a.unlocked).length} of ${profile.achievements.length}`} dark>
        <View style={styles.badges}>
          {profile.achievements.map((a) => (
            <View key={a.id} style={styles.badge} accessible accessibilityLabel={`${a.name}. ${a.desc}. ${a.unlocked ? 'Earned' : 'Locked'}`}>
              <View style={[styles.badgeIcon, a.unlocked && { backgroundColor: C.gold }]}>
                <Feather name={a.unlocked ? BADGE_ICON[a.icon] ?? 'award' : 'lock'} size={20} color={a.unlocked ? ON_ACCENT : C.nightMuted} />
              </View>
              <Small color={a.unlocked ? C.nightText : C.nightMuted} center style={{ marginTop: 8, fontFamily: F.medium }} numberOfLines={1}>
                {a.name}
              </Small>
              <Small color={C.nightMuted} center numberOfLines={2} style={{ fontSize: 11, lineHeight: 14 }}>
                {a.desc}
              </Small>
            </View>
          ))}
        </View>
      </Section>

      <Body color={C.nightMuted} style={{ marginTop: 22, fontSize: 13 }}>
        Coins: 1 per ₹50 sent on UPI, 1 per ₹100 of bills, plus quest bonuses. In the store, 10 coins = ₹1. Coins have no cash value and can’t be transferred.
      </Body>

      <Sheet visible={!!voucher} onClose={() => setVoucher(null)} title="It's yours">
        <Body>{voucher?.deal.title}</Body>
        <View style={styles.code}>
          <Text selectable style={styles.codeText}>
            {voucher?.code}
          </Text>
        </View>
        <Small>
          {data.rewards.sample_codes ? 'Demo mode: this is a sample code and won’t work in a shop. ' : ''}
          {voucher?.deal.discount} Valid until {voucher?.until}.
        </Small>
        <Button label="Done" style={{ marginTop: 20 }} onPress={() => setVoucher(null)} />
      </Sheet>
    </Screen>
  );
}

const styles = themed(() => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  balance: { flexDirection: 'row', alignItems: 'center', marginTop: 18 },
  coins: { fontFamily: F.display, fontSize: 56, color: C.nightText, marginLeft: 12, letterSpacing: -1, fontVariant: ['tabular-nums'] },
  panel: { backgroundColor: C.night2, borderRadius: R.md, padding: 16 },
  levelNum: { fontFamily: F.display, fontSize: 34, color: C.nightText },
  week: { flexDirection: 'row', gap: 6, marginTop: 10 },
  day: { width: 22, height: 6, borderRadius: 3, backgroundColor: C.night3 },
  dayOn: { backgroundColor: C.gold },
  check: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: C.night3, alignItems: 'center', justifyContent: 'center' },
  deal: { width: 168, backgroundColor: C.night2, borderRadius: R.md, padding: 16 },
  brand: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  brandText: { fontFamily: F.display, fontSize: 26 },
  price: { fontFamily: F.semibold, fontSize: 15, color: C.gold, marginLeft: 6, fontVariant: ['tabular-nums'] },
  badges: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 18 },
  badge: { width: '31%', alignItems: 'center' },
  badgeIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: C.night2, alignItems: 'center', justifyContent: 'center' },
  code: { marginVertical: 18, borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.lineStrong, borderRadius: R.sm, padding: 18, alignItems: 'center' },
  codeText: { fontFamily: F.semibold, fontSize: 22, letterSpacing: 3, color: C.ink },
}));

import React, { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { dailyCheckIn, getGameProfile } from '../services/api';
import { C, F, R, themed } from '../ui/theme';
import { haptic, NATIVE } from '../ui/kit';
import { Coin } from './Coin';

export type Reward = {
  action?: string;
  xp_earned?: number;
  coins_earned?: number;
  total_xp?: number;
  level?: number;
  leveled_up?: boolean;
  title?: string;
  quests_completed?: { id: string; title: string; reward_coins: number }[];
  new_achievements?: { id: string; name: string; desc: string }[];
};

export type GameProfile = {
  name: string;
  coins: number;
  xp: number;
  level: number;
  title: string;
  world: string;
  xp_into_level: number;
  xp_for_next: number;
  progress: number;
  streak: number;
  best_streak: number;
  checked_in_today: boolean;
  quests: { id: string; title: string; desc: string; target: number; progress: number; done: boolean; reward_coins: number }[];
  achievements: { id: string; name: string; desc: string; icon: string; unlocked: boolean }[];
};

type Toast = { headline: string; reward?: Reward; extraCoins?: number; key: number };

type GameCtx = {
  profile: GameProfile | null;
  refresh: () => Promise<void>;
  checkIn: () => Promise<void>;
  /** Show the reward toast for an API reward block, then refresh the profile. */
  celebrate: (headline: string, reward?: Reward, extraCoins?: number) => void;
};

const Ctx = createContext<GameCtx | undefined>(undefined);

export function GameProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [profile, setProfile] = useState<GameProfile | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const refresh = useCallback(async () => {
    if (!user?.id) return;
    try {
      setProfile(await getGameProfile(user.id));
    } catch (e) {
      console.warn('Failed to load game profile', e);
    }
  }, [user?.id]);

  useEffect(() => {
    setProfile(null);
    refresh();
  }, [refresh]);

  const celebrate = useCallback(
    (headline: string, reward?: Reward, extraCoins?: number) => {
      setToast({ headline, reward, extraCoins, key: Date.now() });
      haptic('success');
      refresh();
    },
    [refresh],
  );

  const checkIn = useCallback(async () => {
    if (!user?.id) return;
    const res = await dailyCheckIn(user.id);
    if (!res.already_checked_in) celebrate(res.streak > 1 ? `${res.streak}-day streak` : 'Streak started', res.reward);
    else refresh();
  }, [user?.id, celebrate, refresh]);

  return (
    <Ctx.Provider value={{ profile, refresh, checkIn, celebrate }}>
      {children}
      {toast && <RewardToast key={toast.key} toast={toast} onDone={() => setToast(null)} />}
    </Ctx.Provider>
  );
}

export function useGame() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useGame must be used within GameProvider');
  return ctx;
}

// ---------------------------------------------------------------- toast

function RewardToast({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const y = useRef(new Animated.Value(-160)).current;
  const coin = useRef(new Animated.Value(0)).current;
  const { reward } = toast;
  const coins = (reward?.coins_earned || 0) + (toast.extraCoins || 0);
  const extras = [
    ...(reward?.quests_completed ?? []).map((q) => `Quest done · ${q.title}`),
    ...(reward?.new_achievements ?? []).map((a) => `Badge · ${a.name}`),
  ];
  const big = !!reward?.leveled_up;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(y, { toValue: 0, friction: 8, tension: 70, useNativeDriver: NATIVE }),
      Animated.timing(coin, { toValue: 1, duration: 650, delay: 120, easing: Easing.out(Easing.back(2)), useNativeDriver: NATIVE }),
    ]).start();
    const hide = setTimeout(
      () => Animated.timing(y, { toValue: -200, duration: 220, useNativeDriver: NATIVE }).start(onDone),
      2600 + extras.length * 600 + (big ? 900 : 0),
    );
    return () => clearTimeout(hide);
  }, [y, coin, onDone, extras.length, big]);

  const coinY = coin.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] });
  const coinSpin = coin.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.2, 1] });

  return (
    <Animated.View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + 8, transform: [{ translateY: y }] }]}>
      <Pressable onPress={onDone} accessibilityRole="alert" accessibilityLabel={`${toast.headline}. ${coins ? `${coins} coins.` : ''}`} style={styles.toast}>
        <View style={styles.row}>
          <Animated.View style={{ transform: [{ translateY: coinY }, { scaleX: coinSpin }] }}>
            <Coin size={30} />
          </Animated.View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.headline} numberOfLines={1}>
              {toast.headline}
            </Text>
            <Text style={styles.meta}>
              {[coins ? `+${coins} coins` : null, reward?.xp_earned ? `+${reward.xp_earned} XP` : null].filter(Boolean).join('  ·  ') || 'Nice.'}
            </Text>
          </View>
        </View>
        {big && (
          <View style={styles.levelUp}>
            <Text style={styles.levelText}>Level {reward?.level}</Text>
            <Text style={styles.levelSub}>{reward?.title}</Text>
          </View>
        )}
        {extras.map((e) => (
          <Text key={e} style={styles.extra}>
            {e}
          </Text>
        ))}
      </Pressable>
    </Animated.View>
  );
}

const styles = themed(() => StyleSheet.create({
  wrap: { position: 'absolute', left: 14, right: 14, zIndex: 1000 },
  // Smoked glass in both modes: it floats over any content, so it can't depend on what's beneath.
  toast: {
    backgroundColor: 'rgba(14,17,28,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    borderRadius: R.md,
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  headline: { fontFamily: F.semibold, fontSize: 16, color: C.nightText },
  meta: { fontFamily: F.medium, fontSize: 13, color: C.gold, marginTop: 2, fontVariant: ['tabular-nums'] },
  levelUp: { marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.night3, flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  levelText: { fontFamily: F.display, fontSize: 26, color: C.nightText },
  levelSub: { fontFamily: F.medium, fontSize: 13, color: C.nightMuted },
  extra: { fontFamily: F.medium, fontSize: 13, color: C.nightMuted, marginTop: 8 },
}));

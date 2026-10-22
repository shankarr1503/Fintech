import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, F, ON_ACCENT, themed } from '../../src/ui/theme';
import { Glass, haptic, IconName } from '../../src/ui/kit';

// expo-router ships its own copy of the tab navigator types, so derive props from it.
type BottomTabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>['tabBar']>>[0];

const TABS: Record<string, { label: string; icon: IconName }> = {
  index: { label: 'Home', icon: 'home' },
  money: { label: 'Money', icon: 'pie-chart' },
  rewards: { label: 'Rewards', icon: 'award' },
  me: { label: 'Me', icon: 'user' },
};

function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const tab = (index: number) => {
    const route = state.routes[index];
    const meta = TABS[route.name];
    const focused = state.index === index;
    return (
      <Pressable
        key={route.key}
        testID={`tab-${route.name}`}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }} aria-selected={focused}
        accessibilityLabel={meta.label}
        onPress={() => {
          haptic();
          const e = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !e.defaultPrevented) navigation.navigate(route.name);
        }}
        style={styles.tab}
      >
        <Feather name={meta.icon} size={21} color={focused ? C.ink : C.ink3} />
        <Text style={[styles.label, { color: focused ? C.ink : C.ink3 }]}>{meta.label}</Text>
        {focused && <View style={styles.activeDot} />}
      </Pressable>
    );
  };
  // A floating pill of glass: content scrolls underneath it, blurred.
  return (
    <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, 12) }]} pointerEvents="box-none">
      <View style={styles.bar}>
      <Glass strong radius={35} />
      {tab(0)}
      {tab(1)}
      <View style={styles.tab}>
        <Pressable
          testID="tab-scan"
          onPress={() => {
            haptic('medium');
            router.push('/scan');
          }}
          accessibilityRole="button"
          accessibilityLabel="Scan and pay"
          style={({ pressed }) => [styles.scan, pressed && { transform: [{ scale: 0.94 }] }]}
        >
          <Feather name="maximize" size={24} color={ON_ACCENT} />
        </Pressable>
      </View>
      {tab(2)}
      {tab(3)}
      </View>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: 'transparent' } }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="money" />
      <Tabs.Screen name="rewards" />
      <Tabs.Screen name="me" />
    </Tabs>
  );
}

const styles = themed(() => StyleSheet.create({
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 14 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 70,
    borderRadius: 35,
    overflow: 'visible',
    backgroundColor: C.glass,
    borderWidth: 1,
    borderColor: C.lineStrong,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: F.medium, fontSize: 11, marginTop: 4 },
  activeDot: { width: 14, height: 3, borderRadius: 2, backgroundColor: C.gold, marginTop: 4 },
  scan: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: C.gold,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -30,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
    shadowColor: C.gold,
    shadowOpacity: 0.55,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
}));

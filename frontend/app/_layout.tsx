import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
// Small-caps typefaces: real small-cap glyphs, so they look the same on iOS, Android and web.
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../src/context/AuthContext';
import { GameProvider } from '../src/game/GameContext';
import { Backdrop } from '../src/ui/kit';
import { AppearanceProvider, useAppearance } from '../src/ui/appearance';
import { AppLock } from '../src/ui/AppLock';
import { registerForPush } from '../src/services/push';
import { OfflineBanner } from '../src/ui/OfflineBanner';
import { CookieNotice } from '../src/ui/CookieNotice';
import { PageMeta } from '../src/ui/PageMeta';

SplashScreen.preventAutoHideAsync().catch(() => {});

/** Sends signed-out players (logout, expired session) back to the title screen. */
function AuthGate() {
  const { user, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const inAuth = segments[0] === '(auth)';
  // Policies and the deletion request must open without an account (app stores and the law require it).
  const isPublic = segments[0] === 'legal' || segments[0] === 'delete-account';
  const atRoot = (segments as string[]).length === 0;
  const needsPin = !!user && user.pin_set === false;

  useEffect(() => {
    if (isLoading || inAuth || isPublic) return;
    if (!user && !atRoot) router.replace('/(auth)/login');
    // Signed in but no PIN yet: the second factor must exist before anything else.
    else if (needsPin) router.replace({ pathname: '/(auth)/pin', params: { mode: 'set' } });
  }, [isLoading, user, inAuth, isPublic, atRoot, needsPin, router]);

  // Real-time debit/credit/security alerts on the lock screen, once fully signed in.
  const pushUser = user && user.pin_set ? user.id : null;
  useEffect(() => {
    if (pushUser) registerForPush(pushUser);
  }, [pushUser]);

  return null;
}

/** After a theme switch re-renders the app, reopen the screen the switch came from. */
function ReturnAfterThemeChange() {
  const { takeReturnRoute } = useAppearance();
  const router = useRouter();
  useEffect(() => {
    const route = takeReturnRoute();
    if (route) setTimeout(() => router.push(route as any), 0);
  }, [takeReturnRoute, router]);
  return null;
}

const navTheme = (scheme: 'light' | 'dark') => {
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  return { ...base, colors: { ...base.colors, background: 'transparent', card: 'transparent' } };
};

export default function RootLayout() {
  // Pixelify Sans with the ₹ sign and arrows added (scripts/build-fonts.py). Bundled, never fetched.
  const [fontsLoaded, fontError] = useFonts({
    'PixelifySans-Regular': require('../assets/fonts/PixelifySans-400Regular.ttf'),
    'PixelifySans-Medium': require('../assets/fonts/PixelifySans-500Medium.ttf'),
    'PixelifySans-SemiBold': require('../assets/fonts/PixelifySans-600SemiBold.ttf'),
    'PixelifySans-Bold': require('../assets/fonts/PixelifySans-700Bold.ttf'),
  });

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <AppearanceProvider>
        {(scheme) => (
          <AuthProvider>
            {/* Keyed by scheme: a theme switch re-renders everything in the new palette. */}
            <GameProvider key={scheme}>
              {/* Navigation paints every screen container; keep it transparent so the aurora shows. */}
              <ThemeProvider value={navTheme(scheme)}>
              {/* One aurora behind every (transparent) screen: the glass surfaces float on it. */}
              <Backdrop />
              <AuthGate />
              <ReturnAfterThemeChange />
              <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' }, animation: 'fade' }}>
                <Stack.Screen name="index" options={{ animation: 'fade' }} />
                <Stack.Screen name="(auth)" />
                <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
                <Stack.Screen name="scan" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
                <Stack.Screen name="pay/success" options={{ animation: 'fade', gestureEnabled: false }} />
              </Stack>
              <OfflineBanner />
              <CookieNotice />
              <PageMeta />
              </ThemeProvider>
            </GameProvider>
            {/* Outside the keyed subtree: a theme switch must neither reset nor re-trigger the lock. */}
            <AppLock />
          </AuthProvider>
        )}
      </AppearanceProvider>
    </SafeAreaProvider>
  );
}

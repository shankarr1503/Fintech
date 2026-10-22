import React, { useRef, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { parseUpiQr } from '../src/services/receipt';
import { Body, Button, haptic, Heading, Small, useStatusBar } from '../src/ui/kit';
import { C, F, GUTTER, R, themed } from '../src/ui/theme';

const FRAME = 248;

export default function ScanScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handled = useRef(false);
  useStatusBar('light');

  const onScan = ({ data }: { data: string }) => {
    if (handled.current) return;
    const upi = parseUpiQr(data);
    if (!upi) {
      setError("That isn't a UPI payment code.");
      return;
    }
    if ('error' in upi) {
      setError(upi.error);
      return;
    }
    handled.current = true;
    haptic('success');
    router.replace({ pathname: '/pay/amount', params: { to: upi.to, name: upi.name ?? '', am: upi.amount ?? '', tn: upi.note ?? '', src: 'qr' } });
  };

  const granted = permission?.granted;

  return (
    <View style={styles.root}>
      {granted && (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={torch}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={onScan}
        />
      )}
      <SafeAreaView style={{ flex: 1 }}>
        <View style={styles.top}>
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Close scanner" hitSlop={10} style={styles.round}>
            <Feather name="x" size={22} color={C.nightText} />
          </Pressable>
          <Text style={styles.topTitle}>Scan any UPI QR</Text>
          {granted && Platform.OS !== 'web' ? (
            <Pressable onPress={() => setTorch((t) => !t)} accessibilityRole="switch" accessibilityState={{ checked: torch }} aria-checked={torch} accessibilityLabel="Torch" hitSlop={10} style={styles.round}>
              <Feather name={torch ? 'zap' : 'zap-off'} size={20} color={C.nightText} />
            </Pressable>
          ) : (
            <View style={{ width: 44 }} />
          )}
        </View>

        <View style={styles.middle}>
          {granted ? (
            <>
              <View style={styles.frame}>
                {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
                  <View key={c} style={[styles.corner, styles[c]]} />
                ))}
              </View>
              <Small color={C.nightMuted} center style={{ marginTop: 22 }}>
                {error ?? 'Works with any UPI QR code'}
              </Small>
            </>
          ) : (
            <View style={{ paddingHorizontal: 32, alignItems: 'center' }}>
              <View style={styles.camIcon}>
                <Feather name="camera" size={26} color={C.nightText} />
              </View>
              <Heading color={C.nightText} center style={{ marginTop: 18 }}>
                {permission?.canAskAgain === false ? 'Camera is off for CoinQuest' : 'Allow the camera to scan'}
              </Heading>
              <Body color={C.nightMuted} center style={{ marginTop: 8 }}>
                We only use it to read payment QR codes. Nothing is recorded.
              </Body>
              {permission?.canAskAgain !== false ? (
                <Button label="Allow camera" kind="gold" style={{ marginTop: 22, alignSelf: 'stretch' }} onPress={requestPermission} testID="allow-camera" />
              ) : (
                <Button label="Open settings" kind="gold" style={{ marginTop: 22, alignSelf: 'stretch' }} onPress={() => Linking.openSettings()} testID="open-settings" />
              )}
            </View>
          )}
        </View>

        <View style={styles.bottom}>
          <Pressable onPress={() => router.replace('/pay')} style={styles.alt} accessibilityRole="button" testID="pay-upi-id">
            <Feather name="at-sign" size={18} color={C.nightText} />
            <Text style={styles.altText}>Pay a UPI ID or phone number</Text>
            <Feather name="chevron-right" size={18} color={C.nightMuted} />
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const CORNER = 34;
const styles = themed(() => StyleSheet.create({
  root: { flex: 1, backgroundColor: C.night },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: GUTTER, paddingTop: 6 },
  topTitle: { fontFamily: F.semibold, fontSize: 16, color: C.nightText },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  middle: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  frame: { width: FRAME, height: FRAME },
  corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: C.gold },
  tl: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 18 },
  tr: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 18 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 18 },
  br: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 18 },
  camIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: C.night2, alignItems: 'center', justifyContent: 'center' },
  bottom: { paddingHorizontal: GUTTER, paddingBottom: 18 },
  alt: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.night2, borderRadius: R.md, padding: 16 },
  altText: { flex: 1, fontFamily: F.semibold, fontSize: 15, color: C.nightText },
}));

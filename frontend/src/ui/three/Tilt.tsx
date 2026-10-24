import React, { ReactNode, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { DeviceMotion } from 'expo-sensors';
import { NATIVE } from '../kit';
import { useReduceMotion } from '../motion';

type Props = { children: ReactNode; max?: number; radius?: number; style?: StyleProp<ViewStyle> };

/**
 * A card you can feel: it tilts a few degrees with the phone (or the pointer on web), and a glare
 * slides across it from the app's key light (top left). Kept small on purpose, so money still
 * reads perfectly still. Off entirely with Reduce Motion.
 */
export function Tilt({ children, max = 6, radius = 0, style }: Props) {
  const reduce = useReduceMotion();
  const rx = useRef(new Animated.Value(0)).current; // degrees, + tips the top away
  const ry = useRef(new Animated.Value(0)).current; // degrees, + turns the right side away
  const box = useRef<View>(null);
  const [active, setActiveState] = useState(false);
  const activeRef = useRef(false);
  const setActive = (v: boolean) => {
    if (activeRef.current !== v) setActiveState((activeRef.current = v));
  };

  useEffect(() => {
    if (reduce) return;
    const to = (x: number, y: number) => {
      Animated.parallel([
        Animated.timing(rx, { toValue: x, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE }),
        Animated.timing(ry, { toValue: y, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE }),
      ]).start();
    };
    const clamp = (v: number) => Math.max(-max, Math.min(max, v));

    if (Platform.OS === 'web') {
      // The pointer is the "device": tilt towards it while it's over or near the card.
      const onMove = (e: PointerEvent) => {
        const el = box.current as unknown as HTMLElement | null;
        if (!el?.getBoundingClientRect) return;
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        const near = Math.abs(px) < 0.9 && Math.abs(py) < 0.9;
        setActive(near);
        to(near ? clamp(-py * 2 * max) : 0, near ? clamp(px * 2 * max) : 0);
      };
      window.addEventListener('pointermove', onMove);
      return () => window.removeEventListener('pointermove', onMove);
    }

    // Phones: tilt relative to however the user was holding it when the card appeared.
    let base: { beta: number; gamma: number } | null = null;
    DeviceMotion.setUpdateInterval(60);
    const sub = DeviceMotion.addListener(({ rotation }) => {
      if (!rotation) return;
      if (!base) base = { beta: rotation.beta, gamma: rotation.gamma };
      const deg = 180 / Math.PI;
      // Ease the baseline towards the current pose, so a slow change of grip re-centres the card.
      base.beta += (rotation.beta - base.beta) * 0.02;
      base.gamma += (rotation.gamma - base.gamma) * 0.02;
      setActive(true);
      to(clamp((rotation.beta - base.beta) * deg * 0.6), clamp((rotation.gamma - base.gamma) * deg * 0.6));
    });
    return () => sub.remove();
  }, [max, reduce, rx, ry]);

  if (reduce) return <View style={style}>{children}</View>;

  const rotateX = rx.interpolate({ inputRange: [-90, 90], outputRange: ['-90deg', '90deg'] });
  const rotateY = ry.interpolate({ inputRange: [-90, 90], outputRange: ['-90deg', '90deg'] });
  // Tilting towards the key light (top left) brightens the glare and slides it across.
  const glareX = ry.interpolate({ inputRange: [-max, max], outputRange: [-60, 60] });
  const glareOpacity = Animated.add(rx, Animated.multiply(ry, -1)).interpolate({ inputRange: [-2 * max, 0, 2 * max], outputRange: [0.02, 0.08, 0.22] });

  return (
    <Animated.View ref={box as never} style={[style, { transform: [{ perspective: 900 }, { rotateX }, { rotateY }] }]}>
      {children}
      {active && (
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden', opacity: glareOpacity }]}
        >
          <Animated.View style={{ position: 'absolute', top: -40, bottom: -40, left: '-30%', width: '90%', transform: [{ translateX: glareX }, { rotate: '18deg' }] }}>
            <LinearGradient
              colors={['rgba(255,236,214,0)', 'rgba(255,236,214,0.9)', 'rgba(255,236,214,0)']}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        </Animated.View>
      )}
    </Animated.View>
  );
}

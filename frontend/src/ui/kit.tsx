import React, { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import Svg, { Circle, Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { C, F, getScheme, GUTTER, ON_ACCENT, R, tintFor, themed } from './theme';

export const NATIVE = Platform.OS !== 'web';

// Browsers draw their own focus ring inside our styled fields; the field border shows focus instead.
// minWidth 0 lets a web <input> shrink inside a row; without it, its intrinsic width overflows narrow phones.
export const NO_OUTLINE = (Platform.OS === 'web' ? { outlineStyle: 'none', minWidth: 0 } : {}) as object;

/** Light status-bar text on dark screens, dark text on paper. Applied whenever the screen gains focus. */
export function useStatusBar(style: 'light' | 'dark') {
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle(getScheme() === 'dark' ? 'light' : style);
    }, [style]),
  );
}
export type IconName = React.ComponentProps<typeof Feather>['name'];

export const haptic = (kind: 'light' | 'medium' | 'success' = 'light') => {
  if (Platform.OS === 'web') return;
  if (kind === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  else Haptics.impactAsync(kind === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light).catch(() => {});
};

// ---------------------------------------------------------------- type

type TProps = {
  children: ReactNode;
  color?: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  center?: boolean;
  testID?: string;
  selectable?: boolean;
};

// The base style is a factory so colours are read from the current theme on every render.
function make(base: () => TextStyle, displayName: string) {
  const Styled = ({ children, color, style, numberOfLines, center, testID, selectable }: TProps) => (
    <Text
      testID={testID}
      selectable={selectable}
      numberOfLines={numberOfLines}
      style={[base(), color ? { color } : null, center ? { textAlign: 'center' } : null, style]}
    >
      {children}
    </Text>
  );
  Styled.displayName = displayName;
  return Styled;
}

// Text styles, all Pixelify Sans. Pixel letters run wide, so sizes sit a step below the usual scale,
// and line heights are generous so the square counters never crowd each other.
export const Display = make(() => ({ fontFamily: F.displayBold, fontSize: 36, lineHeight: 42, color: C.ink, letterSpacing: -0.5 }), 'Display');
export const Heading = make(() => ({ fontFamily: F.display, fontSize: 26, lineHeight: 32, color: C.ink, letterSpacing: -0.3 }), 'Heading');
export const Title = make(() => ({ fontFamily: F.semibold, fontSize: 17, lineHeight: 23, color: C.ink }), 'Title');
export const Body = make(() => ({ fontFamily: F.regular, fontSize: 15, lineHeight: 23, color: C.ink2 }), 'Body');
export const Small = make(() => ({ fontFamily: F.regular, fontSize: 13, lineHeight: 19, color: C.ink3 }), 'Small');
export const Strong = make(() => ({ fontFamily: F.semibold, fontSize: 15, lineHeight: 21, color: C.ink }), 'Strong');
export const Label = make(() => ({ fontFamily: F.medium, fontSize: 11, lineHeight: 15, color: C.ink3, letterSpacing: 1.2, textTransform: 'uppercase' }), 'Label');

/**
 * Money, formatted the way people read it: smaller ₹, grouped Indian digits,
 * muted paise (only when there are paise), tabular figures.
 */
export function Amount({
  value,
  size = 17,
  color = C.ink,
  display,
  sign,
  style,
  testID,
}: {
  value: number;
  size?: number;
  color?: string;
  display?: boolean;
  sign?: '+' | '-';
  style?: StyleProp<TextStyle>;
  testID?: string;
}) {
  const abs = Math.abs(value);
  const rupees = Math.floor(abs).toLocaleString('en-IN');
  const paise = Math.round((abs % 1) * 100);
  const family = display ? F.displayBold : F.semibold;
  const negative = value < 0 && !sign;
  return (
    <Text testID={testID} style={[{ fontFamily: family, fontSize: size, color, fontVariant: ['tabular-nums'], letterSpacing: display ? -0.5 : -0.2 }, style]}>
      {sign || (negative ? '−' : '')}
      <Text style={{ fontSize: size * 0.7, fontFamily: F.semibold }}>₹</Text>
      {rupees}
      {paise ? <Text style={{ color: display ? color : C.ink3, fontSize: size * 0.7 }}>.{String(paise).padStart(2, '0')}</Text> : null}
    </Text>
  );
}

// ---------------------------------------------------------------- surfaces

export function Card({
  children,
  style,
  dark,
  padded = true,
  onPress,
  testID,
  accessibilityLabel,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  dark?: boolean;
  padded?: boolean;
  onPress?: () => void;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const base = [s.card, dark && s.cardDark, padded && { padding: 20 }, style];
  // Dark cards are the "vault" glass (balance, plans, rewards): aurora-tinted, with the pixel motif.
  const body = (
    <>
      <Glass vault={dark} />
      {dark && <PixelGrid />}
      {children}
    </>
  );
  if (!onPress) return <View style={base}>{body}</View>;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={() => {
        haptic();
        onPress();
      }}
      style={({ pressed }) => [...base, pressed && { opacity: 0.85, transform: [{ scale: 0.99 }] }]}
    >
      {body}
    </Pressable>
  );
}

/**
 * Frosted glass fill for any rounded container: backdrop blur where the platform has it
 * (iOS, web), the translucent tint everywhere, and a liquid sheen across the top edge.
 * Place it first inside a view with `overflow: 'hidden'`.
 */
export function Glass({ vault, strong, radius }: { vault?: boolean; strong?: boolean; radius?: number }) {
  const dark = getScheme() === 'dark';
  return (
    // `radius` clips the glass itself, for containers that can't hide overflow (e.g. a raised button).
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, radius !== undefined && { borderRadius: radius, overflow: 'hidden' }]}>
      {BLUR_OK && <BlurView intensity={strong ? 60 : 40} tint={dark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />}
      {vault && (
        <LinearGradient
          colors={dark ? ['rgba(194,122,58,0.24)', 'rgba(31,122,104,0.12)'] : ['rgba(22,20,18,0.9)', 'rgba(30,38,36,0.86)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      )}
      <LinearGradient colors={[vault && !dark ? 'rgba(255,255,255,0.12)' : C.sheen, 'rgba(255,255,255,0)']} style={[StyleSheet.absoluteFill, { bottom: '55%' }]} />
    </View>
  );
}

// Android's blur is experimental and costly; there the glass is a translucent tint instead.
const BLUR_OK = Platform.OS === 'ios' || Platform.OS === 'web';

/**
 * The scene every glass surface sits in: one warm key light up and to the left, a cool bounce
 * down and to the right, and a vignette that falls off into the floor. One light source, like a
 * photographed object, rather than decorative glows. Rendered once, behind the navigator.
 */
export function Backdrop() {
  const [key, bounce, floor] = C.aurora;
  const dark = getScheme() === 'dark';
  const o = dark ? 0.3 : 0.6;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: C.paper }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
      <Svg width="100%" height="100%" preserveAspectRatio="xMidYMid slice" viewBox="0 0 400 860">
        <Defs>
          <RadialGradient id="key" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={key} stopOpacity={o} />
            <Stop offset="0.5" stopColor={key} stopOpacity={o * 0.4} />
            <Stop offset="1" stopColor={key} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="bounce" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={bounce} stopOpacity={o * 0.75} />
            <Stop offset="1" stopColor={bounce} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="vignette" cx="38%" cy="30%" r="85%">
            <Stop offset="0.45" stopColor={floor} stopOpacity={0} />
            <Stop offset="1" stopColor={floor} stopOpacity={dark ? 0.7 : 0.18} />
          </RadialGradient>
        </Defs>
        <Rect x={-260} y={-300} width={720} height={720} fill="url(#key)" />
        <Rect x={170} y={520} width={460} height={460} fill="url(#bounce)" />
        <Rect x={0} y={0} width={400} height={860} fill="url(#vignette)" />
      </Svg>
    </View>
  );
}

/**
 * The signature motif: a block of pixels in the top-right corner of dark cards, fading out
 * towards the content. Purely decorative, so it's hidden from screen readers and touches.
 */
export function PixelGrid({ size = 5, cols = 10, rows = 5, color = C.gold }: { size?: number; cols?: number; rows?: number; color?: string }) {
  const gap = 3;
  const cells: ReactNode[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      // Denser and brighter towards the corner; a fixed pattern, so it never shifts between renders.
      const strength = (c / (cols - 1)) * (1 - r / rows);
      if ((c * 7 + r * 13) % 5 > strength * 6) continue;
      cells.push(<Rect key={`${r}-${c}`} x={c * (size + gap)} y={r * (size + gap)} width={size} height={size} rx={1} fill={color} opacity={0.1 + strength * 0.45} />);
    }
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 14, right: 14 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
      <Svg width={cols * (size + gap)} height={rows * (size + gap)}>
        {cells}
      </Svg>
    </View>
  );
}

export function Divider({ inset = 0, dark }: { inset?: number; dark?: boolean }) {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: dark ? C.night3 : C.line, marginLeft: inset }} />;
}

// ---------------------------------------------------------------- buttons

type ButtonProps = {
  label: string;
  onPress?: () => void;
  kind?: 'primary' | 'secondary' | 'ghost' | 'gold' | 'danger';
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function Button({ label, onPress, kind = 'primary', icon, loading, disabled, small, style, testID }: ButtonProps) {
  const palette = {
    primary: { bg: C.primary, fg: C.onPrimary, border: C.primary },
    secondary: { bg: C.surface, fg: C.ink, border: C.lineStrong },
    ghost: { bg: 'transparent', fg: C.ink, border: 'transparent' },
    // The pistachio accent: for the one celebratory action on a slate surface.
    gold: { bg: C.gold, fg: ON_ACCENT, border: C.gold },
    danger: { bg: 'transparent', fg: C.red, border: C.redSoft },
  }[kind];
  const off = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={() => {
        haptic(kind === 'primary' || kind === 'gold' ? 'medium' : 'light');
        onPress?.();
      }}
      style={({ pressed }) => [
        s.button,
        small && s.buttonSmall,
        { backgroundColor: palette.bg, borderColor: palette.border },
        (kind === 'primary' || kind === 'gold') && s.glow,
        kind === 'gold' && { shadowColor: C.gold },
        off && kind !== 'ghost' && { opacity: 0.35 },
        pressed && { transform: [{ scale: 0.98 }], opacity: 0.9 },
        style,
      ]}
    >
      {kind === 'primary' || kind === 'gold' ? (
        <LinearGradient pointerEvents="none" colors={['rgba(255,255,255,0.45)', 'rgba(255,255,255,0)']} style={[StyleSheet.absoluteFill, { bottom: '50%', borderRadius: R.pill }]} />
      ) : null}
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <>
          {icon && <Feather name={icon} size={small ? 15 : 17} color={palette.fg} style={{ marginRight: 8 }} />}
          <Text style={{ fontFamily: F.semibold, fontSize: small ? 14 : 16, color: palette.fg, letterSpacing: 0.2 }}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  label,
  dark,
  badge,
  testID,
}: {
  icon: IconName;
  onPress?: () => void;
  label: string;
  dark?: boolean;
  badge?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={() => {
        haptic();
        onPress?.();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => [s.iconBtn, dark && { backgroundColor: C.night2, borderColor: C.night3 }, pressed && { opacity: 0.6 }]}
    >
      <Glass />
      <Feather name={icon} size={19} color={dark ? C.nightText : C.ink} />
      {badge && <View style={s.dot} />}
    </Pressable>
  );
}

/** Round icon tile with a label underneath (quick actions, services). */
/**
 * A pixel-game keycap: a cap that sits `depth` above its side and travels down when pressed, so
 * the most-used actions feel like physical buttons. The cap is opaque (a glass cap would show its
 * own side through it) and lit from the top left: a bright top edge, the side showing below.
 */
export function Keycap({
  width,
  height,
  radius = 18,
  depth = 5,
  tone = 'plain',
  pressed,
  children,
}: {
  width: number;
  height: number;
  radius?: number;
  depth?: number;
  tone?: 'plain' | 'primary' | 'accent';
  pressed: boolean;
  children: ReactNode;
}) {
  const cap = tone === 'primary' ? C.primary : tone === 'accent' ? C.gold : C.keyCap;
  const side = tone === 'primary' ? (getScheme() === 'dark' ? '#9AA3B5' : '#000000') : tone === 'accent' ? '#2E9C7E' : C.keySide;
  const travel = pressed ? depth - 1 : 0;
  return (
    <View style={{ width, height: height + depth }}>
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height, borderRadius: radius, backgroundColor: side }} />
      <View
        style={{
          width,
          height,
          borderRadius: radius,
          backgroundColor: cap,
          alignItems: 'center',
          justifyContent: 'center',
          borderTopWidth: 1,
          borderLeftWidth: 1,
          borderTopColor: 'rgba(255,255,255,0.22)',
          borderLeftColor: 'rgba(255,255,255,0.1)',
          transform: [{ translateY: travel }],
        }}
      >
        {children}
      </View>
    </View>
  );
}

export function ActionTile({
  icon,
  label,
  onPress,
  tone = 'light',
  testID,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  tone?: 'light' | 'dark' | 'gold';
  testID?: string;
}) {
  const fg = tone === 'dark' ? C.onPrimary : tone === 'gold' ? ON_ACCENT : C.ink;
  return (
    <Pressable
      testID={testID}
      onPress={() => {
        haptic();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ alignItems: 'center', width: 76 }}
    >
      {({ pressed }) => (
        <>
          <Keycap width={60} height={58} radius={18} tone={tone === 'dark' ? 'primary' : tone === 'gold' ? 'accent' : 'plain'} pressed={pressed}>
            <Feather name={icon} size={22} color={fg} />
          </Keycap>
          <Text numberOfLines={2} style={s.tileLabel}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------- people & rows

export function Avatar({ name, size = 44, dark }: { name: string; size?: number; dark?: boolean }) {
  const t = tintFor(name);
  const initials = name
    .replace(/[^A-Za-z ]/g, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: dark ? C.night3 : t.bg, alignItems: 'center', justifyContent: 'center' }}>
      {initials ? (
        <Text style={{ fontFamily: F.semibold, fontSize: size * 0.36, color: dark ? C.nightText : t.fg }}>{initials}</Text>
      ) : (
        <Feather name="user" size={size * 0.44} color={dark ? C.nightText : t.fg} />
      )}
    </View>
  );
}

export function IconMark({ icon, size = 40, tint, dark }: { icon: IconName; size?: number; tint?: string; dark?: boolean }) {
  const t = tintFor(tint ?? icon);
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.26, backgroundColor: dark ? C.night3 : t.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Feather name={icon} size={size * 0.45} color={dark ? C.nightText : t.fg} />
    </View>
  );
}

export function Row({
  left,
  title,
  subtitle,
  right,
  onPress,
  chevron,
  dark,
  testID,
  subtitleLines = 1,
  role = 'button',
  checked,
}: {
  /** 'checkbox' or 'radio' rows announce their checked state to screen readers. */
  role?: 'button' | 'checkbox' | 'radio' | 'link';
  checked?: boolean;
  left?: ReactNode;
  title: string;
  subtitle?: string;
  subtitleLines?: number;
  right?: ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  dark?: boolean;
  testID?: string;
}) {
  const content = (
    <>
      {left && <View style={{ marginRight: 14 }}>{left}</View>}
      <View style={{ flex: 1 }}>
        <Strong color={dark ? C.nightText : C.ink} numberOfLines={1}>
          {title}
        </Strong>
        {subtitle ? (
          <Small color={dark ? C.nightMuted : C.ink3} numberOfLines={subtitleLines} style={{ marginTop: 2 }}>
            {subtitle}
          </Small>
        ) : null}
      </View>
      {right}
      {chevron && <Feather name="chevron-right" size={18} color={dark ? C.nightMuted : C.ink3} style={{ marginLeft: 8 }} />}
    </>
  );
  if (!onPress)
    return (
      <View style={s.row} testID={testID}>
        {content}
      </View>
    );
  return (
    <Pressable
      testID={testID}
      onPress={() => {
        haptic();
        onPress();
      }}
      accessibilityRole={role}
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      accessibilityState={checked === undefined ? undefined : { checked }}
      aria-checked={checked}
      style={({ pressed }) => [s.row, pressed && { opacity: 0.6 }]}
    >
      {content}
    </Pressable>
  );
}

export function Section({ title, action, onAction, children, style, dark }: { title: string; action?: string; onAction?: () => void; children: ReactNode; style?: StyleProp<ViewStyle>; dark?: boolean }) {
  return (
    <View style={[{ marginTop: 28 }, style]}>
      <View style={s.sectionHead}>
        <Label color={dark ? C.nightMuted : C.ink3}>{title}</Label>
        {action && (
          <Pressable onPress={onAction} hitSlop={10} accessibilityRole="button" accessibilityLabel={action}>
            <Text style={{ fontFamily: F.semibold, fontSize: 13, color: dark ? C.gold : C.blue }}>{action}</Text>
          </Pressable>
        )}
      </View>
      {children}
    </View>
  );
}

// ---------------------------------------------------------------- inputs

export function Field({ label, prefix, hint, error, style, onFocus, onBlur, ...rest }: TextInputProps & { label?: string; prefix?: string; hint?: string; error?: string }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ marginBottom: 16 }}>
      {label ? <Small color={C.ink2} style={{ marginBottom: 6, fontFamily: F.medium }}>{label}</Small> : null}
      <View style={[s.field, focused && { borderColor: C.gold, borderWidth: 2, paddingHorizontal: 13 }, error ? { borderColor: C.red } : null]}>
        {prefix ? <Text style={s.fieldPrefix}>{prefix}</Text> : null}
        <TextInput selectionColor={C.gold} cursorColor={C.gold}
          placeholderTextColor={C.ink3}
          style={[s.fieldInput, NO_OUTLINE, style]}
          accessibilityLabel={rest.accessibilityLabel ?? label}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...rest}
        />
      </View>
      {error ? <Small color={C.red} style={{ marginTop: 6 }}>{error}</Small> : hint ? <Small style={{ marginTop: 6 }}>{hint}</Small> : null}
    </View>
  );
}

export function Segmented<T extends string>({ options, value, onChange, dark }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; dark?: boolean }) {
  return (
    <View style={[s.segment, dark && { backgroundColor: C.night2 }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => {
              haptic();
              onChange(o.value);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }} aria-selected={on}
            style={[s.segmentItem, on && { backgroundColor: dark ? C.night3 : C.lineStrong }]}
          >
            <Text style={{ fontFamily: F.semibold, fontSize: 14, color: on ? (dark ? C.nightText : C.ink) : dark ? C.nightMuted : C.ink3 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({ label, active, onPress, icon }: { label: string; active?: boolean; onPress?: () => void; icon?: IconName }) {
  return (
    <Pressable
      onPress={() => {
        haptic();
        onPress?.();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }} aria-selected={!!active}
      style={[s.chip, active && { backgroundColor: C.primary, borderColor: C.primary }, !active && { backgroundColor: C.surface }]}
    >
      {icon && <Feather name={icon} size={13} color={active ? C.onPrimary : C.ink2} style={{ marginRight: 6 }} />}
      <Text style={{ fontFamily: F.medium, fontSize: 14, color: active ? C.onPrimary : C.ink2 }}>{label}</Text>
    </Pressable>
  );
}

export function Toggle({ value, onChange, label, disabled }: { value: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  const x = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(x, { toValue: value ? 1 : 0, duration: 160, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE }).start();
  }, [value, x]);
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled }}
      aria-checked={value}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={() => {
        haptic();
        onChange(!value);
      }}
      style={[s.toggle, { backgroundColor: value ? C.gold : C.lineStrong }, disabled && { opacity: 0.55 }]}
    >
      <Animated.View style={[s.knob, { transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, 18] }) }] }]} />
    </Pressable>
  );
}

// ---------------------------------------------------------------- progress

export function Progress({ value, max = 100, color = C.ink, track = C.paperDeep, height = 6 }: { value: number; max?: number; color?: string; track?: string; height?: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <View style={{ height, borderRadius: 2, backgroundColor: track, overflow: 'hidden' }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}>
      <View style={{ width: `${pct * 100}%`, height: '100%', borderRadius: 2, backgroundColor: color }} />
    </View>
  );
}

export function Ring({ value, size = 56, stroke = 6, color = C.ink, track = C.paperDeep, children }: { value: number; size?: number; stroke?: number; color?: string; track?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={c * (1 - pct)}
          strokeLinecap="butt"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children}
    </View>
  );
}

// ---------------------------------------------------------------- loading & empty

/** Pulsing placeholder block: layout stays put while data loads. */
export function Skeleton({ width = '100%', height = 16, radius = 8, style, dark }: { width?: number | `${number}%`; height?: number; radius?: number; style?: StyleProp<ViewStyle>; dark?: boolean }) {
  const o = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(o, { toValue: 1, duration: 700, useNativeDriver: NATIVE }),
        Animated.timing(o, { toValue: 0.5, duration: 700, useNativeDriver: NATIVE }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [o]);
  return <Animated.View style={[{ width, height, borderRadius: radius, backgroundColor: dark ? C.night2 : C.paperDeep, opacity: o }, style]} />;
}

export function SkeletonScreen({ dark }: { dark?: boolean }) {
  return (
    <View style={{ paddingHorizontal: GUTTER, paddingTop: 8 }} accessibilityLabel="Loading">
      <Skeleton width={180} height={34} dark={dark} />
      <Skeleton height={150} radius={R.lg} style={{ marginTop: 22 }} dark={dark} />
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 22 }}>
          <Skeleton width={40} height={40} radius={20} dark={dark} />
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Skeleton width="60%" height={14} dark={dark} />
            <Skeleton width="35%" height={12} style={{ marginTop: 8 }} dark={dark} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function Empty({ icon, title, body, action }: { icon: IconName; title: string; body?: string; action?: ReactNode }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 36, paddingHorizontal: 24 }}>
      <View style={[s.tile, { backgroundColor: C.paperDeep, width: 56, height: 56 }]}>
        <Feather name={icon} size={24} color={C.ink2} />
      </View>
      <Title center style={{ marginTop: 16 }}>
        {title}
      </Title>
      {body ? (
        <Body center style={{ marginTop: 6 }}>
          {body}
        </Body>
      ) : null}
      {action ? <View style={{ marginTop: 18 }}>{action}</View> : null}
    </View>
  );
}

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <Empty
      icon="wifi-off"
      title="Couldn't load this"
      body="Check your connection. Nothing was charged."
      action={<Button label="Try again" kind="secondary" small onPress={onRetry} />}
    />
  );
}

// ---------------------------------------------------------------- screen shell

type ScreenProps = {
  title?: string;
  kicker?: string;
  back?: boolean;
  right?: ReactNode;
  children: ReactNode;
  dark?: boolean;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  footer?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
};

export function Screen({ title, kicker, back = true, right, children, dark, scroll = true, refreshing, onRefresh, footer, contentStyle }: ScreenProps) {
  const router = useRouter();
  useStatusBar(dark ? 'light' : 'dark');
  // Screens are transparent and float on the shared Backdrop. A `dark` screen (Rewards) sets its
  // text light-on-dark, so it paints the vault surface: a faint lift in dark mode, smoked in light.
  return (
    <View style={{ flex: 1, backgroundColor: dark ? C.night : 'transparent' }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        {(back || right) && (
          <View style={s.topBar}>
            {back ? (
              <IconButton icon="arrow-left" label="Back" dark={dark} onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))} />
            ) : (
              <View />
            )}
            <View style={{ flexDirection: 'row', gap: 8 }}>{right}</View>
          </View>
        )}
        {scroll ? (
          <ScrollView
            contentContainerStyle={[s.content, contentStyle]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={dark ? C.nightText : C.ink} /> : undefined}
          >
            {title ? <ScreenTitle title={title} kicker={kicker} dark={dark} /> : null}
            {children}
          </ScrollView>
        ) : (
          <View style={[{ flex: 1 }, contentStyle]}>
            {title ? (
              <View style={{ paddingHorizontal: GUTTER }}>
                <ScreenTitle title={title} kicker={kicker} dark={dark} />
              </View>
            ) : null}
            {children}
          </View>
        )}
        {footer ? (
          <View style={[s.footer, { borderTopColor: dark ? C.night3 : C.line }]}>
            <Glass strong />
            {footer}
          </View>
        ) : null}
      </SafeAreaView>
    </View>
  );
}

export function ScreenTitle({ title, kicker, dark }: { title: string; kicker?: string; dark?: boolean }) {
  return (
    <View style={{ marginTop: 6, marginBottom: 6 }}>
      {kicker ? <Label color={dark ? C.nightMuted : C.ink3} style={{ marginBottom: 6 }}>{kicker}</Label> : null}
      <Display color={dark ? C.nightText : C.ink}>{title}</Display>
    </View>
  );
}

// ---------------------------------------------------------------- sheet

export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={s.sheet}>
          <Glass strong />
          <View style={s.grabber} />
          <View style={[s.sectionHead, { marginBottom: 14 }]}>
            <Heading style={{ fontSize: 22, lineHeight: 28 }}>{title}</Heading>
            <IconButton icon="x" label="Close" onPress={onClose} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------- tiny bits

export function Pill({ label, tone = 'neutral', icon }: { label: string; tone?: 'neutral' | 'green' | 'red' | 'gold' | 'dark'; icon?: IconName }) {
  const t = {
    neutral: { bg: C.paperDeep, fg: C.ink2 },
    green: { bg: C.greenSoft, fg: C.green },
    red: { bg: C.redSoft, fg: C.red },
    gold: { bg: C.goldSoft, fg: C.goldDeep },
    dark: { bg: C.night3, fg: C.nightText },
  }[tone];
  return (
    <View style={[s.pill, { backgroundColor: t.bg }]}>
      {icon && <Feather name={icon} size={11} color={t.fg} style={{ marginRight: 4 }} />}
      <Text style={{ fontFamily: F.medium, fontSize: 12, color: t.fg, letterSpacing: 0.3 }}>{label}</Text>
    </View>
  );
}

export const s = themed(() => StyleSheet.create({
  card: { backgroundColor: C.surface, borderRadius: R.md, borderWidth: 1, borderColor: C.line, overflow: 'hidden' },
  cardDark: { backgroundColor: C.night, borderColor: C.lineStrong },
  glow: { shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  button: { height: 54, borderRadius: R.pill, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22 },
  buttonSmall: { height: 40, paddingHorizontal: 16 },
  iconBtn: { width: 44, height: 44, borderRadius: 22, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  dot: { position: 'absolute', top: 8, right: 8, width: 8, height: 8, borderRadius: 1, backgroundColor: C.red, borderWidth: 1.5, borderColor: C.surface },
  tile: { width: 60, height: 60, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { fontFamily: F.medium, fontSize: 12, lineHeight: 16, color: C.ink, marginTop: 8, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  field: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.paperDeep, borderRadius: R.sm, borderWidth: 1, borderColor: C.line, paddingHorizontal: 14, minHeight: 52 },
  fieldPrefix: { fontFamily: F.medium, fontSize: 16, color: C.ink3, marginRight: 8 },
  fieldInput: { flex: 1, fontFamily: F.medium, fontSize: 16, color: C.ink, paddingVertical: 14, ...NO_OUTLINE },
  segment: { flexDirection: 'row', backgroundColor: C.paperDeep, borderRadius: R.pill, padding: 4, borderWidth: 1, borderColor: C.line },
  segmentItem: { flex: 1, height: 38, borderRadius: R.pill, alignItems: 'center', justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', height: 36, paddingHorizontal: 14, borderRadius: R.pill, borderWidth: 1, borderColor: C.lineStrong, marginRight: 8 },
  toggle: { width: 48, height: 28, borderRadius: 14, padding: 3, justifyContent: 'center' },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: C.surface },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: GUTTER, paddingTop: 6, paddingBottom: 4 },
  content: { paddingHorizontal: GUTTER, paddingBottom: 130 },
  footer: { paddingHorizontal: GUTTER, paddingTop: 12, paddingBottom: 22, borderTopWidth: 1, overflow: 'hidden', backgroundColor: C.glass },
  backdrop: { flex: 1, backgroundColor: 'rgba(3,5,10,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.glass, borderTopLeftRadius: R.lg, borderTopRightRadius: R.lg, borderWidth: 1, borderBottomWidth: 0, borderColor: C.lineStrong, overflow: 'hidden', paddingHorizontal: GUTTER, paddingTop: 10, paddingBottom: 34, maxHeight: '90%' },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: C.lineStrong, marginBottom: 14 },
  pill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, height: 24, borderRadius: R.pill, alignSelf: 'flex-start' },
}));

import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, View } from 'react-native';
import Svg, { Ellipse, Path } from 'react-native-svg';
import { NavigationContext } from '@react-navigation/native';
import { useReduceMotion } from '../motion';
import { COIN, PADLOCK } from './models';
import { meshFromSprite, Pose, render } from './voxel';

type Model = { rows: readonly string[]; palette: Record<string, string>; depth: number; raised: string };

type Props = {
  model: Model;
  size: number;
  /** Idle spin in radians per second (0 to hold still). */
  spin?: number;
  /** Let the user drag it round; it keeps the throw's momentum, then eases back to its idle spin. */
  interactive?: boolean;
  /** Resting pose: a three-quarter view, so it reads as an object even when still. */
  rest?: Pose;
  /** Spin in once on mount (e.g. a coin landing on a receipt), then rest. */
  flipIn?: boolean;
  accessibilityLabel?: string;
};

const FPS = 30;

/**
 * A voxel model in real perspective, lit by the app's single key light, with a soft contact
 * shadow below it. It only animates while its screen is focused, and holds still when Reduce
 * Motion is on.
 */
export function VoxelModel({ model, size, spin = 0.6, interactive, rest = { yaw: -0.5, pitch: 0.18 }, flipIn, accessibilityLabel }: Props) {
  const mesh = useMemo(() => meshFromSprite(model.rows, model.palette, model.depth, model.raised), [model]);
  const reduce = useReduceMotion();
  const [pose, setPose] = useState<Pose>(flipIn ? { ...rest, yaw: rest.yaw - Math.PI * 4 } : rest);
  const state = useRef({ yaw: pose.yaw, pitch: pose.pitch, vel: flipIn ? 14 : spin, dragging: false, lastX: 0, lastT: 0 });
  const focused = useScreenFocused();

  const animate = focused && !reduce && (spin !== 0 || flipIn || interactive);
  useEffect(() => {
    if (!animate) return;
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 1000 / FPS) return;
      const dt = last ? Math.min(0.1, (t - last) / 1000) : 0;
      last = t;
      const s = state.current;
      if (!s.dragging) {
        if (flipIn) {
          // Decelerate onto the resting angle: a coin landing, not a wheel slowing down.
          const remaining = rest.yaw - s.yaw;
          s.yaw += remaining * Math.min(1, dt * 3.2);
          if (Math.abs(remaining) < 0.002) s.yaw = rest.yaw;
        } else {
          s.vel += (spin - s.vel) * Math.min(1, dt * 1.8); // momentum eases back to the idle spin
          s.yaw += s.vel * dt;
        }
        s.pitch += (rest.pitch - s.pitch) * Math.min(1, dt * 3);
      }
      setPose({ yaw: s.yaw, pitch: s.pitch });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animate, flipIn, rest.pitch, rest.yaw, spin]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !!interactive,
        onMoveShouldSetPanResponder: (_e, g) => !!interactive && Math.abs(g.dx) > 4,
        onPanResponderGrant: (_e, g) => {
          Object.assign(state.current, { dragging: true, lastX: g.moveX, lastT: Date.now() });
        },
        onPanResponderMove: (_e, g) => {
          const s = state.current;
          const now = Date.now();
          const dx = g.moveX - s.lastX;
          s.yaw += dx / (size * 0.5);
          s.pitch = Math.max(-0.5, Math.min(0.5, rest.pitch + g.dy / (size * 2)));
          s.vel = (dx / (size * 0.5)) / Math.max(0.016, (now - s.lastT) / 1000);
          s.lastX = g.moveX;
          s.lastT = now;
          if (reduce) setPose({ yaw: s.yaw, pitch: s.pitch }); // no loop running: draw directly
        },
        onPanResponderRelease: () => {
          state.current.dragging = false;
        },
        onPanResponderTerminate: () => {
          state.current.dragging = false;
        },
      }),
    [interactive, reduce, rest.pitch, size],
  );

  const shapes = render(mesh, reduce && !interactive ? rest : pose, size);
  // The contact shadow narrows as the model turns side-on, like a real object's footprint.
  const footprint = 0.34 + 0.18 * Math.abs(Math.cos(pose.yaw));
  return (
    <View
      {...responder.panHandlers}
      style={{ width: size, height: size * 1.06 }}
      accessible={!!accessibilityLabel}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityLabel ? 'image' : undefined}
      accessibilityHint={interactive ? 'Drag to spin' : undefined}
    >
      <Svg width={size} height={size * 1.06}>
        {/* Offset right of centre: the key light is top left, so the shadow falls the other way. */}
        <Ellipse cx={size * 0.54} cy={size * 0.99} rx={size * footprint * 0.8} ry={size * 0.045} fill="#000" opacity={0.4} />
        {shapes.map((sh, i) => (
          <Path key={i} d={sh.d} fill={sh.fill} stroke={sh.fill} strokeWidth={0.6} strokeLinejoin="round" />
        ))}
      </Svg>
    </View>
  );
}

/**
 * Whether the screen holding this view is in front. Tab screens stay mounted when hidden, so models
 * stop drawing frames there. Outside any navigator (e.g. the app lock overlay) it's always true.
 */
function useScreenFocused() {
  const nav = useContext(NavigationContext);
  const [focused, setFocused] = useState(() => nav?.isFocused() ?? true);
  useEffect(() => {
    if (!nav) return;
    setFocused(nav.isFocused());
    const on = nav.addListener('focus', () => setFocused(true));
    const off = nav.addListener('blur', () => setFocused(false));
    return () => {
      on();
      off();
    };
  }, [nav]);
  return focused;
}

/** CoinQuest's coin as a real object: copper, with an embossed ₹. */
export function VoxelCoin(props: Omit<Props, 'model'>) {
  return <VoxelModel model={COIN} accessibilityLabel={props.accessibilityLabel ?? 'CoinQuest coin'} {...props} />;
}

export function VoxelPadlock(props: Omit<Props, 'model'>) {
  return <VoxelModel model={PADLOCK} accessibilityLabel={props.accessibilityLabel ?? 'Locked'} {...props} />;
}

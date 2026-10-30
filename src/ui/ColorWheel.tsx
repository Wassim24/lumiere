import { memo, useRef } from 'react';
import { PanResponder, View, type GestureResponderEvent } from 'react-native';
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';
import { hex, hsvRgb } from '../store/color';
import { t } from '../i18n';

const N = 90;

const Wheel = memo(function Wheel({ size }: { size: number }) {
  const r = size / 2;
  const wedges = [];
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * 2 * Math.PI - 0.01;
    const a1 = ((i + 1) / N) * 2 * Math.PI + 0.01;
    // angle measured clockwise from 12 o'clock
    const p = (a: number) => `${r + Math.sin(a) * r} ${r - Math.cos(a) * r}`;
    wedges.push(
      <Path key={i} d={`M${r} ${r} L${p(a0)} A${r} ${r} 0 0 1 ${p(a1)} Z`} fill={hex(hsvRgb(((i + 0.5) / N) * 360, 1))} />,
    );
  }
  return (
    <Svg width={size} height={size}>
      <Defs>
        <RadialGradient id="w" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="#fff" stopOpacity={1} />
          <Stop offset="0.7" stopColor="#fff" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      {wedges}
      <Circle cx={r} cy={r} r={r} fill="url(#w)" />
    </Svg>
  );
});

type Props = {
  size: number;
  hue: number;
  sat: number; // 0..1
  color: string;
  onChange: (hue: number, sat: number) => void;
  onComplete: (hue: number, sat: number) => void;
};

export function ColorWheel({ size, hue, sat, color, onChange, onComplete }: Props) {
  const ref = useRef({ onChange, onComplete, last: { hue, sat } });
  ref.current.onChange = onChange;
  ref.current.onComplete = onComplete;

  const at = (e: GestureResponderEvent) => {
    const r = size / 2;
    const dx = e.nativeEvent.locationX - r;
    const dy = e.nativeEvent.locationY - r;
    const h = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    const s = Math.min(1, Math.sqrt(dx * dx + dy * dy) / r);
    ref.current.last = { hue: h, sat: s };
    return ref.current.last;
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => { const v = at(e); ref.current.onChange(v.hue, v.sat); },
      onPanResponderMove: (e) => { const v = at(e); ref.current.onChange(v.hue, v.sat); },
      onPanResponderRelease: () => ref.current.onComplete(ref.current.last.hue, ref.current.last.sat),
      onPanResponderTerminate: () => ref.current.onComplete(ref.current.last.hue, ref.current.last.sat),
    }),
  ).current;

  const R = size / 2;
  const rad = (hue * Math.PI) / 180;
  return (
    <View
      accessible
      accessibilityLabel={t.control.wheel}
      style={{ width: size, height: size, borderRadius: R }}
      {...pan.panHandlers}
    >
      <View pointerEvents="none">
        <Wheel size={size} />
        <View
          style={{
            position: 'absolute', left: R + Math.sin(rad) * sat * R - 11, top: R - Math.cos(rad) * sat * R - 11,
            width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#fff', backgroundColor: color,
            elevation: 3,
          }}
        />
      </View>
    </View>
  );
}

import { useRef, useState } from 'react';
import { PanResponder, View, type GestureResponderEvent } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C } from './theme';

type Props = {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
  onComplete: (v: number) => void;
  colors?: string[]; // gradient track
  fill?: string; // solid fill up to value
  label: string;
  disabled?: boolean;
};

/** Wide 44 px track with a thin dark thumb, as in the design. */
export function Slider({ min, max, step = 1, value, onChange, onComplete, colors, fill, label, disabled }: Props) {
  const [w, setW] = useState(1);
  const ref = useRef({ w: 1, last: value, props: { min, max, step, onChange, onComplete } });
  ref.current.w = w;
  ref.current.props = { min, max, step, onChange, onComplete };

  const valueAt = (e: GestureResponderEvent) => {
    const { min, max, step } = ref.current.props;
    const x = Math.max(0, Math.min(ref.current.w, e.nativeEvent.locationX));
    const v = min + (x / ref.current.w) * (max - min);
    return Math.max(min, Math.min(max, Math.round(v / step) * step));
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const v = valueAt(e);
        ref.current.last = v;
        ref.current.props.onChange(v);
      },
      onPanResponderMove: (e) => {
        const v = valueAt(e);
        if (v !== ref.current.last) {
          ref.current.last = v;
          ref.current.props.onChange(v);
        }
      },
      onPanResponderRelease: () => ref.current.props.onComplete(ref.current.last),
      onPanResponderTerminate: () => ref.current.props.onComplete(ref.current.last),
    }),
  ).current;

  const pct = (value - min) / (max - min);
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min, max, now: value }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        const d = (e.nativeEvent.actionName === 'increment' ? 1 : -1) * Math.max(step, (max - min) / 20);
        const v = Math.max(min, Math.min(max, value + d));
        onChange(v);
        onComplete(v);
      }}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={{ height: 44, borderRadius: 16, overflow: 'hidden', backgroundColor: C.bg, opacity: disabled ? 0.6 : 1 }}
      {...pan.panHandlers}
    >
      <View pointerEvents="none" style={{ flex: 1 }}>
        {colors && <LinearGradient colors={colors as any} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1 }} />}
        {fill && <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct * 100}%`, backgroundColor: fill }} />}
        <View
          style={{
            position: 'absolute', top: 8, left: Math.max(4, Math.min(w - 10, pct * w - 3)),
            width: 6, height: 28, borderRadius: 3, backgroundColor: C.ink2, borderWidth: 1.5, borderColor: '#fff',
          }}
        />
      </View>
    </View>
  );
}

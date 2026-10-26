import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { orbReach, orbStops } from '../store/color';
import { C } from './theme';

const DESIGN_WIDTH = 390;

// x and y are the center on the 390 px artboard, r the radius of the CSS circle before blur.
export type Orb = { x: number; y: number; r: number; color: string; opacity?: number };

/** Soft blurred color blobs, as in the design (CSS blur(70px) on circles). */
export function Background({ orbs }: { orbs: Orb[] }) {
  // Orbs scale with the screen so they cover the same share of it at any display size.
  const scale = useWindowDimensions().width / DESIGN_WIDTH;
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: C.bg }]} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          {orbs.map((o, i) => (
            <RadialGradient key={i} id={`o${i}`} cx="50%" cy="50%" r="50%">
              {orbStops(o.r).map((s) => (
                <Stop key={s.offset} offset={s.offset} stopColor={o.color} stopOpacity={s.alpha * (o.opacity ?? 1)} />
              ))}
            </RadialGradient>
          ))}
        </Defs>
        {orbs.map((o, i) => (
          <Circle key={i} cx={o.x * scale} cy={o.y * scale} r={orbReach(o.r) * scale} fill={`url(#o${i})`} />
        ))}
      </Svg>
    </View>
  );
}

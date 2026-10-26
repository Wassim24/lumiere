import Svg, { Circle, Path } from 'react-native-svg';

type P = { size?: number; color?: string; width?: number };

const stroke = (color: string, width: number) => ({ fill: 'none', stroke: color, strokeWidth: width, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const });

export const Plus = ({ size = 20, color = '#fff', width = 2 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24"><Path d="M12 5v14M5 12h14" {...stroke(color, width)} /></Svg>
);
export const Back = ({ size = 22, color = '#0A0D12', width = 1.8 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24"><Path d="M15 5l-7 7l7 7" {...stroke(color, width)} /></Svg>
);
export const Close = ({ size = 20, color = '#0A0D12', width = 1.8 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24"><Path d="M6 6l12 12M18 6L6 18" {...stroke(color, width)} /></Svg>
);
export const More = ({ size = 20, color = '#0A0D12' }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Circle cx="5" cy="12" r="1.6" fill={color} /><Circle cx="12" cy="12" r="1.6" fill={color} /><Circle cx="19" cy="12" r="1.6" fill={color} />
  </Svg>
);
export const Power = ({ size = 22, color = '#fff', width = 2 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24"><Path d="M12 3v8M6.3 6.3a8 8 0 1 0 11.4 0" {...stroke(color, width)} /></Svg>
);
export const Bulb = ({ size = 20, color = '#fff', width = 1.8 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z" {...stroke(color, width)} />
  </Svg>
);
export const Sparkle = ({ size = 20, color = '#fff', width = 1.8 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24"><Path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z" {...stroke(color, width)} /></Svg>
);
export const Sliders = ({ size = 20, color = '#fff', width = 1.8 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" {...stroke(color, width)} />
    <Circle cx="15" cy="6" r="2" {...stroke(color, width)} /><Circle cx="9" cy="12" r="2" {...stroke(color, width)} /><Circle cx="17" cy="18" r="2" {...stroke(color, width)} />
  </Svg>
);
export const Eye = ({ size = 20, color = '#636975', width = 1.8 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M2 12s3.5-7 10-7s10 7 10 7s-3.5 7-10 7S2 12 2 12z" {...stroke(color, width)} /><Circle cx="12" cy="12" r="3" {...stroke(color, width)} />
  </Svg>
);
export const Check = ({ size = 20, color = '#0069E0', width = 2.2 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24"><Path d="M5 12.5l4.5 4.5L19 7.5" {...stroke(color, width)} /></Svg>
);
export const Wifi = ({ size = 20, color = '#0A0D12', width = 1.8 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01" {...stroke(color, width)} />
  </Svg>
);
export const Refresh = ({ size = 20, color = '#0A0D12', width = 1.8 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24"><Path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" {...stroke(color, width)} /></Svg>
);
export const Chevron = ({ size = 18, color = '#636975', width = 1.8 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24"><Path d="M9 5l7 7l-7 7" {...stroke(color, width)} /></Svg>
);

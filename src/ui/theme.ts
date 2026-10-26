import { StyleSheet } from 'react-native';

export const C = {
  bg: '#DBEBFF',
  ink: '#0A0D12',
  ink2: '#181D27',
  muted: '#636975',
  muted2: '#6B7079',
  link: '#0069E0',
  glass: 'rgba(250,253,255,0.55)',
  glassEdge: 'rgba(255,255,255,0.75)',
  glassDim: 'rgba(246,247,248,0.5)',
  info: 'rgba(204,231,255,0.6)',
  track: '#CCE7FF',
  white: '#FFFFFF',
  lilac: '#E4CCFF',
  peach: '#FFD1B8',
  mint: '#D3F6E3',
  warn: '#FFD1B8',
};

export const F = {
  regular: 'Geist_400Regular',
  medium: 'Geist_500Medium',
  semibold: 'Geist_600SemiBold',
};

export const S = StyleSheet.create({
  glass: {
    backgroundColor: C.glass,
    borderWidth: 1,
    borderColor: C.glassEdge,
  },
  ink: {
    backgroundColor: C.ink2,
    borderWidth: 1,
    borderColor: C.ink,
  },
  t14: { fontFamily: F.medium, fontSize: 14, color: C.ink, letterSpacing: -0.14 },
  t14m: { fontFamily: F.medium, fontSize: 14, color: C.muted },
  t12: { fontFamily: F.medium, fontSize: 12, color: C.muted },
  t16: { fontFamily: F.medium, fontSize: 16, color: C.ink, letterSpacing: -0.16 },
  t18: { fontFamily: F.medium, fontSize: 18, lineHeight: 24, color: C.ink, letterSpacing: -0.18 },
  t20: { fontFamily: F.medium, fontSize: 20, lineHeight: 28, color: C.ink, letterSpacing: -0.2 },
  t24: { fontFamily: F.medium, fontSize: 24, lineHeight: 28, color: C.ink, letterSpacing: -0.48 },
  t32: { fontFamily: F.medium, fontSize: 32, lineHeight: 40, color: C.ink, letterSpacing: -0.64 },
});

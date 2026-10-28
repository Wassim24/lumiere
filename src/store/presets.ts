import { t } from '../i18n';

export type PresetMode = 'white' | 'color' | 'flow';

export type Preset = {
  id: string;
  name: string;
  mode: PresetMode;
  value?: number; // K or 0xRRGGBB
  bright?: number;
  flow?: string;
  flowAction?: number;
  builtIn: boolean;
  meta?: string;
  dot?: string;
};

export const BUILTIN_PRESETS: Preset[] = [
  { id: 'focus', name: t.presets.focus, mode: 'white', value: 5000, bright: 100, builtIn: true, dot: '#FFE9D6' },
  { id: 'computer', name: t.presets.computer, mode: 'white', value: 4000, bright: 75, builtIn: true, dot: '#FFD9B5' },
  { id: 'reading', name: t.presets.reading, mode: 'white', value: 3000, bright: 90, builtIn: true, dot: '#FFB46B' },
  { id: 'cozy', name: t.presets.cozy, mode: 'white', value: 2700, bright: 70, builtIn: true, dot: '#FFA757' },
  { id: 'relax', name: t.presets.relax, mode: 'white', value: 2200, bright: 40, builtIn: true, dot: '#FF8B2E' },
  { id: 'romantic', name: t.presets.romantic, mode: 'color', value: 0xff3355, bright: 20, builtIn: true, meta: t.presets.pink },
  { id: 'cinema', name: t.presets.cinema, mode: 'color', value: 0x2a3bff, bright: 10, builtIn: true, meta: t.presets.blue },
  { id: 'night', name: t.presets.night, mode: 'white', value: 1700, bright: 1, builtIn: true, dot: '#FF7A1A' },
  { id: 'wakeup', name: t.presets.wakeup, mode: 'flow', flow: '900000,2,4000,100', flowAction: 1, builtIn: true, meta: '15 min', dot: '#FFC98A' },
];

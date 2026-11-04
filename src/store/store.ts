// App state: persisted lamps and presets, live lamp states, one LanConnection per lamp.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { useSyncExternalStore } from 'react';
import { LanConnection } from '../protocol/lan';
import { cmd } from '../protocol/commands';
import type { Found } from '../protocol/discovery';
import { nativeTransport, Yeenet } from '../net/native';
import { discover, lanReachable } from '../net/discover';
import { BUILTIN_PRESETS, type Preset } from './presets';
import { hsvRgb } from './color';
import type { WifiInfo } from '../../modules/yeenet';

export type Lamp = {
  id: string;
  name: string;
  did: number;
  ip: string;
  model?: string;
  mac?: string;
  room?: string;
};

export type Mode = 'color' | 'white' | 'hsv';

export type LampState = {
  online: boolean;
  power: boolean;
  bright: number;
  mode: Mode;
  rgb: number;
  ct: number;
  hue: number;
  sat: number;
  flowing: boolean;
  delayOffMin: number;
};

export type Candidate = Found & { lanEnabled: boolean };

export type Snack = { id: number; text: string; retry?: () => void };

type State = {
  ready: boolean;
  lamps: Lamp[];
  states: Record<string, LampState>;
  customPresets: Preset[];
  hiddenPresets: string[];
  recentColors: number[];
  candidates: Candidate[];
  searching: boolean;
  wifi: WifiInfo | null;
  snack: Snack | null;
  currentLampId: string | null;
  timerChoice: Record<string, number>;
};

const DEFAULT_RECENTS = [0xff3355, 0x2a3bff, 0xff8a3d, 0x8b5cff, 0x3ddc97, 0xffd23f];

let state: State = {
  ready: false,
  lamps: [],
  states: {},
  customPresets: [],
  hiddenPresets: [],
  recentColors: DEFAULT_RECENTS,
  candidates: [],
  searching: false,
  wifi: null,
  snack: null,
  currentLampId: null,
  timerChoice: {},
};

const listeners = new Set<() => void>();
export function set(patch: Partial<State> | ((s: State) => Partial<State>)) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  listeners.forEach((l) => l());
}

export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => sel(state),
  );
}

export const getState = () => state;

const KEY = 'lumiere.v1';
const AUTO_DISCOVERY_MIN_INTERVAL_MS = 30_000;
const AUTO_DISCOVERY_DELAY_MS = 1500;
const SNACK_DURATION_MS = 5000;

export async function persist() {
  const { lamps, customPresets, hiddenPresets, recentColors, currentLampId } = state;
  await AsyncStorage.setItem(KEY, JSON.stringify({ lamps, customPresets, hiddenPresets, recentColors, currentLampId }));
}

const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = (Math.random() * 16) | 0;
  return (c === 'x' ? r : (r & 3) | 8).toString(16);
});

const conns = new Map<string, LanConnection>();

export const offline = (): LampState => ({
  online: false, power: false, bright: 100, mode: 'white', rgb: 0xffffff, ct: 4000, hue: 0, sat: 0, flowing: false, delayOffMin: 0,
});

export function patchLamp(id: string, p: Partial<LampState>) {
  set((s) => ({ states: { ...s.states, [id]: { ...(s.states[id] ?? offline()), ...p } } }));
}

function applyProps(id: string, props: Record<string, string>) {
  const p: Partial<LampState> = {};
  const n = (k: string) => (props[k] !== undefined && props[k] !== '' ? Number(props[k]) : undefined);
  if (props.power) p.power = props.power === 'on';
  if (n('bright') !== undefined) p.bright = n('bright')!;
  if (n('ct') !== undefined) p.ct = n('ct')!;
  if (n('rgb') !== undefined) p.rgb = n('rgb')!;
  if (n('hue') !== undefined) p.hue = n('hue')!;
  if (n('sat') !== undefined) p.sat = n('sat')!;
  const cm = n('color_mode');
  if (cm === 1) p.mode = 'color';
  else if (cm === 2) p.mode = 'white';
  else if (cm === 3) p.mode = 'hsv';
  if (props.flowing !== undefined && props.flowing !== '') p.flowing = props.flowing === '1';
  if (n('delayoff') !== undefined) p.delayOffMin = n('delayoff')!;
  patchLamp(id, p);
}

export function connFor(lamp: Lamp): LanConnection {
  let c = conns.get(lamp.id);
  if (!c) {
    c = new LanConnection(nativeTransport, lamp.ip);
    c.onProps = (props) => applyProps(lamp.id, props);
    c.onStatus = (status) => {
      if (status === 'connected') {
        if (!state.states[lamp.id]?.online) refresh(lamp.id);
      } else if (status === 'failed') {
        patchLamp(lamp.id, { online: false });
        scheduleDiscovery();
      }
    };
    conns.set(lamp.id, c);
  } else c.setHost(lamp.ip);
  return c;
}

export async function refresh(id: string) {
  const lamp = state.lamps.find((l) => l.id === id);
  if (!lamp) return;
  try {
    const props = await cmd.getProps(connFor(lamp));
    applyProps(id, props);
    patchLamp(id, { online: true });
  } catch {
    patchLamp(id, { online: false });
  }
}

function startAll() {
  for (const l of state.lamps) connFor(l).start();
}

function stopAll() {
  conns.forEach((c) => c.stop());
}

let discoveryTimer: ReturnType<typeof setTimeout> | null = null;
let lastAutoDiscovery = 0;
/** Background re-discovery after a connection failure (the IP may have changed); at most every 30 s. */
function scheduleDiscovery() {
  if (discoveryTimer || Date.now() - lastAutoDiscovery < AUTO_DISCOVERY_MIN_INTERVAL_MS) return;
  lastAutoDiscovery = Date.now();
  discoveryTimer = setTimeout(() => {
    discoveryTimer = null;
    runDiscovery();
  }, AUTO_DISCOVERY_DELAY_MS);
}

export function updateWifi() {
  try {
    set({ wifi: Yeenet.getWifiInfo() });
  } catch {
    set({ wifi: null });
  }
}

export async function runDiscovery() {
  if (state.searching) return;
  updateWifi();
  if (!state.wifi?.isWifi) return;
  set({ searching: true });
  try {
    const found = await discover();
    let changed = false;
    const lamps = state.lamps.map((l) => {
      const f = found.find((x) => x.did === l.did);
      if (f && f.ip !== l.ip) {
        changed = true;
        return { ...l, ip: f.ip };
      }
      return l;
    });
    if (changed) {
      set({ lamps });
      persist();
      lamps.forEach((l) => connFor(l));
    }
    const unknown = found.filter((f) => !lamps.some((l) => l.did === f.did));
    const candidates = await Promise.all(unknown.map(async (f) => ({ ...f, lanEnabled: await lanReachable(f.ip) })));
    set({ candidates });
    for (const l of lamps) if (!state.states[l.id]?.online) refresh(l.id);
  } catch (e) {
    console.warn('[discover] failed', String(e));
  } finally {
    set({ searching: false });
  }
}

let started = false;
export async function init() {
  if (started) return;
  started = true;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      set({
        lamps: d.lamps ?? [],
        customPresets: d.customPresets ?? [],
        hiddenPresets: d.hiddenPresets ?? [],
        recentColors: d.recentColors ?? DEFAULT_RECENTS,
        currentLampId: d.currentLampId ?? null,
      });
    }
  } catch (e) {
    console.warn('[store] could not restore saved state', String(e));
  }
  set({ ready: true });
  updateWifi();
  startAll();
  runDiscovery();
  AppState.addEventListener('change', (s) => {
    if (s === 'active') {
      updateWifi();
      startAll();
      runDiscovery();
    } else if (s === 'background') stopAll();
  });
}

let snackSeq = 0;
export function showSnack(text: string, retry?: () => void) {
  const snack = { id: ++snackSeq, text, retry };
  set({ snack });
  setTimeout(() => {
    if (state.snack?.id === snack.id) set({ snack: null });
  }, SNACK_DURATION_MS);
}
export const dismissSnack = () => set({ snack: null });

export function setCurrentLamp(id: string) {
  set({ currentLampId: id });
  persist();
}

export function addLamp(l: Omit<Lamp, 'id'>): Lamp {
  const existing = state.lamps.find((x) => x.did === l.did);
  const lamp: Lamp = existing ? { ...existing, ...l } : { ...l, id: uuid() };
  set((s) => ({
    lamps: existing ? s.lamps.map((x) => (x.id === lamp.id ? lamp : x)) : [...s.lamps, lamp],
    candidates: s.candidates.filter((c) => c.did !== l.did),
    currentLampId: s.currentLampId ?? lamp.id,
  }));
  persist();
  connFor(lamp).start();
  refresh(lamp.id);
  return lamp;
}

export function updateLamp(id: string, p: Partial<Pick<Lamp, 'name' | 'room'>>) {
  set((s) => ({ lamps: s.lamps.map((l) => (l.id === id ? { ...l, ...p } : l)) }));
  persist();
}

export function removeLamp(id: string) {
  conns.get(id)?.stop();
  conns.delete(id);
  set((s) => {
    const { [id]: _removed, ...states } = s.states;
    const lamps = s.lamps.filter((l) => l.id !== id);
    return { lamps, states, currentLampId: s.currentLampId === id ? lamps[0]?.id ?? null : s.currentLampId };
  });
  persist();
  scheduleDiscovery();
}

export function allPresets(s: State = state): Preset[] {
  return [...BUILTIN_PRESETS, ...s.customPresets];
}

export function presetMatches(p: Preset, st: LampState | undefined): boolean {
  if (!st || !st.power) return false;
  if (p.mode === 'white') return st.mode === 'white' && st.ct === p.value && st.bright === p.bright && !st.flowing;
  if (p.mode === 'color') return st.mode === 'color' && st.rgb === p.value && st.bright === p.bright && !st.flowing;
  return false;
}

export function activePreset(st: LampState | undefined): Preset | undefined {
  return allPresets().find((p) => presetMatches(p, st));
}

export function saveCurrentAsPreset(lampId: string, name: string) {
  const st = state.states[lampId];
  if (!st) return;
  const white = st.mode === 'white';
  const value = white ? st.ct : st.mode === 'hsv' ? hsvRgb(st.hue, st.sat / 100) : st.rgb;
  const p: Preset = { id: uuid(), name, mode: white ? 'white' : 'color', value, bright: st.bright, builtIn: false };
  set((s) => ({ customPresets: [...s.customPresets, p] }));
  persist();
}

export function renamePreset(id: string, name: string) {
  set((s) => ({ customPresets: s.customPresets.map((p) => (p.id === id ? { ...p, name } : p)) }));
  persist();
}

export function deletePreset(id: string) {
  set((s) => ({ customPresets: s.customPresets.filter((p) => p.id !== id) }));
  persist();
}

export function toggleHiddenPreset(id: string) {
  set((s) => ({
    hiddenPresets: s.hiddenPresets.includes(id) ? s.hiddenPresets.filter((x) => x !== id) : [...s.hiddenPresets, id],
  }));
  persist();
}

/** "Pas sur le Wi-Fi maison": active network is not Wi-Fi, or not the lamps' /24. */
export function offHomeWifi(s: State): boolean {
  if (!s.wifi) return false;
  if (!s.wifi.isWifi) return true;
  if (!s.wifi.ip) return false;
  const lamps = s.lamps.filter((l) => !l.ip.startsWith('127.'));
  if (!lamps.length) return false;
  const net = (ip: string) => ip.split('.').slice(0, 3).join('.');
  return !lamps.some((l) => net(l.ip) === net(s.wifi!.ip!));
}

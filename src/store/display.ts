import { hex, hsvRgb, kelvinRgb } from './color';
import { activePreset, type Lamp, type LampState } from './store';
import type { Preset } from './presets';
import { t } from '../i18n';

export function lampRgb(st: LampState): number {
  if (st.mode === 'white') return kelvinRgb(st.ct);
  if (st.mode === 'hsv') return hsvRgb(st.hue, st.sat / 100);
  return st.rgb;
}

export const lampHex = (st: LampState) => hex(lampRgb(st));

export function presetDot(p: Preset): string {
  if (p.dot) return p.dot;
  return p.mode === 'white' ? hex(kelvinRgb(p.value!)) : hex(p.value!);
}

export function presetMeta(p: Preset): string {
  if (p.mode === 'flow') return p.meta ?? t.common.animation;
  if (p.mode === 'white') return `${p.value} K · ${t.pct(p.bright!)}`;
  return `${p.meta ?? hex(p.value!)} · ${t.pct(p.bright!)}`;
}

/** Control header: preset, mode and brightness. */
export function lampDetail(st: LampState): string {
  if (!st.power) return t.common.off;
  const p = activePreset(st);
  const mode = st.flowing ? t.common.animation : st.mode === 'white' ? `${st.ct} K` : t.common.color;
  return `${p ? p.name + ' · ' : ''}${mode} · ${t.pct(st.bright)}`;
}

export function lampStatus(l: Lamp, st: LampState | undefined): string {
  const room = l.room ? l.room + ' · ' : '';
  if (!st || !st.online) return t.common.offline;
  if (!st.power) return room + t.common.off;
  const p = activePreset(st);
  const mode = p ? p.name : st.flowing ? t.common.animation : st.mode === 'white' ? `${st.ct} K` : t.common.color;
  return `${room}${mode} · ${t.pct(st.bright)}`;
}

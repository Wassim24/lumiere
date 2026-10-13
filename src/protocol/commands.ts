// Typed Yeelight LAN commands (spec §2.2 table).
import type { LanConnection } from './lan';

export const STATE_PROPS = ['power', 'bright', 'ct', 'rgb', 'hue', 'sat', 'color_mode', 'flowing', 'delayoff', 'name'];

const FADE = ['smooth', 500] as const;

export const cmd = {
  setPower: (c: LanConnection, on: boolean) => c.request('set_power', [on ? 'on' : 'off', ...FADE]),
  toggle: (c: LanConnection) => c.request('toggle', []),
  setBright: (c: LanConnection, v: number) => c.request('set_bright', [clamp(Math.round(v), 1, 100), ...FADE]),
  setRgb: (c: LanConnection, rgb: number) => c.request('set_rgb', [rgb & 0xffffff, ...FADE]),
  setCt: (c: LanConnection, k: number) => c.request('set_ct_abx', [clamp(Math.round(k), 1700, 6500), ...FADE]),
  setHsv: (c: LanConnection, h: number, s: number) => c.request('set_hsv', [Math.round(h) % 360, clamp(Math.round(s), 0, 100), ...FADE]),
  sceneCt: (c: LanConnection, k: number, bright: number) => c.request('set_scene', ['ct', k, bright]),
  sceneColor: (c: LanConnection, rgb: number, bright: number) => c.request('set_scene', ['color', rgb, bright]),
  startCf: (c: LanConnection, count: number, action: number, expr: string) => c.request('start_cf', [count, action, expr]),
  stopCf: (c: LanConnection) => c.request('stop_cf', []),
  cronAdd: (c: LanConnection, minutes: number) => c.request('cron_add', [0, minutes]),
  cronGet: (c: LanConnection) => c.request('cron_get', [0]),
  cronDel: (c: LanConnection) => c.request('cron_del', [0]),
  setName: (c: LanConnection, name: string) => c.request('set_name', [name]),
  getProps: async (c: LanConnection): Promise<Record<string, string>> => {
    const vals: string[] = await c.request('get_prop', STATE_PROPS);
    return Object.fromEntries(STATE_PROPS.map((k, i) => [k, vals?.[i] ?? '']));
  },
};

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

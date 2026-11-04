// Lamp commands from the UI: optimistic state, then the LAN call.
import { Coalescer, type LanConnection } from '../protocol/lan';
import { cmd } from '../protocol/commands';
import type { Preset } from './presets';
import { hsvRgb } from './color';
import { t } from '../i18n';
import { connFor, getState, offline, patchLamp, persist, refresh, set, showSnack, type LampState } from './store';

const RECENT_COLORS_MAX = 6;
const SEND_INTERVAL_MS = 333;
const WAKE_UP_CT = 1700;

const coalescer = new Coalescer(SEND_INTERVAL_MS);

function lampOf(id: string) {
  const l = getState().lamps.find((x) => x.id === id);
  if (!l) throw new Error('unknown lamp');
  return l;
}

/** Optimistic update; on failure revert to the real state and offer a retry. */
async function run(id: string, optimistic: Partial<LampState>, action: (c: LanConnection) => Promise<unknown>) {
  const lamp = lampOf(id);
  patchLamp(id, optimistic);
  try {
    await action(connFor(lamp));
  } catch {
    refresh(id);
    showSnack(t.common.notResponding(lamp.name), () => run(id, optimistic, action));
  }
}

async function ensureOn(id: string, c: LanConnection) {
  if (!getState().states[id]?.power) {
    await cmd.setPower(c, true);
    patchLamp(id, { power: true });
  }
}

function addRecent(rgb: number) {
  const recentColors = [rgb, ...getState().recentColors.filter((c) => c !== rgb)].slice(0, RECENT_COLORS_MAX);
  set({ recentColors });
  persist();
}

export const lampActions = {
  setPower: (id: string, on: boolean) => run(id, { power: on }, (c) => cmd.setPower(c, on)),
  toggle: (id: string) => {
    const on = !getState().states[id]?.power;
    return run(id, { power: on }, (c) => cmd.setPower(c, on));
  },
  /** Slider drag: throttled + coalesced; call with final=true on release. */
  setBright: (id: string, v: number, final = false) => {
    patchLamp(id, { bright: v });
    lampOf(id);
    coalescer.push(id + ':bright', () =>
      run(id, { bright: v }, async (c) => {
        await ensureOn(id, c);
        await cmd.setBright(c, v);
      }),
    );
    if (final) coalescer.flush(id + ':bright');
  },
  setCt: (id: string, k: number, final = false) => {
    patchLamp(id, { ct: k, mode: 'white' });
    coalescer.push(id + ':color', () =>
      run(id, { ct: k, mode: 'white' }, async (c) => {
        await ensureOn(id, c);
        await cmd.setCt(c, k);
      }),
    );
    if (final) coalescer.flush(id + ':color');
  },
  setHs: (id: string, hue: number, sat: number, final = false) => {
    const rgb = hsvRgb(hue, sat);
    patchLamp(id, { rgb, hue, sat: sat * 100, mode: 'color' });
    coalescer.push(id + ':color', () =>
      run(id, { rgb, mode: 'color' }, async (c) => {
        await ensureOn(id, c);
        await cmd.setRgb(c, rgb);
      }),
    );
    if (final) {
      coalescer.flush(id + ':color');
      addRecent(rgb);
    }
  },
  setRgb: (id: string, rgb: number) => {
    addRecent(rgb);
    return run(id, { rgb, mode: 'color' }, async (c) => {
      await ensureOn(id, c);
      await cmd.setRgb(c, rgb);
    });
  },
  /** Switch mode without a specific value: reuse the last known one. */
  setMode: (id: string, mode: 'color' | 'white') => {
    const s = getState().states[id] ?? offline();
    if (mode === 'white') {
      return run(id, { mode: 'white' }, async (c) => {
        await ensureOn(id, c);
        await cmd.setCt(c, s.ct);
      });
    }
    const rgb = s.rgb === 0xffffff || !s.rgb ? getState().recentColors[0] : s.rgb;
    return run(id, { mode: 'color', rgb }, async (c) => {
      await ensureOn(id, c);
      await cmd.setRgb(c, rgb);
    });
  },
  applyPreset: (id: string, p: Preset) => {
    if (p.mode === 'white')
      return run(id, { power: true, mode: 'white', ct: p.value!, bright: p.bright!, flowing: false }, (c) => cmd.sceneCt(c, p.value!, p.bright!));
    if (p.mode === 'color')
      return run(id, { power: true, mode: 'color', rgb: p.value!, bright: p.bright!, flowing: false }, (c) => cmd.sceneColor(c, p.value!, p.bright!));
    // Wake-up flow starts from the warmest white at 1 %, then ramps.
    return run(id, { power: true, mode: 'white', ct: WAKE_UP_CT, bright: 1, flowing: true }, async (c) => {
      await cmd.sceneCt(c, WAKE_UP_CT, 1);
      await cmd.startCf(c, 1, p.flowAction ?? 1, p.flow!);
    });
  },
  setTimer: (id: string, minutes: number) => {
    set((s) => ({ timerChoice: { ...s.timerChoice, [id]: minutes } }));
    if (minutes === 0) return run(id, { delayOffMin: 0 }, (c) => cmd.cronDel(c));
    return run(id, { delayOffMin: minutes }, async (c) => {
      await ensureOn(id, c);
      await cmd.cronAdd(c, minutes);
    });
  },
};

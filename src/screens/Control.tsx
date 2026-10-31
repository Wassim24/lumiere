import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Background } from '../ui/Background';
import { ActionSheet, Chip, Glass, Prompt, Snackbar, WifiBanner } from '../ui/kit';
import { Back, More, Power } from '../ui/Icons';
import { Slider } from '../ui/Slider';
import { ColorWheel } from '../ui/ColorWheel';
import { C, S } from '../ui/theme';
import {
  activePreset, allPresets, lampActions, refresh, removeLamp, saveCurrentAsPreset, updateLamp, useStore,
} from '../store/store';
import { hex, hsvRgb, rgbHs } from '../store/color';
import { lampDetail, lampHex, presetDot } from '../store/display';
import { t } from '../i18n';

const WHITES = [{ name: t.control.warm, k: 2700 }, { name: t.control.neutral, k: 4000 }, { name: t.control.cool, k: 6500 }];
const TIMERS = [15, 30, 60];

export function Control({ lampId, onBack, onManagePresets }: { lampId: string; onBack: () => void; onManagePresets: () => void }) {
  const insets = useSafeAreaInsets();
  const lamp = useStore((s) => s.lamps.find((l) => l.id === lampId));
  const st = useStore((s) => s.states[lampId]);
  const recents = useStore((s) => s.recentColors);
  const hidden = useStore((s) => s.hiddenPresets);
  useStore((s) => s.customPresets);
  const timerChoice = useStore((s) => s.timerChoice[lampId]);
  const [menu, setMenu] = useState(false);
  const [prompt, setPrompt] = useState<null | 'rename' | 'room' | 'preset'>(null);
  // Local wheel position while dragging (the bulb only reports rgb).
  const [wheel, setWheel] = useState<{ hue: number; sat: number } | null>(null);

  if (!lamp) return null;
  const online = !!st?.online;
  const on = online && !!st.power;
  const color = st ? lampHex(st) : '#FFFFFF';
  const isColor = st?.mode !== 'white';
  const hs = wheel ?? (st ? (st.mode === 'hsv' ? { hue: st.hue, sat: st.sat / 100 } : rgbHs(st.rgb)) : { hue: 0, sat: 0 });
  const active = activePreset(st);
  const dim = on ? 1 : 0.5;
  const presets = allPresets().filter((p) => !hidden.includes(p.id));
  const timerLeft = on ? st.delayOffMin : 0;

  return (
    <View style={{ flex: 1 }}>
      <Background
        orbs={[
          { x: 350, y: 180, r: 140, color: on ? color : C.bg, opacity: on ? 0.3 + (0.5 * st.bright) / 100 : 0 },
          { x: 20, y: 570, r: 140, color: C.lilac },
        ]}
      />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 24, paddingBottom: 40 + insets.bottom, gap: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: -10 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={t.common.back} onPress={onBack} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Back />
          </Pressable>
          <Text style={S.t14m}>{lamp.room ?? ''}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t.control.options} onPress={() => setMenu(true)} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
            <More />
          </Pressable>
        </View>

        <WifiBanner />

        <Glass style={{ flexDirection: 'row', alignItems: 'center', gap: 16, padding: 20 }}>
          <View
            style={{
              width: 56, height: 56, borderRadius: 28, backgroundColor: on ? color : 'transparent',
              borderWidth: on ? 1 : 1.5, borderStyle: on ? 'solid' : 'dashed', borderColor: on ? 'rgba(10,13,18,0.08)' : 'rgba(10,13,18,0.25)',
            }}
          />
          <View style={{ flex: 1, gap: 4 }}>
            <Text accessibilityRole="header" style={S.t24} numberOfLines={2}>{lamp.name}</Text>
            <Text style={S.t14m}>{online ? lampDetail(st) : t.common.offline}</Text>
          </View>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: on, disabled: !online }}
            accessibilityLabel={t.control.power}
            disabled={!online}
            onPress={() => lampActions.setPower(lampId, !on)}
            style={[
              { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
              on ? S.ink : { backgroundColor: C.bg },
              { opacity: online ? 1 : 0.4 },
            ]}
          >
            <Power color={on ? '#fff' : C.ink} />
          </Pressable>
        </Glass>

        {!online && (
          <Pressable onPress={() => refresh(lampId)} style={{ alignSelf: 'center', minHeight: 44, justifyContent: 'center' }}>
            <Text style={[S.t14, { color: C.link }]}>{t.control.reconnect}</Text>
          </Pressable>
        )}

        <View pointerEvents={online ? 'auto' : 'none'} style={{ gap: 16, opacity: online ? 1 : 0.5 }}>
          <View accessibilityRole="radiogroup" style={[S.glass, { flexDirection: 'row', gap: 4, padding: 4, borderRadius: 26, opacity: dim }]}>
            {(['color', 'white'] as const).map((m) => {
              const sel = m === 'color' ? isColor : !isColor;
              return (
                <Pressable
                  key={m}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: sel }}
                  onPress={() => !sel && lampActions.setMode(lampId, m)}
                  style={{ flex: 1, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: sel ? C.ink2 : 'transparent' }}
                >
                  <Text style={[S.t16, { color: sel ? '#fff' : C.muted }]}>{m === 'color' ? t.common.color : t.control.white}</Text>
                </Pressable>
              );
            })}
          </View>

          <Glass style={{ height: 204, padding: 24, opacity: dim, justifyContent: 'center' }}>
            {isColor ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 24 }}>
                <ColorWheel
                  size={156}
                  hue={hs.hue}
                  sat={hs.sat}
                  color={hex(hsvRgb(hs.hue, hs.sat))}
                  onChange={(h, s) => {
                    setWheel({ hue: h, sat: s });
                    lampActions.setHs(lampId, h, s);
                  }}
                  onComplete={(h, s) => {
                    lampActions.setHs(lampId, h, s, true);
                    setTimeout(() => setWheel(null), 1500);
                  }}
                />
                <View style={{ flex: 1, gap: 16 }}>
                  <Text style={S.t14m}>{t.control.recent}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {recents.map((c) => {
                      const sel = st?.mode === 'color' && st.rgb === c;
                      return (
                        <Pressable
                          key={c}
                          accessibilityRole="button"
                          accessibilityLabel={t.control.colorNamed(hex(c))}
                          accessibilityState={{ selected: sel }}
                          onPress={() => lampActions.setRgb(lampId, c)}
                          style={{
                            width: 40, height: 40, borderRadius: 20, backgroundColor: hex(c),
                            borderWidth: sel ? 2 : 1, borderColor: sel ? C.ink2 : 'rgba(10,13,18,0.08)',
                          }}
                        />
                      );
                    })}
                  </View>
                </View>
              </View>
            ) : (
              <View style={{ gap: 16 }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <Text style={S.t18}>{t.control.temperature}</Text>
                  <Text style={[S.t14m, { fontVariant: ['tabular-nums'] }]}>{st?.ct ?? 4000} K</Text>
                </View>
                <Slider
                  label={t.control.temperature}
                  min={1700}
                  max={6500}
                  step={100}
                  value={st?.ct ?? 4000}
                  colors={['#F2A35E', '#F6C892', '#F7EEE2', '#D5E3F7']}
                  onChange={(k) => lampActions.setCt(lampId, k)}
                  onComplete={(k) => lampActions.setCt(lampId, k, true)}
                />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {WHITES.map((w) => {
                    const sel = st?.ct === w.k;
                    return (
                      <Pressable
                        key={w.k}
                        accessibilityRole="button"
                        accessibilityState={{ selected: sel }}
                        onPress={() => lampActions.setCt(lampId, w.k, true)}
                        style={{ flex: 1, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: sel ? C.ink2 : C.bg }}
                      >
                        <Text style={[S.t14, { color: sel ? '#fff' : C.ink }]}>{w.name}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}
          </Glass>

          <Glass style={{ paddingTop: 20, paddingHorizontal: 24, paddingBottom: 24, gap: 12, opacity: dim }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <Text style={S.t18}>{t.control.brightness}</Text>
              <Text style={[S.t14m, { fontVariant: ['tabular-nums'] }]}>{t.pct(st?.bright ?? 0)}</Text>
            </View>
            <Slider
              label={t.control.brightness}
              min={1}
              max={100}
              value={st?.bright ?? 50}
              fill={color}
              onChange={(v) => lampActions.setBright(lampId, v)}
              onComplete={(v) => lampActions.setBright(lampId, v, true)}
            />
          </Glass>

          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text accessibilityRole="header" style={S.t20}>{t.common.presets}</Text>
              <Pressable accessibilityRole="link" onPress={onManagePresets} style={{ paddingVertical: 12 }}>
                <Text style={[S.t14, { color: C.link }]}>{t.control.manage}</Text>
              </Pressable>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -24 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 24 }}>
              {presets.map((p) => (
                <Chip key={p.id} label={p.name} dot={presetDot(p)} selected={active?.id === p.id} onPress={() => lampActions.applyPreset(lampId, p)} />
              ))}
            </ScrollView>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={[S.t16, { flex: 1 }]}>{timerLeft ? t.control.timerLeft(timerLeft) : t.control.timer}</Text>
            {TIMERS.map((m) => {
              const sel = !!timerLeft && timerChoice === m;
              return (
                <Chip key={m} label={t.minutes(m)} selected={sel} style={{ minWidth: 68 }} onPress={() => lampActions.setTimer(lampId, sel ? 0 : m)} />
              );
            })}
          </View>
        </View>
      </ScrollView>
      <Snackbar />

      <ActionSheet
        visible={menu}
        title={lamp.name}
        onClose={() => setMenu(false)}
        actions={[
          { label: t.control.saveAsPreset, onPress: () => setPrompt('preset') },
          { label: t.control.rename, onPress: () => setPrompt('rename') },
          { label: lamp.room ? t.control.roomIs(lamp.room) : t.control.chooseRoom, onPress: () => setPrompt('room') },
          { label: t.control.deleteLamp, destructive: true, onPress: () => { removeLamp(lampId); onBack(); } },
        ]}
      />
      <Prompt
        visible={prompt !== null}
        title={prompt === 'rename' ? t.control.renameLamp : prompt === 'room' ? t.control.room : t.control.newPreset}
        initial={prompt === 'rename' ? lamp.name : prompt === 'room' ? lamp.room ?? '' : ''}
        placeholder={prompt === 'room' ? t.control.roomPlaceholder : prompt === 'preset' ? t.control.presetPlaceholder : ''}
        onClose={() => setPrompt(null)}
        onSubmit={(v) => {
          if (prompt === 'rename') updateLamp(lampId, { name: v });
          else if (prompt === 'room') updateLamp(lampId, { room: v });
          else saveCurrentAsPreset(lampId, v);
          setPrompt(null);
        }}
      />
    </View>
  );
}

import { useState } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Background } from '../ui/Background';
import { ActionSheet, Chip, Prompt, WifiBanner } from '../ui/kit';
import { Plus } from '../ui/Icons';
import { C, S } from '../ui/theme';
import {
  activePreset, deletePreset, lampActions, renamePreset, saveCurrentAsPreset, setCurrentLamp, toggleHiddenPreset, useStore,
} from '../store/store';
import { BUILTIN_PRESETS, type Preset } from '../store/presets';
import { presetDot, presetMeta } from '../store/display';
import { t } from '../i18n';

export function Presets() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cardW = Math.floor((width - 48 - 16) / 3);
  const lamps = useStore((s) => s.lamps);
  const states = useStore((s) => s.states);
  const custom = useStore((s) => s.customPresets);
  const hidden = useStore((s) => s.hiddenPresets);
  const currentId = useStore((s) => s.currentLampId);
  const [menu, setMenu] = useState<Preset | null>(null);
  const [prompt, setPrompt] = useState<null | { kind: 'new' } | { kind: 'rename'; p: Preset }>(null);

  const lamp = lamps.find((l) => l.id === currentId) ?? lamps[0];
  const st = lamp ? states[lamp.id] : undefined;
  const active = activePreset(st);

  const Card = ({ p }: { p: Preset }) => {
    const sel = active?.id === p.id;
    const isHidden = hidden.includes(p.id);
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: sel }}
        accessibilityHint={t.presets.longPressHint}
        onPress={() => lamp && lampActions.applyPreset(lamp.id, p)}
        onLongPress={() => setMenu(p)}
        style={({ pressed }) => [
          { width: cardW, height: 112, padding: 14, borderRadius: 24, justifyContent: 'space-between', opacity: pressed ? 0.8 : isHidden ? 0.45 : 1 },
          sel ? { backgroundColor: C.ink2 } : S.glass,
        ]}
      >
        <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: presetDot(p), borderWidth: sel ? 0 : 1, borderColor: 'rgba(10,13,18,0.08)' }} />
        <View style={{ gap: 4 }}>
          <Text style={[S.t14, { color: sel ? '#fff' : C.ink, lineHeight: 16 }]} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8} textBreakStrategy="simple">{p.name}</Text>
          <Text style={[S.t12, { color: sel ? '#C9CDD4' : C.muted }]}>{isHidden ? t.presets.hidden : presetMeta(p)}</Text>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1 }}>
      <Background orbs={[{ x: 355, y: 255, r: 145, color: C.lilac }, { x: 30, y: 620, r: 150, color: C.mint }]} />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 32, paddingHorizontal: 24, paddingBottom: 140 + insets.bottom, gap: 24 }}>
        <View style={{ gap: 8 }}>
          <Text style={S.t14m}>{lamp ? lamp.name : t.presets.noLamp}</Text>
          <Text accessibilityRole="header" style={S.t32}>{t.common.presets}</Text>
        </View>

        <WifiBanner />

        {lamps.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -24 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 24 }}>
            {lamps.map((l) => (
              <Chip key={l.id} label={l.name} selected={l.id === lamp?.id} onPress={() => setCurrentLamp(l.id)} style={{ height: 40 }} />
            ))}
          </ScrollView>
        )}

        <View style={{ gap: 8 }}>
          <Text accessibilityRole="header" style={S.t14m}>{t.presets.builtIn}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {BUILTIN_PRESETS.map((p) => <Card key={p.id} p={p} />)}
          </View>
        </View>

        <View style={{ gap: 8 }}>
          <Text accessibilityRole="header" style={S.t14m}>{t.presets.mine}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {custom.map((p) => <Card key={p.id} p={p} />)}
            <Pressable
              accessibilityRole="button"
              disabled={!st?.online}
              onPress={() => setPrompt({ kind: 'new' })}
              style={{
                width: cardW * 2 + 8, height: 112, paddingHorizontal: 20, borderRadius: 24, flexDirection: 'row', alignItems: 'center', gap: 16,
                backgroundColor: C.info, borderWidth: 1, borderColor: 'rgba(255,255,255,0.7)', opacity: st?.online ? 1 : 0.5,
              }}
            >
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.ink2, alignItems: 'center', justifyContent: 'center' }}>
                <Plus size={18} />
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[S.t16, { lineHeight: 19 }]}>{t.presets.saveCurrent}</Text>
                <Text style={S.t12}>{t.presets.saveCurrentSub}</Text>
              </View>
            </Pressable>
          </View>
        </View>
      </ScrollView>

      <ActionSheet
        visible={!!menu}
        title={menu?.name}
        onClose={() => setMenu(null)}
        actions={
          !menu
            ? []
            : menu.builtIn
              ? [{ label: hidden.includes(menu.id) ? t.presets.showShortcut : t.presets.hideShortcut, onPress: () => toggleHiddenPreset(menu.id) }]
              : [
                  { label: t.control.rename, onPress: () => setPrompt({ kind: 'rename', p: menu }) },
                  { label: t.presets.delete, destructive: true, onPress: () => deletePreset(menu.id) },
                ]
        }
      />
      <Prompt
        visible={!!prompt}
        title={prompt?.kind === 'rename' ? t.presets.rename : t.control.newPreset}
        initial={prompt?.kind === 'rename' ? prompt.p.name : ''}
        placeholder={t.control.presetPlaceholder}
        onClose={() => setPrompt(null)}
        onSubmit={(v) => {
          if (prompt?.kind === 'rename') renamePreset(prompt.p.id, v);
          else if (lamp) saveCurrentAsPreset(lamp.id, v);
          setPrompt(null);
        }}
      />
    </View>
  );
}

import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Background } from '../ui/Background';
import { Chip, Glass, Prompt, WifiBanner } from '../ui/kit';
import { Plus, Power } from '../ui/Icons';
import { C, S } from '../ui/theme';
import { addLamp, lampActions, runDiscovery, setCurrentLamp, useStore, type Candidate } from '../store/store';
import { BUILTIN_PRESETS } from '../store/presets';
import { lampHex, lampStatus, presetDot } from '../store/display';
import { t } from '../i18n';

export function Home({ onOpenLamp, onAdd, onAllPresets }: { onOpenLamp: (id: string) => void; onAdd: () => void; onAllPresets: () => void }) {
  const insets = useSafeAreaInsets();
  const lamps = useStore((s) => s.lamps);
  const states = useStore((s) => s.states);
  const candidates = useStore((s) => s.candidates);
  const searching = useStore((s) => s.searching);
  const hidden = useStore((s) => s.hiddenPresets);
  const custom = useStore((s) => s.customPresets);
  const currentId = useStore((s) => s.currentLampId);
  const [room, setRoom] = useState<string | null>(null);
  const [adding, setAdding] = useState<Candidate | null>(null);

  const rooms = [...new Set(lamps.map((l) => l.room).filter(Boolean))] as string[];
  const shown = lamps.filter((l) => !room || l.room === room);
  const onCount = lamps.filter((l) => states[l.id]?.online && states[l.id]?.power).length;
  const target = lamps.find((l) => l.id === currentId) ?? lamps.find((l) => states[l.id]?.online) ?? lamps[0];
  const quick = [...BUILTIN_PRESETS, ...custom].filter((p) => !hidden.includes(p.id) && p.mode !== 'flow');

  return (
    <View style={{ flex: 1 }}>
      <Background orbs={[{ x: 360, y: 300, r: 150, color: C.lilac }, { x: 20, y: 610, r: 130, color: C.peach }]} />
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 32, paddingHorizontal: 24, paddingBottom: 140 + insets.bottom, gap: 24 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={runDiscovery} />}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <View style={{ gap: 8 }}>
            <Text style={S.t14m}>
              {onCount === 0 ? t.home.allOff : t.home.lampsOn(onCount)}
            </Text>
            <Text accessibilityRole="header" style={S.t32}>{t.home.title}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.common.addLamp}
            onPress={onAdd}
            style={[S.ink, { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' }]}
          >
            <Plus />
          </Pressable>
        </View>

        <WifiBanner />

        {rooms.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ marginHorizontal: -24 }} contentInset={{ left: 24 }}>
            <View style={{ width: 16 }} />
            <Chip label={t.home.allRooms} selected={!room} onPress={() => setRoom(null)} style={{ height: 40 }} />
            {rooms.map((r) => (
              <Chip key={r} label={r} selected={room === r} onPress={() => setRoom(r)} style={{ height: 40 }} />
            ))}
            <View style={{ width: 16 }} />
          </ScrollView>
        )}

        <View style={{ gap: 8 }}>
          {shown.map((l) => {
            const st = states[l.id];
            if (!st?.online)
              return (
                <Pressable key={l.id} onPress={() => onOpenLamp(l.id)}>
                  <Glass style={{ flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16, backgroundColor: C.glassDim }}>
                    <View style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(10,13,18,0.25)' }} />
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={[S.t18, { color: C.muted }]}>{l.name}</Text>
                      <Text style={S.t14m}>{lampStatus(l, st)}</Text>
                    </View>
                  </Glass>
                </Pressable>
              );
            return (
              <Pressable key={l.id} accessibilityRole="link" onPress={() => onOpenLamp(l.id)} style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}>
                <Glass style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 16, paddingLeft: 16, paddingRight: 12 }}>
                  <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: st.power ? lampHex(st) : C.bg, borderWidth: 1, borderColor: 'rgba(10,13,18,0.08)' }} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={S.t18} numberOfLines={1}>{l.name}</Text>
                    <Text style={S.t14m} numberOfLines={1}>{lampStatus(l, st)}</Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={st.power ? t.home.turnOff(l.name) : t.home.turnOn(l.name)}
                    onPress={() => lampActions.setPower(l.id, !st.power)}
                    style={[
                      { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
                      st.power ? S.ink : { backgroundColor: 'rgba(255,255,255,0.6)', borderWidth: 1, borderColor: 'rgba(10,13,18,0.12)' },
                    ]}
                  >
                    <Power size={20} color={st.power ? '#fff' : C.ink} />
                  </Pressable>
                </Glass>
              </Pressable>
            );
          })}

          {candidates.map((c) => (
            <Glass key={c.did} style={{ flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16, paddingRight: 12, backgroundColor: C.info }}>
              <View style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: C.link, alignItems: 'center', justifyContent: 'center' }}>
                <Plus size={18} color={C.link} />
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={S.t18}>{t.home.found}</Text>
                <Text style={S.t14m}>{c.lanEnabled ? c.ip : t.home.lanDisabled}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => (c.lanEnabled ? setAdding(c) : onAdd())}
                style={[S.ink, { height: 44, paddingHorizontal: 16, borderRadius: 22, justifyContent: 'center' }]}
              >
                <Text style={[S.t14, { color: '#fff' }]}>{c.lanEnabled ? t.common.add : t.home.setUp}</Text>
              </Pressable>
            </Glass>
          ))}

          {searching && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, height: 44 }}>
              <ActivityIndicator color={C.ink2} size="small" />
              <Text style={S.t14m}>{t.home.searching}</Text>
            </View>
          )}

          {!searching && lamps.length === 0 && candidates.length === 0 && (
            <Glass style={{ padding: 24, gap: 8 }}>
              <Text style={S.t18}>{t.home.emptyTitle}</Text>
              <Text style={S.t14m}>{t.home.emptyText}</Text>
            </Glass>
          )}
        </View>

        {target && (
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text accessibilityRole="header" style={S.t20}>{t.common.presets}</Text>
              <Pressable accessibilityRole="link" onPress={onAllPresets} style={{ paddingVertical: 12 }}>
                <Text style={[S.t14, { color: C.link }]}>{t.home.seeAll}</Text>
              </Pressable>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -24 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 24 }}>
              {quick.map((p) => (
                <Chip
                  key={p.id}
                  label={p.name}
                  dot={presetDot(p)}
                  onPress={() => {
                    setCurrentLamp(target.id);
                    lampActions.applyPreset(target.id, p);
                  }}
                />
              ))}
            </ScrollView>
          </View>
        )}
      </ScrollView>

      <Prompt
        visible={!!adding}
        title={t.common.nameLamp}
        placeholder={t.common.lampPlaceholder}
        confirm={t.common.add}
        onClose={() => setAdding(null)}
        onSubmit={(name) => {
          const c = adding!;
          setAdding(null);
          const l = addLamp({ name, did: c.did, ip: c.ip, model: c.model });
          onOpenLamp(l.id);
        }}
      />
    </View>
  );
}

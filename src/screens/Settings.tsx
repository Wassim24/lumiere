import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Background } from '../ui/Background';
import { Glass, Prompt, WifiBanner } from '../ui/kit';
import { Chevron, Refresh } from '../ui/Icons';
import { C, S } from '../ui/theme';
import { addLamp, runDiscovery, showSnack, useStore } from '../store/store';
import { probeIp } from '../net/discover';
import { t } from '../i18n';

export function Settings({ onOpenLamp, onAdd }: { onOpenLamp: (id: string) => void; onAdd: () => void }) {
  const insets = useSafeAreaInsets();
  const lamps = useStore((s) => s.lamps);
  const states = useStore((s) => s.states);
  const wifi = useStore((s) => s.wifi);
  const searching = useStore((s) => s.searching);
  const [ipPrompt, setIpPrompt] = useState(false);
  const [found, setFound] = useState<{ ip: string; did: number } | null>(null);
  const [probing, setProbing] = useState(false);

  const probe = async (ip: string) => {
    setIpPrompt(false);
    setProbing(true);
    const r = await probeIp(ip);
    setProbing(false);
    if (r) setFound({ ip, did: r.did });
    else showSnack(t.settings.noLampAt(ip), () => probe(ip));
  };

  const Row = ({ title, sub, onPress, right }: { title: string; sub?: string; onPress?: () => void; right?: React.ReactNode }) => (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: 64, paddingHorizontal: 16, borderRadius: 24, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: pressed ? 'rgba(255,255,255,0.7)' : 'transparent' })}
    >
      <View style={{ flex: 1, gap: 2, paddingVertical: 10 }}>
        <Text style={S.t16}>{title}</Text>
        {sub && <Text style={S.t14m}>{sub}</Text>}
      </View>
      {right ?? (onPress ? <Chevron /> : null)}
    </Pressable>
  );

  return (
    <View style={{ flex: 1 }}>
      <Background orbs={[{ x: 360, y: 200, r: 130, color: C.lilac }, { x: 10, y: 640, r: 140, color: C.peach }]} />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 32, paddingHorizontal: 24, paddingBottom: 140 + insets.bottom, gap: 24 }}>
        <View style={{ gap: 8 }}>
          <Text style={S.t14m}>Lumière</Text>
          <Text accessibilityRole="header" style={S.t32}>{t.settings.title}</Text>
        </View>
        <WifiBanner />

        <View style={{ gap: 8 }}>
          <Text accessibilityRole="header" style={S.t14m}>{t.settings.lamps}</Text>
          <Glass style={{ padding: 8 }}>
            {lamps.map((l) => (
              <Row
                key={l.id}
                title={l.name}
                sub={[l.room, l.ip, states[l.id]?.online ? t.settings.online : t.settings.offline].filter(Boolean).join(' · ')}
                onPress={() => onOpenLamp(l.id)}
              />
            ))}
            <Row title={t.common.addLamp} sub={t.settings.pairSub} onPress={onAdd} />
            <Row
              title={t.settings.addByIp}
              sub={t.settings.addByIpSub}
              onPress={() => setIpPrompt(true)}
              right={probing ? <ActivityIndicator color={C.ink2} /> : undefined}
            />
            <Row
              title={t.common.networkSearch}
              sub={t.settings.networkSearchSub}
              onPress={runDiscovery}
              right={searching ? <ActivityIndicator color={C.ink2} /> : <Refresh />}
            />
          </Glass>
        </View>

        <View style={{ gap: 8 }}>
          <Text accessibilityRole="header" style={S.t14m}>{t.settings.network}</Text>
          <Glass style={{ padding: 8 }}>
            <Row title="Wi‑Fi" sub={wifi?.isWifi ? `${wifi.ssid ?? t.settings.wifiNetwork} · ${wifi.ip ?? ''}` : t.settings.notConnected} />
          </Glass>
        </View>

        <View style={{ gap: 8 }}>
          <Text accessibilityRole="header" style={S.t14m}>{t.settings.about}</Text>
          <Glass style={{ padding: 24, gap: 8 }}>
            <Text style={S.t16}>Lumière 1.0</Text>
            <Text style={S.t14m}>
              {t.settings.aboutText}
            </Text>
          </Glass>
        </View>
      </ScrollView>
      <Prompt
        visible={ipPrompt}
        title={t.settings.lampIp}
        placeholder="192.168.1.20"
        confirm={t.settings.search}
        onClose={() => setIpPrompt(false)}
        onSubmit={probe}
      />
      <Prompt
        visible={!!found}
        title={t.common.nameLamp}
        placeholder={t.common.lampPlaceholder}
        confirm={t.common.add}
        onClose={() => setFound(null)}
        onSubmit={(name) => {
          const f = found!;
          setFound(null);
          const l = addLamp({ name, did: f.did, ip: f.ip });
          onOpenLamp(l.id);
        }}
      />
    </View>
  );
}

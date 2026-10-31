import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, PermissionsAndroid, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { Background } from '../ui/Background';
import { Glass, PrimaryButton, Progress, TextButton } from '../ui/kit';
import { Check, Close, Eye } from '../ui/Icons';
import { C, F, S } from '../ui/theme';
import { Yeenet } from '../net/native';
import type { WifiNetwork } from '../../modules/yeenet';
import { pair, PairingError, type PairingErrorCode, type PairingResult, type PairingStep } from '../net/pairing';
import { addLamp, runDiscovery, setCurrentLamp, useStore } from '../store/store';
import { t } from '../i18n';

type Phase = 'reset' | 'existing' | 'wifi' | 'progress' | 'error' | 'name';

const ORDER: PairingStep[] = ['hotspot', 'hello', 'lan', 'wifi', 'return', 'search'];
// `until`: the last pairing step shown under this line.
const STEPS: { until: PairingStep; label: string; active?: string }[] = [
  { until: 'hello', label: t.pairing.stepFound, active: t.pairing.stepSearching },
  { until: 'wifi', label: t.pairing.stepSending },
  { until: 'search', label: t.pairing.stepChecking },
];

type Network = { ssid: string; ok: boolean };

/** One entry per SSID, usable (2.4 GHz) first, strongest first, without the bulbs' own hotspots. */
function listNetworks(scan: WifiNetwork[]): Network[] {
  const best = new Map<string, { ok: boolean; level: number }>();
  for (const n of scan) {
    if (n.ssid.startsWith('yeelink-light-')) continue;
    const seen = best.get(n.ssid);
    best.set(n.ssid, { ok: !!seen?.ok || n.frequency < 3000, level: Math.max(seen?.level ?? -999, n.level) });
  }
  return [...best]
    .sort(([, a], [, b]) => Number(b.ok) - Number(a.ok) || b.level - a.level)
    .slice(0, 6)
    .map(([ssid, { ok }]) => ({ ssid, ok }));
}

const BACK: Partial<Record<PairingErrorCode, Phase>> = { NotFoundAfterJoin: 'wifi' };

async function askWifiPermission() {
  if (Platform.OS !== 'android') return;
  const perms: any[] = [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  if (Number(Platform.Version) >= 33) perms.push('android.permission.NEARBY_WIFI_DEVICES');
  try {
    await PermissionsAndroid.requestMultiple(perms);
  } catch {}
}

export function Pairing({ onClose, onDone }: { onClose: () => void; onDone: (lampId: string) => void }) {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>('reset');
  const [ssid, setSsid] = useState('');
  const [freq, setFreq] = useState<number | null>(null);
  const [nets, setNets] = useState<Network[] | null>(null); // null while scanning
  const [otherNet, setOtherNet] = useState(false);
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [step, setStep] = useState<PairingStep>('hotspot');
  const [error, setError] = useState<PairingErrorCode>('Cancelled');
  const [result, setResult] = useState<PairingResult | null>(null);
  const [name, setName] = useState('');
  const [room, setRoom] = useState('');
  const cancelled = useRef(false);
  const lamps = useStore((s) => s.lamps);
  const rooms = [...new Set(lamps.map((l) => l.room).filter(Boolean))] as string[];

  const loadWifi = async () => {
    await askWifiPermission();
    const w = Yeenet.getWifiInfo();
    const current = ssid || w.ssid || '';
    setSsid(current);
    setFreq(w.frequency);
    setNets(null);
    const list = listNetworks(await Yeenet.scanWifi(3000).catch(() => []));
    setNets(list);
    if (list.length > 0 && !otherNet && !list.some((n) => n.ok && n.ssid === current)) setSsid(list.find((n) => n.ok)?.ssid ?? '');
  };

  useEffect(() => {
    if (phase === 'wifi') loadWifi();
  }, [phase]);

  useEffect(() => () => {
    cancelled.current = true;
  }, []);

  const start = async () => {
    cancelled.current = false;
    setStep('hotspot');
    setPhase('progress');
    try {
      const r = await pair({ ssid: ssid.trim(), password, onStep: setStep, cancelled: () => cancelled.current });
      setPassword('');
      setResult(r);
      setName('');
      setPhase('name');
    } catch (e) {
      if (cancelled.current) return;
      setError(e instanceof PairingError ? e.code : 'NoHelloReply');
      setPhase('error');
    }
  };

  const stepNo = { reset: 1, existing: 1, wifi: 2, progress: 3, error: 3, name: 4 }[phase];
  const idx = ORDER.indexOf(step);
  const typing = otherNet || nets?.length === 0;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <Background
        orbs={
          phase === 'progress' || phase === 'name'
            ? [{ x: 195, y: 250, r: 120, color: '#FFB46B', opacity: 0.55 }, { x: 360, y: 670, r: 150, color: C.lilac }]
            : [{ x: 360, y: 410, r: 150, color: C.lilac }, { x: 30, y: 620, r: 120, color: C.peach }]
        }
      />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 16, paddingHorizontal: 24, paddingBottom: 32 + insets.bottom, gap: 24 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, height: 44 }}>
          {phase !== 'progress' ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t.common.close} onPress={onClose} style={{ width: 44, height: 44, marginLeft: -10, alignItems: 'center', justifyContent: 'center' }}>
              <Close />
            </Pressable>
          ) : <View style={{ width: 34 }} />}
          <Progress step={stepNo} total={4} />
          <Text style={[S.t14m, { fontVariant: ['tabular-nums'] }]}>{stepNo}/4</Text>
        </View>

        {phase === 'reset' && (
          <>
            <View style={{ gap: 8 }}>
              <Text accessibilityRole="header" style={S.t32}>{t.pairing.resetTitle}</Text>
              <Text style={[S.t16, { color: C.muted, lineHeight: 22 }]}>{t.pairing.resetIntro}</Text>
            </View>
            <Glass style={{ padding: 24, gap: 16 }}>
              {t.pairing.resetSteps.map((text, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 16 }}>
                  <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: C.ink2, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={[S.t14, { color: '#fff' }]}>{i + 1}</Text>
                  </View>
                  <Text style={[S.t16, { flex: 1, lineHeight: 22 }]}>{text}</Text>
                </View>
              ))}
            </Glass>
            <View style={{ marginTop: 'auto', gap: 4 }}>
              <PrimaryButton label={t.pairing.ready} onPress={() => setPhase('wifi')} />
              <TextButton label={t.pairing.alreadySetUp} onPress={() => setPhase('existing')} />
            </View>
          </>
        )}

        {phase === 'existing' && (
          <>
            <View style={{ gap: 8 }}>
              <Text accessibilityRole="header" style={S.t32}>{t.pairing.existingTitle}</Text>
              <Text style={[S.t16, { color: C.muted, lineHeight: 22 }]}>
                {t.pairing.existingText}
              </Text>
            </View>
            <View style={{ marginTop: 'auto', gap: 4 }}>
              <PrimaryButton label={t.common.networkSearch} onPress={() => { runDiscovery(); onClose(); }} />
              <TextButton label={t.pairing.resetInstead} onPress={() => setPhase('reset')} />
            </View>
          </>
        )}

        {phase === 'wifi' && (
          <>
            <View style={{ gap: 8, paddingTop: 24 }}>
              <Text accessibilityRole="header" style={S.t32}>{t.pairing.wifiTitle}</Text>
              <Text style={[S.t16, { color: C.muted, lineHeight: 22 }]}>{t.pairing.wifiIntro}</Text>
            </View>
            {typing ? (
              <View style={{ gap: 8, marginTop: 8 }}>
                <Text nativeID="ssidLabel" style={S.t14m}>{t.pairing.networkName}</Text>
                <TextInput
                  accessibilityLabelledBy="ssidLabel"
                  value={ssid}
                  onChangeText={setSsid}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder={t.pairing.networkPlaceholder}
                  placeholderTextColor={C.muted2}
                  style={inputStyle}
                />
                {freq != null && freq > 4900 && (
                  <View style={{ borderRadius: 16, padding: 12, backgroundColor: C.warn }}>
                    <Text style={[S.t14, { lineHeight: 20 }]}>
                      {t.pairing.phoneOn5GHz}
                    </Text>
                  </View>
                )}
              </View>
            ) : (
              <Glass style={{ marginTop: 8, padding: 8, gap: 4 }}>
                <View accessibilityRole="radiogroup" accessibilityLabel={t.pairing.networks} style={{ gap: 4 }}>
                  {nets === null && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 64, paddingHorizontal: 20 }}>
                      <ActivityIndicator size="small" color={C.ink2} />
                      <Text style={S.t14m}>{t.pairing.searchingNetworks}</Text>
                    </View>
                  )}
                  {nets?.map((n) => {
                    const sel = n.ok && n.ssid === ssid;
                    return (
                      <Pressable
                        key={n.ssid}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: sel, disabled: !n.ok }}
                        disabled={!n.ok}
                        onPress={() => setSsid(n.ssid)}
                        style={{
                          flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 64, paddingHorizontal: 20, borderRadius: 24,
                          backgroundColor: sel ? 'rgba(255,255,255,0.7)' : 'transparent',
                        }}
                      >
                        <Text style={[S.t16, { flex: 1, color: n.ok ? C.ink : C.muted }]} numberOfLines={1}>{n.ssid}</Text>
                        {n.ok ? (
                          <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: sel ? 2 : 1.5, borderColor: sel ? C.ink2 : 'rgba(10,13,18,0.25)' }}>
                            {sel && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.ink2 }} />}
                          </View>
                        ) : (
                          <View style={{ height: 24, paddingHorizontal: 10, borderRadius: 12, justifyContent: 'center', backgroundColor: C.peach }}>
                            <Text style={[S.t12, { color: C.ink }]}>5 GHz</Text>
                          </View>
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              </Glass>
            )}
            <View style={{ gap: 8, marginTop: 8 }}>
              <Text nativeID="pwLabel" style={S.t14m}>{t.pairing.password}</Text>
              <View>
                <TextInput
                  accessibilityLabelledBy="pwLabel"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPw}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="password"
                  style={[inputStyle, { paddingRight: 56 }]}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={showPw ? t.pairing.hidePassword : t.pairing.showPassword}
                  onPress={() => setShowPw(!showPw)}
                  style={{ position: 'absolute', right: 6, top: 6, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Eye />
                </Pressable>
              </View>
            </View>
            <View style={{ marginTop: 'auto', gap: 8 }}>
              <PrimaryButton label={t.pairing.continue} disabled={!ssid.trim() || nets === null} onPress={start} />
              {!!nets?.length && <TextButton label={otherNet ? t.pairing.detectedNetworks : t.pairing.otherNetwork} onPress={() => setOtherNet(!otherNet)} />}
            </View>
          </>
        )}

        {phase === 'progress' && (
          <>
            <View style={{ alignItems: 'center', paddingTop: 48 }}>
              <View style={[S.glass, { width: 176, height: 176, borderRadius: 88, alignItems: 'center', justifyContent: 'center' }]}>
                <Svg width={176} height={176} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
                  <Circle cx={88} cy={88} r={84} fill="none" stroke="rgba(10,13,18,0.08)" strokeWidth={3} />
                  <Circle
                    cx={88} cy={88} r={84} fill="none" stroke={C.link} strokeWidth={3} strokeLinecap="round"
                    strokeDasharray="528" strokeDashoffset={528 - (528 * (idx + 0.5)) / ORDER.length}
                  />
                </Svg>
                <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: '#FFB46B' }} />
              </View>
            </View>
            <View style={{ alignItems: 'center', gap: 8, paddingTop: 16 }}>
              <Text accessibilityRole="header" style={[S.t32, { textAlign: 'center' }]}>{t.pairing.connecting}</Text>
              <Text style={[S.t16, { color: C.muted, textAlign: 'center', lineHeight: 22 }]}>{t.pairing.aboutOneMinute}</Text>
            </View>
            <Glass style={{ marginTop: 16, paddingVertical: 8, paddingHorizontal: 24 }}>
              {STEPS.map((s, n) => {
                const from = n === 0 ? 0 : ORDER.indexOf(STEPS[n - 1].until) + 1;
                const until = ORDER.indexOf(s.until);
                const done = idx > until;
                const cur = idx >= from && idx <= until;
                return (
                  <View key={s.until} style={{ flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 56 }}>
                    {done ? <Check /> : cur ? <ActivityIndicator size={18} color={C.ink2} style={{ width: 20 }} /> : (
                      <View style={{ width: 20, alignItems: 'center' }}><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.muted2 }} /></View>
                    )}
                    <Text style={[S.t16, { color: cur ? C.ink : done ? C.muted : C.muted2, flex: 1 }]}>{cur && s.active ? s.active : s.label}</Text>
                  </View>
                );
              })}
            </Glass>
            <Text style={[S.t14m, { textAlign: 'center', lineHeight: 20 }]}>{t.pairing.blinksWhenReady}</Text>
            <View style={{ marginTop: 'auto', alignItems: 'center' }}>
              <TextButton
                label={t.common.cancel}
                color={C.ink}
                onPress={() => {
                  cancelled.current = true;
                  Yeenet.releaseHotspot();
                  setPhase('wifi');
                }}
              />
            </View>
          </>
        )}

        {phase === 'error' && (
          <>
            <View style={{ gap: 8 }}>
              <Text accessibilityRole="header" style={S.t32}>{t.pairing.errors[error].title}</Text>
              <Text style={[S.t16, { color: C.muted, lineHeight: 22 }]}>{t.pairing.errors[error].text}</Text>
            </View>
            <View style={{ marginTop: 'auto', gap: 4 }}>
              <PrimaryButton label={t.pairing.restart} onPress={() => setPhase(BACK[error] ?? 'reset')} />
              <TextButton label={t.common.close} color={C.ink} onPress={onClose} />
            </View>
          </>
        )}

        {phase === 'name' && result && (
          <>
            <View style={{ gap: 8 }}>
              <Text accessibilityRole="header" style={S.t32}>{t.pairing.connectedTitle}</Text>
              <Text style={[S.t16, { color: C.muted, lineHeight: 22 }]}>{t.pairing.connectedText(result.ip)}</Text>
            </View>
            <View style={{ gap: 8 }}>
              <Text nativeID="nameLabel" style={S.t14}>{t.pairing.name}</Text>
              <TextInput accessibilityLabelledBy="nameLabel" value={name} onChangeText={setName} placeholder={t.common.lampPlaceholder} placeholderTextColor={C.muted2} style={inputStyle} />
            </View>
            <View style={{ gap: 8 }}>
              <Text nativeID="roomLabel" style={S.t14}>{t.pairing.roomOptional}</Text>
              <TextInput accessibilityLabelledBy="roomLabel" value={room} onChangeText={setRoom} placeholder={t.pairing.roomPlaceholder} placeholderTextColor={C.muted2} style={inputStyle} />
              {rooms.length > 0 && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {rooms.map((r) => (
                    <Pressable key={r} onPress={() => setRoom(r)} style={[S.glass, { height: 40, paddingHorizontal: 16, borderRadius: 20, justifyContent: 'center' }]}>
                      <Text style={S.t14}>{r}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
            <View style={{ marginTop: 'auto' }}>
              <PrimaryButton
                label={t.pairing.finish}
                disabled={!name.trim()}
                onPress={() => {
                  const l = addLamp({ name: name.trim(), room: room.trim() || undefined, did: result.did, ip: result.ip, model: result.model, mac: result.mac });
                  setCurrentLamp(l.id);
                  onDone(l.id);
                }}
              />
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const inputStyle = {
  height: 56, borderRadius: 16, paddingHorizontal: 20, fontFamily: F.medium, fontSize: 16, color: C.ink,
  backgroundColor: C.glass, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.75)',
} as const;

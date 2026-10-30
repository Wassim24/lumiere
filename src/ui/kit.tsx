import { useEffect, useState, type ComponentRef, type ReactNode, type RefObject } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, F, S } from './theme';
import { Bulb, Sliders, Sparkle } from './Icons';
import { dismissSnack, offHomeWifi, useStore } from '../store/store';
import { t } from '../i18n';

export function Glass({ style, children, radius = 32 }: { style?: StyleProp<ViewStyle>; children?: ReactNode; radius?: number }) {
  return <View style={[S.glass, { borderRadius: radius }, style]}>{children}</View>;
}

export function Chip({ label, dot, selected, onPress, onLongPress, style }: {
  label: string; dot?: string; selected?: boolean; onPress: () => void; onLongPress?: () => void; style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        {
          height: 44, paddingLeft: dot ? 12 : 16, paddingRight: 16, borderRadius: 22, flexDirection: 'row', alignItems: 'center',
          justifyContent: 'center', gap: 8, opacity: pressed ? 0.75 : 1,
        },
        selected ? { backgroundColor: C.ink2 } : S.glass,
        style,
      ]}
    >
      {dot && <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: dot, borderWidth: 1, borderColor: 'rgba(10,13,18,0.1)' }} />}
      <Text style={[S.t14, { color: selected ? '#fff' : C.ink }]}>{label}</Text>
    </Pressable>
  );
}

export function PrimaryButton({ label, onPress, disabled, style }: { label: string; onPress: () => void; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [S.ink, { height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : pressed ? 0.85 : 1 }, style]}
    >
      <Text style={[S.t16, { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

export function TextButton({ label, onPress, color = C.link }: { label: string; onPress: () => void; color?: string }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={{ minHeight: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={[S.t14, { color }]}>{label}</Text>
    </Pressable>
  );
}

export function Progress({ step, total }: { step: number; total: number }) {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={t.pairing.step(step, total)} style={{ flex: 1, flexDirection: 'row', gap: 4 }}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i < step ? C.ink2 : 'rgba(10,13,18,0.1)' }} />
      ))}
    </View>
  );
}

export type Tab = 'home' | 'presets' | 'settings';

export function BottomNav({ tab, onTab, blurTarget }: { tab: Tab; onTab: (t: Tab) => void; blurTarget: RefObject<ComponentRef<typeof View> | null> }) {
  const insets = useSafeAreaInsets();
  const items: { id: Tab; label: string; Icon: typeof Bulb }[] = [
    { id: 'home', label: t.nav.home, Icon: Bulb },
    { id: 'presets', label: t.nav.presets, Icon: Sparkle },
    { id: 'settings', label: t.nav.settings, Icon: Sliders },
  ];
  return (
    <View
      style={{
        position: 'absolute', left: 24, right: 24, bottom: 24 + insets.bottom, height: 72, padding: 8, borderRadius: 36,
        flexDirection: 'row', gap: 4, borderWidth: 1, borderColor: 'rgba(255,255,255,0.8)',
        boxShadow: '0 14px 20px 4px rgba(4,69,144,0.08)',
      }}
    >
      {/* This pure white tint at intensity 80 is the design's 60 % fill; the reduction factor sets the radius apart. */}
      <BlurView
        blurTarget={blurTarget}
        blurMethod="dimezisBlurViewSdk31Plus"
        tint="systemChromeMaterial"
        intensity={80}
        blurReductionFactor={80 / 120}
        style={[StyleSheet.absoluteFill, { borderRadius: 36, overflow: 'hidden' }]}
      />
      {items.map(({ id, label, Icon }) => {
        const on = tab === id;
        return (
          <Pressable
            key={id}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onTab(id)}
            style={{ flex: 1, borderRadius: 28, alignItems: 'center', justifyContent: 'center', gap: 2, backgroundColor: on ? C.ink2 : 'transparent' }}
          >
            <Icon color={on ? '#fff' : C.muted} />
            <Text style={{ fontFamily: F.medium, fontSize: 12, color: on ? '#fff' : C.muted }}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Snackbar({ bottom = 24 }: { bottom?: number }) {
  const snack = useStore((s) => s.snack);
  const insets = useSafeAreaInsets();
  if (!snack) return null;
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[S.ink, { position: 'absolute', left: 24, right: 24, bottom: bottom + insets.bottom, minHeight: 56, borderRadius: 20, flexDirection: 'row', alignItems: 'center', paddingLeft: 20, paddingRight: 4 }]}
    >
      <Text style={[S.t14, { color: '#fff', flex: 1 }]}>{snack.text}</Text>
      {snack.retry && (
        <TextButton
          label={t.common.retry}
          color="#9CCBFF"
          onPress={() => {
            const r = snack.retry!;
            dismissSnack();
            r();
          }}
        />
      )}
    </View>
  );
}

export function WifiBanner() {
  const off = useStore(offHomeWifi);
  const isWifi = useStore((s) => s.wifi?.isWifi);
  if (!off) return null;
  return (
    <View style={{ borderRadius: 20, padding: 16, backgroundColor: C.peach, gap: 4 }}>
      <Text style={S.t16}>{isWifi ? t.wifi.otherNetwork : t.wifi.notOnWifi}</Text>
      <Text style={[S.t14m, { color: C.ink }]}>{t.wifi.connectHome}</Text>
    </View>
  );
}

/** Bottom sheet with a list of actions. */
export function ActionSheet({ visible, title, actions, onClose }: {
  visible: boolean; title?: string; onClose: () => void;
  actions: { label: string; onPress: () => void; destructive?: boolean }[];
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(10,13,18,0.35)', justifyContent: 'flex-end' }} onPress={onClose}>
        <Pressable style={{ margin: 12, marginBottom: 12 + insets.bottom, borderRadius: 32, backgroundColor: '#FAFDFF', padding: 8 }}>
          {title && <Text style={[S.t14m, { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }]}>{title}</Text>}
          {actions.map((a) => (
            <Pressable
              key={a.label}
              accessibilityRole="button"
              onPress={() => {
                onClose();
                a.onPress();
              }}
              style={({ pressed }) => ({ minHeight: 56, borderRadius: 24, paddingHorizontal: 16, justifyContent: 'center', backgroundColor: pressed ? C.bg : 'transparent' })}
            >
              <Text style={[S.t16, { color: a.destructive ? '#C01048' : C.ink }]}>{a.label}</Text>
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Modal text prompt (rename, new preset…). */
export function Prompt({ visible, title, initial = '', placeholder, confirm = t.common.save, onSubmit, onClose }: {
  visible: boolean; title: string; initial?: string; placeholder?: string; confirm?: string;
  onSubmit: (v: string) => void; onClose: () => void;
}) {
  const [v, setV] = useState(initial);
  useEffect(() => {
    if (visible) setV(initial);
  }, [visible, initial]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(10,13,18,0.35)', justifyContent: 'center', padding: 24 }} onPress={onClose}>
          <Pressable style={{ borderRadius: 32, backgroundColor: '#FAFDFF', padding: 24, gap: 16 }}>
            <Text style={S.t20}>{title}</Text>
            <TextInput
              autoFocus
              value={v}
              onChangeText={setV}
              placeholder={placeholder}
              placeholderTextColor={C.muted2}
              onSubmitEditing={() => v.trim() && onSubmit(v.trim())}
              style={{ height: 56, borderRadius: 16, paddingHorizontal: 20, fontFamily: F.medium, fontSize: 16, color: C.ink, backgroundColor: C.bg }}
            />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
              <TextButton label={t.common.cancel} color={C.ink} onPress={onClose} />
              <Pressable
                accessibilityRole="button"
                disabled={!v.trim()}
                onPress={() => onSubmit(v.trim())}
                style={[S.ink, { height: 44, paddingHorizontal: 20, borderRadius: 22, justifyContent: 'center', opacity: v.trim() ? 1 : 0.4 }]}
              >
                <Text style={[S.t14, { color: '#fff' }]}>{confirm}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

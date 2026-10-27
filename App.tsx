import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { View } from 'react-native';
import { BlurTargetView } from 'expo-blur';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts, Geist_400Regular, Geist_500Medium, Geist_600SemiBold } from '@expo-google-fonts/geist';
import { Home } from './src/screens/Home';
import { Control } from './src/screens/Control';
import { Presets } from './src/screens/Presets';
import { Settings } from './src/screens/Settings';
import { Pairing } from './src/screens/Pairing';
import { BottomNav, Snackbar, type Tab } from './src/ui/kit';
import { init, setCurrentLamp } from './src/store/store';
import { C } from './src/ui/theme';

type Routes = { Main: { tab?: Tab } | undefined; Control: { lampId: string }; Pairing: undefined };
const Stack = createNativeStackNavigator<Routes>();

function Main({ navigation, route }: NativeStackScreenProps<Routes, 'Main'>) {
  const [tab, setTab] = useState<Tab>(route.params?.tab ?? 'home');
  const blurTarget = useRef<ComponentRef<typeof View>>(null);
  useEffect(() => {
    if (route.params?.tab) setTab(route.params.tab);
  }, [route.params?.tab]);
  const openLamp = (id: string) => {
    setCurrentLamp(id);
    navigation.navigate('Control', { lampId: id });
  };
  const add = () => navigation.navigate('Pairing');
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <BlurTargetView ref={blurTarget} style={{ flex: 1 }}>
        {tab === 'home' && <Home onOpenLamp={openLamp} onAdd={add} onAllPresets={() => setTab('presets')} />}
        {tab === 'presets' && <Presets />}
        {tab === 'settings' && <Settings onOpenLamp={openLamp} onAdd={add} />}
      </BlurTargetView>
      <Snackbar bottom={108} />
      <BottomNav tab={tab} onTab={setTab} blurTarget={blurTarget} />
    </View>
  );
}

function ControlScreen({ navigation, route }: NativeStackScreenProps<Routes, 'Control'>) {
  return (
    <Control
      lampId={route.params.lampId}
      onBack={() => navigation.goBack()}
      onManagePresets={() => navigation.popTo('Main', { tab: 'presets' })}
    />
  );
}

function PairingScreen({ navigation }: NativeStackScreenProps<Routes, 'Pairing'>) {
  return (
    <Pairing
      onClose={() => navigation.goBack()}
      onDone={(id) => navigation.replace('Control', { lampId: id })}
    />
  );
}

export default function App() {
  const [fonts] = useFonts({ Geist_400Regular, Geist_500Medium, Geist_600SemiBold });
  useEffect(() => {
    init();
  }, []);
  if (!fonts) return <View style={{ flex: 1, backgroundColor: C.bg }} />;
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: 'slide_from_right' }}>
          <Stack.Screen name="Main" component={Main} />
          <Stack.Screen name="Control" component={ControlScreen} />
          <Stack.Screen name="Pairing" component={PairingScreen} options={{ animation: 'slide_from_bottom', gestureEnabled: false }} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

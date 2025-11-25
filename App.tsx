import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { BottomNav, NavKey } from './components/BottomNav';
import { ReloadButton } from './components/ReloadButton';
import { TrainMapContainer } from './components/map/TrainMapContainer';
import { SearchPanel } from './components/SearchPanel';
import { TrainPanelContainer } from './components/trains/TrainPanelContainer';
import {
  TrafficInfoSheet,
  TrafficSheetSnapPoint,
} from './components/traffic/TrafficInfoSheet';
import { ReloadProvider } from './contexts/ReloadContext';
import { useFrameRateLogger } from './hooks/useFrameRateLogger';
import type { TrainPosition } from './types/trains';
type PrimaryNavKey = Exclude<NavKey, 'traffic'>;

const PERF_LOGGING_ENABLED =
  typeof __DEV__ !== 'undefined' && __DEV__ && process.env.EXPO_PUBLIC_ENABLE_PERF_LOGS === '1';

const SWEDEN_REGION = {
  latitude: 62,
  longitude: 15,
  latitudeDelta: 15,
  longitudeDelta: 12,
};

const RAIL_TILE_URL = 'https://tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png';

export default function App() {
  return (
    <ReloadProvider>
      <AppContent />
    </ReloadProvider>
  );
}

function AppContent() {
  const [activeNav, setActiveNav] = useState<NavKey>('home');
  const [trafficSheetVisible, setTrafficSheetVisible] = useState(false);
  const [trafficSnap, setTrafficSnap] = useState<TrafficSheetSnapPoint>('hidden');
  const [trainSheetVisible, setTrainSheetVisible] = useState(false);
  const [trainSnap, setTrainSnap] = useState<TrafficSheetSnapPoint>('hidden');
  const [primaryNav, setPrimaryNav] = useState<PrimaryNavKey>('home');
  const [selectedTrainId, setSelectedTrainId] = useState<string | null>(null);
  const [mapFocusRequest, setMapFocusRequest] = useState<{ trainId: string; token: number } | null>(null);
  const navTranslateY = useSharedValue(0);
  useFrameRateLogger('root', PERF_LOGGING_ENABLED);

  const openTrainDetails = useCallback((train: TrainPosition, options: { focus?: boolean } = {}) => {
    setTrafficSheetVisible(false);
    setTrainSnap('half');
    setSelectedTrainId(train.id);
    setTrainSheetVisible(true);
    if (options.focus) {
      setMapFocusRequest({ trainId: train.id, token: Date.now() });
    }
  }, []);

  const handleSelectTrain = useCallback(
    (train: TrainPosition) => {
      openTrainDetails(train);
    },
    [openTrainDetails],
  );

  const handleSearchSelectTrain = useCallback(
    (train: TrainPosition) => {
      openTrainDetails(train, { focus: true });
      setPrimaryNav('home');
      setActiveNav('home');
    },
    [openTrainDetails],
  );

  const handleTrainSheetClose = useCallback(() => {
    setTrainSheetVisible(false);
    setTrainSnap('hidden');
    setSelectedTrainId(null);
  }, []);

  const handleSelectNav = (key: NavKey) => {
    if (key === 'traffic') {
      setTrainSheetVisible(false);
      setActiveNav('traffic');
      setTrafficSheetVisible(true);
      return;
    }
    setTrafficSheetVisible(false);
    setTrainSheetVisible(false);
    setPrimaryNav(key);
    setActiveNav(key);
  };

  useEffect(() => {
    const isSheetOpen = trafficSnap !== 'hidden' || trainSnap !== 'hidden';
    navTranslateY.value = withTiming(isSheetOpen ? 180 : 0, {
      duration: 240,
      easing: Easing.out(Easing.cubic),
    });
  }, [navTranslateY, trafficSnap, trainSnap]);

  const navAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: navTranslateY.value }],
  }));

  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider style={styles.safeArea}>
        <View style={styles.container}>
          <StatusBar style="light" />
          <TrainMapContainer
            style={styles.map}
            initialRegion={SWEDEN_REGION}
            tileUrl={RAIL_TILE_URL}
            selectedTrainId={selectedTrainId}
            onSelectTrain={handleSelectTrain}
            focusRequest={mapFocusRequest}
          />
          <SearchPanel
            visible={activeNav === 'search'}
            onSelectTrain={handleSearchSelectTrain}
            onRequestClose={() => {
              setPrimaryNav('home');
              setActiveNav('home');
            }}
          />
          <TrainPanelContainer
            visible={trainSheetVisible}
            initialSnap="half"
            trainId={selectedTrainId}
            onSnapPointChange={setTrainSnap}
            onClose={handleTrainSheetClose}
          />
          <ReloadButton />
          <Animated.View
            pointerEvents="box-none"
            style={[styles.bottomNavWrapper, navAnimatedStyle]}
          >
            <BottomNav activeKey={activeNav} onSelect={handleSelectNav} />
          </Animated.View>
          <TrafficInfoSheet
            visible={trafficSheetVisible}
            initialSnap="half"
            onSnapPointChange={setTrafficSnap}
            onClose={() => {
              setTrafficSheetVisible(false);
              setTrafficSnap('hidden');
              setActiveNav(primaryNav);
            }}
          />
        </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    backgroundColor: '#000',
  },
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  map: {
    flex: 1,
  },
  bottomNavWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
});

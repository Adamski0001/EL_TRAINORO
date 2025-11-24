import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { UrlTile } from 'react-native-maps';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { BottomNav, NavKey } from './components/BottomNav';
import { SearchPanel } from './components/SearchPanel';
import { TrainMarkers } from './components/trains/TrainMarkers';
import { TrainPanel } from './components/trains/TrainPanel';
import {
  TrafficInfoSheet,
  TrafficSheetSnapPoint,
} from './components/traffic/TrafficInfoSheet';
import { useTrainPositions } from './hooks/useTrainPositions';
import type { TrainPosition } from './types/trains';
type PrimaryNavKey = Exclude<NavKey, 'traffic'>;

const SWEDEN_REGION = {
  latitude: 62,
  longitude: 15,
  latitudeDelta: 15,
  longitudeDelta: 12,
};

const RAIL_TILE_URL = 'https://tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png';

export default function App() {
  const [activeNav, setActiveNav] = useState<NavKey>('home');
  const [trafficSheetVisible, setTrafficSheetVisible] = useState(false);
  const [trafficSnap, setTrafficSnap] = useState<TrafficSheetSnapPoint>('hidden');
  const [trainSheetVisible, setTrainSheetVisible] = useState(false);
  const [trainSnap, setTrainSnap] = useState<TrafficSheetSnapPoint>('hidden');
  const [primaryNav, setPrimaryNav] = useState<PrimaryNavKey>('home');
  const [selectedTrain, setSelectedTrain] = useState<TrainPosition | null>(null);
  const navTranslateY = useSharedValue(0);
  const { trains: trainPositions } = useTrainPositions();

  const handleSelectTrain = useCallback(
    (train: TrainPosition) => {
      setTrafficSheetVisible(false);
      setTrainSnap('half');
      setSelectedTrain(train);
      setTrainSheetVisible(true);
    },
    [],
  );

  const handleTrainSheetClose = useCallback(() => {
    setTrainSheetVisible(false);
    setTrainSnap('hidden');
    setSelectedTrain(null);
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
          <MapView
            style={styles.map}
            initialRegion={SWEDEN_REGION}
            showsCompass
            toolbarEnabled={false}
            moveOnMarkerPress={false}
          >
            <UrlTile
              urlTemplate={RAIL_TILE_URL}
              maximumZ={19}
              zIndex={2}
              tileSize={256}
            />
            <TrainMarkers
              trains={trainPositions}
              selectedTrainId={selectedTrain?.id ?? null}
              onSelectTrain={handleSelectTrain}
            />
          </MapView>
          <SearchPanel visible={activeNav === 'search'} />
          {selectedTrain ? (
            <TrainPanel
              visible={trainSheetVisible}
              initialSnap="half"
              train={selectedTrain}
              onSnapPointChange={setTrainSnap}
              onClose={handleTrainSheetClose}
            />
          ) : null}
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

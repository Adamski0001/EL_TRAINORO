import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DevSettings, Image, Platform, Pressable, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { BottomNav, NavKey } from './components/BottomNav';
import { TrainMapContainer } from './components/map/TrainMapContainer';
import type { MapFocusRequest } from './components/map/TrainMap';
import { SearchPanel } from './components/SearchPanel';
import { TrainPanelContainer } from './components/trains/TrainPanelContainer';
import {
  TrafficInfoSheet,
  TrafficSheetSnapPoint,
} from './components/traffic/TrafficInfoSheet';
import { ProfilePanelContainer } from './components/profile/ProfilePanelContainer';
import { StationPanelContainer } from './components/stations/StationPanelContainer';
import { ReloadProvider, useReloadApp } from './contexts/ReloadContext';
import { useFrameRateLogger } from './hooks/useFrameRateLogger';
import { useNotificationPermission } from './hooks/useNotificationPermission';
import type { Station } from './types/stations';
import type { TrainPosition } from './types/trains';
import { OnboardingOverlay, type OnboardingAnswers } from './components/onboarding/OnboardingOverlay';
import { haptics } from './lib/haptics';

const trainarLogo = require('./assets/images/trainar-logo.png');
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
const ONBOARDING_STORAGE_KEY = 'trainar.onboarding.v1';
const TRAINAR_HEADER_HEIGHT = 210;
const TRAINAR_LOGO_WIDTH = 530;
const TRAINAR_LOGO_HEIGHT = 185;
const TRAINAR_LOGO_VERTICAL_OFFSET = -60;
const SEARCH_BAR_HEIGHT = 52;
const SEARCH_PANEL_TOP_OFFSET = TRAINAR_HEADER_HEIGHT - 135 - SEARCH_BAR_HEIGHT * 0.7;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export default function App() {
  return (
    <ReloadProvider>
      <AppContent />
    </ReloadProvider>
  );
}

function AppContent() {
  const [activeNav, setActiveNav] = useState<NavKey>('home');
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [onboardingLoading, setOnboardingLoading] = useState(true);
  const [trafficSheetVisible, setTrafficSheetVisible] = useState(false);
  const [trafficSnap, setTrafficSnap] = useState<TrafficSheetSnapPoint>('hidden');
  const [trainSheetVisible, setTrainSheetVisible] = useState(false);
  const [trainSnap, setTrainSnap] = useState<TrafficSheetSnapPoint>('hidden');
  const [profileSheetVisible, setProfileSheetVisible] = useState(false);
  const [profileSnap, setProfileSnap] = useState<TrafficSheetSnapPoint>('hidden');
  const [primaryNav, setPrimaryNav] = useState<PrimaryNavKey>('home');
  const [selectedTrainId, setSelectedTrainId] = useState<string | null>(null);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [stationSheetVisible, setStationSheetVisible] = useState(false);
  const [stationSnap, setStationSnap] = useState<TrafficSheetSnapPoint>('hidden');
  const [mapFocusRequest, setMapFocusRequest] = useState<MapFocusRequest | null>(null);
  const onboardingContextRef = useRef<OnboardingAnswers | null>(null);
  const navTranslateY = useSharedValue(0);
  useFrameRateLogger('root', PERF_LOGGING_ENABLED);
  const { status: notificationStatus, request: requestNotificationPermission } = useNotificationPermission();

  useEffect(() => {
    if (notificationStatus === Notifications.PermissionStatus.UNDETERMINED) {
      void requestNotificationPermission();
    }
  }, [notificationStatus, requestNotificationPermission]);

  useEffect(() => {
    if (Platform.OS === 'android') {
      Notifications.setNotificationChannelAsync('traffic-alerts', {
        name: 'Trafiknotiser',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
      }).catch(error => console.warn('[Notifications] channel error', error));
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    const loadOnboardingState = async () => {
      try {
        const stored = await AsyncStorage.getItem(ONBOARDING_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as {
            completed?: boolean;
            answers?: OnboardingAnswers | null;
          };
          if (parsed?.completed) {
            onboardingContextRef.current = parsed.answers ?? null;
            if (isMounted) {
              setOnboardingComplete(true);
            }
          }
        }
      } catch (error) {
        console.warn('[Onboarding] Failed to load saved state', error);
      } finally {
        if (isMounted) {
          setOnboardingLoading(false);
        }
      }
    };
    void loadOnboardingState();
    return () => {
      isMounted = false;
    };
  }, []);

  const openTrainDetails = useCallback(
    (train: TrainPosition, options: { focus?: boolean } = {}) => {
      setTrafficSheetVisible(false);
      setStationSheetVisible(false);
      setStationSnap('hidden');
      setTrainSnap('half');
      setSelectedStationId(null);
      setSelectedTrainId(train.id);
      setTrainSheetVisible(true);
      if (options.focus) {
        setMapFocusRequest({ type: 'train', id: train.id, token: Date.now() });
      }
    },
    [],
  );

  const openStationDetails = useCallback(
    (station: Station, options: { focus?: boolean } = {}) => {
      setTrafficSheetVisible(false);
      setTrainSheetVisible(false);
      setTrainSnap('hidden');
      setProfileSheetVisible(false);
      setProfileSnap('hidden');
      setPrimaryNav('home');
      setActiveNav('home');
      setSelectedTrainId(null);
      setSelectedStationId(station.id);
      setStationSnap('half');
      setStationSheetVisible(true);
      if (options.focus) {
        setMapFocusRequest({ type: 'station', id: station.id, token: Date.now() });
      }
    },
    [setActiveNav, setPrimaryNav, setProfileSnap, setProfileSheetVisible],
  );

  const handleSelectTrain = useCallback(
    (train: TrainPosition) => {
      openTrainDetails(train);
    },
    [openTrainDetails],
  );

  const handleSelectStation = useCallback(
    (station: Station) => {
      openStationDetails(station);
    },
    [openStationDetails],
  );

  const handleSearchSelectTrain = useCallback(
    (train: TrainPosition) => {
      openTrainDetails(train, { focus: true });
      setPrimaryNav('home');
      setActiveNav('home');
    },
    [openTrainDetails],
  );

  const handleSearchSelectStation = useCallback(
    (station: Station) => {
      openStationDetails(station, { focus: true });
      setPrimaryNav('home');
      setActiveNav('home');
    },
    [openStationDetails],
  );

  const handleOpenTrainFromProfile = useCallback(
    (train: TrainPosition) => {
      setProfileSheetVisible(false);
      setProfileSnap('hidden');
      setPrimaryNav('home');
      setActiveNav('home');
      openTrainDetails(train, { focus: true });
    },
    [openTrainDetails, setActiveNav, setPrimaryNav, setProfileSheetVisible, setProfileSnap],
  );

  const handleProfileSheetClose = useCallback(() => {
    setProfileSheetVisible(false);
    setProfileSnap('hidden');
    setPrimaryNav('home');
    setActiveNav('home');
  }, [setActiveNav, setPrimaryNav, setProfileSheetVisible, setProfileSnap]);

  const handleTrainSheetClose = useCallback(() => {
    setTrainSheetVisible(false);
    setTrainSnap('hidden');
    setSelectedTrainId(null);
  }, []);

  const handleStationSheetClose = useCallback(() => {
    setStationSheetVisible(false);
    setStationSnap('hidden');
    setSelectedStationId(null);
  }, []);

  const handleSelectNav = (key: NavKey) => {
    if (key === 'traffic') {
      setTrainSheetVisible(false);
      setProfileSheetVisible(false);
      setProfileSnap('hidden');
      setStationSheetVisible(false);
      setStationSnap('hidden');
      setSelectedStationId(null);
      setActiveNav('traffic');
      setTrafficSheetVisible(true);
      return;
    }
    if (key === 'profile') {
      setTrafficSheetVisible(false);
      setTrainSheetVisible(false);
      setProfileSnap('half');
      setProfileSheetVisible(true);
      setStationSheetVisible(false);
      setStationSnap('hidden');
      setSelectedStationId(null);
      setPrimaryNav('profile');
      setActiveNav('profile');
      return;
    }
    setTrafficSheetVisible(false);
    setTrainSheetVisible(false);
    setProfileSheetVisible(false);
    setProfileSnap('hidden');
    setStationSheetVisible(false);
    setStationSnap('hidden');
    setSelectedStationId(null);
    setPrimaryNav(key);
    setActiveNav(key);
  };

  useEffect(() => {
    const isSheetOpen =
      trafficSnap !== 'hidden' ||
      trainSnap !== 'hidden' ||
      profileSnap !== 'hidden' ||
      stationSnap !== 'hidden';
    navTranslateY.value = withTiming(isSheetOpen ? 180 : 0, {
      duration: 240,
      easing: Easing.out(Easing.cubic),
    });
  }, [navTranslateY, profileSnap, trafficSnap, trainSnap, stationSnap]);

  const navAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: navTranslateY.value }],
  }));

  const handleOnboardingComplete = useCallback((answers?: OnboardingAnswers) => {
    const nextAnswers = answers ?? onboardingContextRef.current ?? null;
    if (answers) {
      onboardingContextRef.current = answers;
    }
    setOnboardingComplete(true);
    AsyncStorage.setItem(
      ONBOARDING_STORAGE_KEY,
      JSON.stringify({ completed: true, answers: nextAnswers }),
    ).catch(error => console.warn('[Onboarding] Failed to persist state', error));
  }, []);

  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider style={styles.safeArea}>
        <View style={styles.container}>
          <StatusBar style="light" />
          {onboardingComplete && <TrainarHeader />}
          <TrainMapContainer
            style={styles.map}
            initialRegion={SWEDEN_REGION}
            tileUrl={RAIL_TILE_URL}
            selectedTrainId={selectedTrainId}
            selectedStationId={selectedStationId}
            onSelectTrain={handleSelectTrain}
            onSelectStation={handleSelectStation}
            focusRequest={mapFocusRequest}
          />
          <SearchPanel
            visible={activeNav === 'search'}
            topOffset={SEARCH_PANEL_TOP_OFFSET}
            onSelectTrain={handleSearchSelectTrain}
            onSelectStation={handleSearchSelectStation}
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
          <StationPanelContainer
            visible={stationSheetVisible}
            initialSnap="half"
            stationId={selectedStationId}
            onSnapPointChange={setStationSnap}
            onClose={handleStationSheetClose}
            onOpenTrain={openTrainDetails}
          />
          <ProfilePanelContainer
            visible={profileSheetVisible}
            initialSnap="half"
            onSnapPointChange={setProfileSnap}
            onClose={handleProfileSheetClose}
            onOpenTrain={handleOpenTrainFromProfile}
          />
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
            notificationStatus={notificationStatus}
            onClose={() => {
              setTrafficSheetVisible(false);
              setTrafficSnap('hidden');
              setActiveNav(primaryNav);
            }}
          />
          {!onboardingLoading && !onboardingComplete && (
            <OnboardingOverlay onComplete={handleOnboardingComplete} />
          )}
        </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const TrainarHeader = () => {
  const insets = useSafeAreaInsets();
  const reloadApp = useReloadApp();
  const [reloading, setReloading] = useState(false);

  const handleReload = useCallback(async () => {
    if (reloading) {
      return;
    }
    haptics.light();
    setReloading(true);
    try {
      if (__DEV__ && Platform.OS !== 'web' && typeof DevSettings.reload === 'function') {
        DevSettings.reload();
        return;
      }
      await reloadApp();
    } catch (error) {
      console.warn('[TrainarHeader] Reload failed', error);
    } finally {
      setReloading(false);
    }
  }, [reloading, reloadApp]);

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.headerOverlay,
        {
          paddingTop: Math.max(insets.top, 0),
        },
      ]}
    >
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(4,8,18,0.95)', 'rgba(4,8,18,0.45)', 'rgba(4,8,18,0)']}
        locations={[0, 0.65, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Ladda om Trainar"
        onPress={handleReload}
        disabled={reloading}
        style={({ pressed }) => [
          styles.logoButton,
          pressed && styles.logoButtonPressed,
          reloading && styles.logoButtonDisabled,
        ]}
      >
        <Image
          source={trainarLogo}
          style={[styles.headerLogo, reloading && styles.headerLogoDisabled]}
          resizeMode="contain"
        />
      </Pressable>
    </View>
  );
};

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
  headerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: TRAINAR_HEADER_HEIGHT,
    alignItems: 'center',
    justifyContent: 'flex-start',
    zIndex: 20,
  },
  headerLogo: {
    width: '100%',
    height: '100%',
  },
  headerLogoDisabled: {
    opacity: 0.7,
  },
  logoButton: {
    width: TRAINAR_LOGO_WIDTH,
    height: TRAINAR_LOGO_HEIGHT,
    marginTop: TRAINAR_LOGO_VERTICAL_OFFSET,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: TRAINAR_LOGO_HEIGHT / 6,
  },
  logoButtonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  logoButtonDisabled: {
    opacity: 0.75,
  },
  bottomNavWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
});

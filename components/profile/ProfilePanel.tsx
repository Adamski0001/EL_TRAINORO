import { BlurView } from 'expo-blur';
import Constants from 'expo-constants';
import { TrainFront, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  Switch,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
} from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { deriveAccentColor } from '../../lib/deriveAccentColor';
import { useTrainSearchIndex, type TrainSearchItem } from '../../hooks/useTrainSearchIndex';
import { useNotificationPermission } from '../../hooks/useNotificationPermission';
import { useReloadApp, useReloadInfo } from '../../contexts/ReloadContext';
import { useUserLocation } from '../../hooks/useUserLocation';
import { useUserProfile } from '../../hooks/useUserProfile';
import { getSupabaseClient, isSupabaseConfigured } from '../../lib/supabaseClient';
import type { TrainPosition } from '../../types/trains';
import type { TrafficSheetSnapPoint } from '../traffic/sheetSnapPoints';
import type { OnboardingStage } from '../onboarding/OnboardingOverlay';
import { haptics } from '../../lib/haptics';
import {
  SHEET_BOTTOM_LOCK_REGION,
  SHEET_FLICK_VELOCITY,
  SHEET_SNAP_POINTS,
  SHEET_SNAP_SEQUENCE,
  SHEET_STICKY_ZONE,
  SHEET_TIMING_CONFIG,
  SHEET_TOP_LOCK_REGION,
  clampSheetPosition,
  findNearestSheetSnap,
  snapSheetInDirection,
} from '../traffic/sheetSnapPoints';

const MAX_LIST_ITEMS = 3;

const BACKEND_VERSION =
  Constants.expoConfig?.extra?.backendVersion ??
  Constants.manifest?.extra?.backendVersion ??
  (typeof process !== 'undefined' ? process.env.EXPO_PUBLIC_BACKEND_VERSION : undefined) ??
  'lokal';

type ProfilePanelProps = {
  visible: boolean;
  initialSnap?: Exclude<TrafficSheetSnapPoint, 'hidden'>;
  onClose: () => void;
  onSnapPointChange?: (point: TrafficSheetSnapPoint) => void;
  onOpenTrain: (train: TrainPosition, options?: { allowScheduleFallback?: boolean; focus?: boolean }) => void;
  onRequestAuth?: (startStage?: OnboardingStage) => void;
};

const formatRelativeTime = (timestamp: number) => {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) {
    return 'Nyss';
  }
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) {
    return `${minutes} min sedan`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours} h sedan`;
};

export function ProfilePanel({
  visible,
  initialSnap = 'half',
  onClose,
  onSnapPointChange,
  onOpenTrain,
  onRequestAuth,
}: ProfilePanelProps) {
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(SHEET_SNAP_POINTS.hidden);
  const startY = useSharedValue(SHEET_SNAP_POINTS.hidden);
  const onCloseRef = useRef(onClose);
  const onSnapPointChangeRef = useRef(onSnapPointChange);
  const [notificationRequesting, setNotificationRequesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [logoutInProgress, setLogoutInProgress] = useState(false);

  const profile = useUserProfile();
  const { items } = useTrainSearchIndex();
  const {
    status: notificationStatus,
    canAskAgain: canRequestNotifications,
    request: requestNotificationPermission,
  } = useNotificationPermission();
  const {
    permissionStatus: locationPermission,
    canAskAgain: canRequestLocation,
    requestPermission: requestLocationPermission,
    loading: requestingLocation,
    error: locationError,
  } = useUserLocation({ active: visible });
  const reloadApp = useReloadApp();
  const { lastReloadedAt } = useReloadInfo();

  const accentColor = useMemo(
    () => profile.user.accentColor || deriveAccentColor(profile.user.id),
    [profile.user.accentColor, profile.user.id],
  );
  const isNotificationEnabled = notificationStatus === 'granted';
  const isLocationEnabled = locationPermission === 'granted';
  const membershipLabel = useMemo(
    () => (profile.user.tier.toLowerCase().includes('pro') ? 'Pro' : 'Free'),
    [profile.user.tier],
  );

  const itemLookup = useMemo(() => {
    const lookup = new Map<string, TrainSearchItem>();
    items.forEach(item => lookup.set(item.id, item));
    return lookup;
  }, [items]);

  const favoriteTrains = useMemo(() => {
    return profile.favorites
      .map(id => itemLookup.get(id))
      .filter(Boolean) as TrainSearchItem[];
  }, [profile.favorites, itemLookup]);

  const recentTrains = useMemo(() => {
    return profile.recentTrains
      .map(entry => {
        const detail = itemLookup.get(entry.trainId);
        if (!detail) {
          return null;
        }
        return { entry, detail };
      })
      .filter(Boolean) as Array<{ entry: typeof profile.recentTrains[number]; detail: TrainSearchItem }>;
  }, [itemLookup, profile.recentTrains]);

  const savedStations = profile.savedStations;
  const topFavorites = useMemo(() => favoriteTrains.slice(0, MAX_LIST_ITEMS), [favoriteTrains]);
  const topRecents = useMemo(() => recentTrains.slice(0, MAX_LIST_ITEMS), [recentTrains]);
  const totalFavorites = favoriteTrains.length + savedStations.length;

  const handleToggleFavorite = useCallback(
    (trainId: string) => {
      profile.toggleFavoriteTrain(trainId);
    },
    [profile],
  );

  const handleRemoveRecent = useCallback(
    (trainId: string) => {
      profile.removeRecentTrain(trainId);
    },
    [profile],
  );

  const handleRemoveStation = useCallback(
    (stationId: string) => {
      profile.removeSavedStation(stationId);
    },
    [profile],
  );

  const handleRequestNotifications = useCallback(async () => {
    setNotificationRequesting(true);
    try {
      await requestNotificationPermission();
    } finally {
      setNotificationRequesting(false);
    }
  }, [requestNotificationPermission]);

  const handleNotificationToggle = useCallback(
    (nextValue: boolean) => {
      haptics.light();
      if (nextValue && !isNotificationEnabled) {
        void handleRequestNotifications();
        haptics.success();
        return;
      }
      if (!nextValue && isNotificationEnabled) {
        Linking.openSettings().catch(error => console.warn('[ProfilePanel] notification settings', error));
        haptics.success();
      }
    },
    [handleRequestNotifications, isNotificationEnabled],
  );

  const handleLocationToggle = useCallback(
    (nextValue: boolean) => {
      haptics.light();
      if (nextValue && !isLocationEnabled) {
        void requestLocationPermission();
        haptics.success();
        return;
      }
      if (!nextValue && isLocationEnabled) {
        Linking.openSettings().catch(error => console.warn('[ProfilePanel] location settings', error));
        haptics.success();
      }
    },
    [isLocationEnabled, requestLocationPermission],
  );

  const handleSync = useCallback(async () => {
    haptics.medium();
    setSyncing(true);
    try {
      profile.reloadProfile();
      await reloadApp();
    } catch (error) {
      console.warn('[ProfilePanel] Sync failed', error);
    } finally {
      setSyncing(false);
    }
  }, [profile, reloadApp]);

  const handleOpenAuth = useCallback(() => {
    haptics.medium();
    onRequestAuth?.();
  }, [onRequestAuth]);

  const handleLogout = useCallback(async () => {
    if (logoutInProgress) {
      return;
    }
    haptics.medium();
    setLogoutInProgress(true);
    try {
      if (isSupabaseConfigured) {
        const supabase = getSupabaseClient();
        await supabase.auth.signOut();
      }
    } catch (error) {
      console.warn('[ProfilePanel] logout failed', error);
    } finally {
      profile.setUserInfo({
        id: 'guest',
        name: null,
        tier: 'Fri medlem',
        authenticated: false,
        accentColor: null,
      });
      setLogoutInProgress(false);
    }
  }, [logoutInProgress, profile]);

  const formatStatusMessage = useMemo(() => {
    if (profile.loading) {
      return 'Läser in din profil…';
    }
    if (profile.error) {
      return 'Kunde inte läsa din profil';
    }
    return 'Allt synkroniserat';
  }, [profile.error, profile.loading]);

  const notificationReason = useMemo(() => {
    if (notificationStatus === 'granted') {
      return 'Aviseringar är aktiva.';
    }
    if (!canRequestNotifications) {
      return 'Aktivera aviseringar i systeminställningar.';
    }
    return 'Störningar och favoriter som du följer.';
  }, [canRequestNotifications, notificationStatus]);

  const locationMessage = useMemo(() => {
    if (locationPermission === 'granted') {
      return 'Platstjänster är aktiverade.';
    }
    if (canRequestLocation) {
      return 'Dela plats för närmsta station och avstånd.';
    }
    return 'Aktivera platstjänster i inställningarna.';
  }, [canRequestLocation, locationPermission]);

  const lastSyncLabel = lastReloadedAt
    ? lastReloadedAt.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
    : 'Aldrig';

  const handleOpenTrain = useCallback(
    (train: TrainPosition) => {
      onOpenTrain(train);
    },
    [onOpenTrain],
  );

  const handleSnapComplete = useCallback(
    (snap: TrafficSheetSnapPoint) => {
      onSnapPointChangeRef.current?.(snap);
      if (snap === 'hidden') {
        onCloseRef.current?.();
      }
    },
    [],
  );

  const handleClose = useCallback(() => {
    translateY.value = withTiming(SHEET_SNAP_POINTS.hidden, SHEET_TIMING_CONFIG, finished => {
      if (finished) {
        runOnJS(handleSnapComplete)('hidden');
      }
    });
  }, [handleSnapComplete, translateY]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    onSnapPointChangeRef.current = onSnapPointChange;
  }, [onSnapPointChange]);

  useEffect(() => {
    const target: TrafficSheetSnapPoint = visible ? initialSnap : 'hidden';
    translateY.value = withTiming(SHEET_SNAP_POINTS[target], SHEET_TIMING_CONFIG, finished => {
      if (finished) {
        runOnJS(handleSnapComplete)(target);
      }
    });
  }, [handleSnapComplete, initialSnap, translateY, visible]);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(visible)
        .shouldCancelWhenOutside(false)
        .onBegin(() => {
          startY.value = translateY.value;
        })
        .onUpdate(event => {
          const nextY = startY.value + event.translationY;
          translateY.value = clampSheetPosition(nextY);
        })
        .onEnd(event => {
          'worklet';

          const releaseY = clampSheetPosition(startY.value + event.translationY);
          const velocityY = event.velocityY;
          const isSwipeUp = velocityY < -SHEET_FLICK_VELOCITY;
          const isSwipeDown = velocityY > SHEET_FLICK_VELOCITY;

          let target: TrafficSheetSnapPoint = 'half';

          if (isSwipeUp) {
            target = snapSheetInDirection(releaseY, 'up');
          } else if (isSwipeDown) {
            target = snapSheetInDirection(releaseY, 'down');
          } else if (releaseY <= SHEET_TOP_LOCK_REGION) {
            target = 'full';
          } else if (releaseY >= SHEET_BOTTOM_LOCK_REGION) {
            target = 'hidden';
          } else {
            let stickyTarget: TrafficSheetSnapPoint | null = null;
            let stickyDistance = Number.MAX_VALUE;
            for (let i = 0; i < SHEET_SNAP_SEQUENCE.length; i += 1) {
              const snap = SHEET_SNAP_SEQUENCE[i];
              const distance = Math.abs(releaseY - snap.value);
              if (distance <= SHEET_STICKY_ZONE && distance < stickyDistance) {
                stickyTarget = snap.key;
                stickyDistance = distance;
              }
            }
            target = stickyTarget ?? findNearestSheetSnap(releaseY);
          }

          translateY.value = releaseY;
          translateY.value = withTiming(SHEET_SNAP_POINTS[target], SHEET_TIMING_CONFIG, finished => {
            if (finished) {
              runOnJS(handleSnapComplete)(target);
            }
          });
        }),
    [handleSnapComplete, startY, translateY, visible],
  );

  const animatedStyle = useAnimatedStyle(() => ({
    top: translateY.value,
  }));

  const bottomPadding = Math.max(insets.bottom, 26);

  return (
    <Animated.View pointerEvents="box-none" style={[styles.container, animatedStyle]}>
      <BlurView intensity={85} tint="dark" style={[styles.sheet, { paddingBottom: bottomPadding }]}>
        <GestureDetector gesture={panGesture}>
          <View style={styles.dragZone}>
            <View style={styles.handle} />
            <View style={styles.sheetHeader}>
              <View style={styles.titleBlock}>
                <Text style={styles.sheetTitle}>Profil</Text>
                <Text style={styles.sheetSubtitle}>{formatStatusMessage}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={handleClose}
                hitSlop={10}
                style={styles.closeButton}
              >
                <X color="rgba(255,255,255,0.75)" size={18} />
              </Pressable>
            </View>
          </View>
        </GestureDetector>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPadding + 12 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.heroCard}>
            <View style={[styles.avatar, { borderColor: accentColor }]}>
              <Text style={styles.avatarLabel}>
                {profile.user.name ? profile.user.name.charAt(0) : 'G'}
              </Text>
            </View>
            <View style={styles.heroText}>
              <Text style={styles.heroName}>{profile.user.name ?? 'Gäst'}</Text>
              <Text style={styles.heroTier}>{membershipLabel}</Text>
              <Text style={styles.heroMeta}>{profile.user.tier}</Text>
            </View>
            <View style={[styles.heroBadge, { borderColor: accentColor }]}>
              <Text style={[styles.heroBadgeText, { color: accentColor }]}>
                {profile.user.authenticated ? 'Inloggad' : 'Gäst'}
              </Text>
            </View>
          </View>

          {!profile.user.authenticated ? (
            <Pressable onPress={handleOpenAuth} style={styles.loginButton}>
              <Text style={styles.loginButtonText}>Logga in / skapa konto</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={handleLogout}
              disabled={logoutInProgress}
              style={({ pressed }) => [
                styles.logoutButton,
                pressed && styles.logoutButtonPressed,
                logoutInProgress && styles.logoutButtonDisabled,
              ]}
            >
              <Text style={styles.logoutButtonText}>
                {logoutInProgress ? 'Loggar ut…' : 'Logga ut'}
              </Text>
            </Pressable>
          )}

          <View style={styles.quickRow}>
            <View style={styles.quickCard}>
              <Text style={styles.quickLabel}>Favoriter</Text>
              <Text style={[styles.quickValue, { color: accentColor }]}>{totalFavorites}</Text>
              <Text style={styles.quickSub}>
                Tåg {favoriteTrains.length} · Stationer {savedStations.length}
              </Text>
            </View>
            <View style={styles.quickCard}>
              <Text style={styles.quickLabel}>Senast</Text>
              <Text style={[styles.quickValue, { color: accentColor }]}>{recentTrains.length}</Text>
              <Text style={styles.quickSub}>Visade tåg</Text>
            </View>
          </View>

          {profile.loading && !profile.error ? (
            <View style={styles.loadingSection}>
              <ActivityIndicator color="#fff" />
              <Text style={styles.loadingLabel}>Hämtar profil…</Text>
            </View>
          ) : null}

          {profile.error ? (
            <View style={styles.errorState}>
              <Text style={styles.errorTitle}>Kunde inte läsa profil</Text>
              <Text style={styles.errorSubtitle}>{profile.error}</Text>
              <Pressable style={styles.retryButton} onPress={profile.reloadProfile}>
                <Text style={styles.retryLabel}>Försök igen</Text>
              </Pressable>
            </View>
          ) : null}

          <View style={styles.statusCard}>
            <Text style={styles.statusTitle}>Profilstatus</Text>
            <Text style={styles.statusText}>{formatStatusMessage}</Text>
            <Text style={styles.statusHint}>Senast synk {lastSyncLabel}</Text>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Notiser & plats</Text>
              <Text style={styles.sectionSub}>Det viktigaste på en rad</Text>
            </View>
            <View style={styles.toggleCard}>
              <View style={styles.toggleText}>
                <Text style={styles.toggleTitle}>Pushnotiser</Text>
                <Text style={styles.toggleSub}>{notificationReason}</Text>
              </View>
              <View style={styles.toggleActions}>
                <Switch
                  value={isNotificationEnabled}
                  onValueChange={handleNotificationToggle}
                  disabled={!canRequestNotifications && !isNotificationEnabled}
                  thumbColor={isNotificationEnabled ? accentColor : '#f2f2f2'}
                  trackColor={{ false: 'rgba(255,255,255,0.12)', true: 'rgba(255,255,255,0.25)' }}
                  ios_backgroundColor="rgba(255,255,255,0.12)"
                />
                <Pressable
                  onPress={handleRequestNotifications}
                  disabled={!canRequestNotifications || notificationRequesting}
                  style={({ pressed }) => [
                    styles.miniAction,
                    (!canRequestNotifications && !isNotificationEnabled) && styles.miniActionDisabled,
                    pressed && styles.miniActionPressed,
                  ]}
                >
                  <Text style={styles.miniActionText}>
                    {isNotificationEnabled ? 'Hantera' : notificationRequesting ? 'Begär…' : 'Aktivera'}
                  </Text>
                </Pressable>
              </View>
            </View>
            <View style={styles.toggleCard}>
              <View style={styles.toggleText}>
                <Text style={styles.toggleTitle}>Plats</Text>
                <Text style={styles.toggleSub}>{locationMessage}</Text>
                {locationError ? <Text style={styles.toggleHint}>{locationError}</Text> : null}
              </View>
              <View style={styles.toggleActions}>
                <Switch
                  value={isLocationEnabled}
                  onValueChange={handleLocationToggle}
                  disabled={!canRequestLocation && !isLocationEnabled}
                  thumbColor={isLocationEnabled ? accentColor : '#f2f2f2'}
                  trackColor={{ false: 'rgba(255,255,255,0.12)', true: 'rgba(255,255,255,0.25)' }}
                  ios_backgroundColor="rgba(255,255,255,0.12)"
                />
                <Pressable
                  onPress={
                    isLocationEnabled
                      ? () => Linking.openSettings().catch(error => console.warn(error))
                      : requestLocationPermission
                  }
                  disabled={!canRequestLocation && !isLocationEnabled}
                  style={({ pressed }) => [
                    styles.miniAction,
                    (!canRequestLocation && !isLocationEnabled) && styles.miniActionDisabled,
                    pressed && styles.miniActionPressed,
                  ]}
                >
                  <Text style={styles.miniActionText}>
                    {isLocationEnabled ? 'Hantera' : requestingLocation ? 'Begär…' : 'Dela plats'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Favoriter</Text>
              <Text style={styles.sectionSub}>Snabb åtkomst</Text>
            </View>
            {topFavorites.length === 0 ? (
              <View style={styles.placeholderCard}>
                <Text style={styles.placeholderTitle}>Inget sparat</Text>
                <Text style={styles.placeholderText}>Stjärnmarkera ett tåg i söklistan så dyker det upp här.</Text>
              </View>
            ) : (
              topFavorites.map(train => (
                <View key={`fav-${train.id}`} style={styles.listCard}>
                  <View style={styles.listRow}>
                    <View style={styles.iconCircle}>
                      <TrainFront size={18} color="#fff" strokeWidth={2.2} />
                    </View>
                    <View style={styles.listBody}>
                      <Text style={styles.listTitle}>{train.title}</Text>
                      <Text style={styles.listSub}>{train.subtitle ?? 'Operatör saknas'}</Text>
                      {train.routeText ? <Text style={styles.listMeta}>{train.routeText}</Text> : null}
                    </View>
                    <Pressable onPress={() => handleOpenTrain(train.train)} style={styles.miniAction}>
                      <Text style={styles.miniActionText}>Öppna</Text>
                    </Pressable>
                    <Pressable onPress={() => handleToggleFavorite(train.id)} style={styles.miniAction}>
                      <Text style={styles.miniActionText}>Ta bort</Text>
                    </Pressable>
                  </View>
                </View>
              ))
            )}
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Senast visade</Text>
              <Text style={styles.sectionSub}>Fortsätt där du var</Text>
            </View>
            {topRecents.length === 0 ? (
              <View style={styles.placeholderCard}>
                <Text style={styles.placeholderTitle}>Tomt här</Text>
                <Text style={styles.placeholderText}>Vi visar dina tre senaste tåg när du har öppnat dem.</Text>
              </View>
            ) : (
              topRecents.map(({ entry, detail }) => (
                <View key={`recent-${detail.id}`} style={styles.listCard}>
                  <View style={styles.listRow}>
                    <View style={styles.iconCircle}>
                      <TrainFront size={18} color="#fff" strokeWidth={2.2} />
                    </View>
                    <View style={styles.listBody}>
                      <Text style={styles.listTitle}>{detail.title}</Text>
                      <Text style={styles.listSub}>{detail.subtitle ?? 'Operatör saknas'}</Text>
                      <Text style={styles.listMeta}>{formatRelativeTime(entry.lastViewedAt)}</Text>
                    </View>
                    <Pressable onPress={() => handleOpenTrain(detail.train)} style={styles.miniAction}>
                      <Text style={styles.miniActionText}>Öppna</Text>
                    </Pressable>
                    <Pressable onPress={() => handleRemoveRecent(detail.id)} style={styles.miniAction}>
                      <Text style={styles.miniActionText}>Ta bort</Text>
                    </Pressable>
                  </View>
                </View>
              ))
            )}
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Sparade stationer</Text>
              <Text style={styles.sectionSub}>Snabb riktning</Text>
            </View>
            {savedStations.length === 0 ? (
              <View style={styles.placeholderCard}>
                <Text style={styles.placeholderTitle}>Inga stationer</Text>
                <Text style={styles.placeholderText}>Spara en station för att se den här.</Text>
              </View>
            ) : (
              savedStations.map(station => (
                <View key={station.id} style={styles.listCard}>
                  <View style={styles.listRow}>
                    <View style={styles.iconCircle}>
                      <TrainFront size={18} color="#fff" strokeWidth={2.2} />
                    </View>
                    <View style={styles.listBody}>
                      <Text style={styles.listTitle}>{station.label}</Text>
                      <Text style={styles.listMeta}>{station.direction}</Text>
                    </View>
                    <Pressable onPress={() => handleRemoveStation(station.id)} style={styles.miniAction}>
                      <Text style={styles.miniActionText}>Ta bort</Text>
                    </Pressable>
                  </View>
                </View>
              ))
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Hjälp & system</Text>
            <View style={styles.supportCard}>
              <Pressable
                onPress={handleSync}
                style={({ pressed }) => [styles.supportAction, pressed && styles.supportActionPressed]}
              >
                {syncing ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.supportActionText}>Synka data</Text>
                )}
              </Pressable>
              <Pressable
                onPress={() => Linking.openURL('mailto:support@trainar.app').catch(error => console.warn(error))}
                style={({ pressed }) => [styles.supportAction, pressed && styles.supportActionPressed]}
              >
                <Text style={styles.supportActionText}>Kontakta support</Text>
              </Pressable>
              <Pressable
                onPress={() => Linking.openSettings().catch(error => console.warn(error))}
                style={({ pressed }) => [styles.supportAction, pressed && styles.supportActionPressed]}
              >
                <Text style={styles.supportActionText}>Systeminställningar</Text>
              </Pressable>
            </View>
            <Text style={styles.systemLog}>Backend {BACKEND_VERSION} · Senast synk {lastSyncLabel}</Text>
          </View>
        </ScrollView>
      </BlurView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 25,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    flex: 1,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  dragZone: {
    paddingTop: 10,
    paddingHorizontal: 20,
  },
  handle: {
    width: 46,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.35)',
    alignSelf: 'center',
    marginBottom: 12,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleBlock: {
    gap: 4,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  sheetSubtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
  },
  closeButton: {
    padding: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    gap: 14,
    flexGrow: 1,
  },
  heroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(6,12,24,0.55)',
  },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: 'rgba(255,255,255,0.3)',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  avatarLabel: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 24,
  },
  heroText: {
    flex: 1,
    gap: 2,
  },
  heroName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  heroTier: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  heroMeta: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.55)',
  },
  heroBadge: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  heroBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  loginButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.25)',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  loginButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  logoutButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  logoutButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  logoutButtonPressed: {
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  logoutButtonDisabled: {
    opacity: 0.6,
  },
  quickRow: {
    flexDirection: 'row',
    gap: 10,
  },
  quickCard: {
    flex: 1,
    borderRadius: 16,
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 4,
  },
  quickLabel: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 12,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  quickValue: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
  },
  quickSub: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
  },
  loadingSection: {
    alignItems: 'center',
    paddingVertical: 14,
    gap: 6,
  },
  loadingLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
  },
  errorState: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,96,96,0.35)',
    backgroundColor: 'rgba(255,96,96,0.08)',
    padding: 14,
    gap: 6,
  },
  errorTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  errorSubtitle: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    lineHeight: 18,
  },
  retryButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  retryLabel: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
    letterSpacing: 0.3,
  },
  statusCard: {
    borderRadius: 16,
    padding: 14,
    backgroundColor: 'rgba(6,12,24,0.58)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 4,
  },
  statusTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  statusText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
  },
  statusHint: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
  },
  section: {
    gap: 10,
  },
  sectionHeader: {
    gap: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  sectionSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
  },
  toggleCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(6,12,24,0.55)',
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  toggleText: {
    flex: 1,
    gap: 4,
  },
  toggleTitle: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  toggleSub: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 12,
  },
  toggleHint: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
  },
  toggleActions: {
    alignItems: 'flex-end',
    gap: 8,
  },
  placeholderCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 14,
    alignItems: 'flex-start',
    backgroundColor: 'rgba(6,12,24,0.5)',
    gap: 4,
  },
  placeholderTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  placeholderText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
  },
  listCard: {
    borderRadius: 16,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(6,12,24,0.55)',
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  listBody: {
    flex: 1,
    gap: 2,
  },
  listTitle: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
  listSub: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 12,
  },
  listMeta: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
  },
  miniAction: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  miniActionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  miniActionDisabled: {
    opacity: 0.5,
  },
  miniActionPressed: {
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  supportCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(6,12,24,0.55)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    padding: 10,
  },
  supportAction: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
  },
  supportActionPressed: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  supportActionText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  systemLog: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 6,
  },
});

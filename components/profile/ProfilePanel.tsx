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
import { formatDistanceLabel } from '../../lib/geo';
import { useTrainSearchIndex, type TrainSearchItem } from '../../hooks/useTrainSearchIndex';
import { useNotificationPermission } from '../../hooks/useNotificationPermission';
import { useReloadApp, useReloadInfo } from '../../contexts/ReloadContext';
import { useTrafficEvents } from '../../hooks/useTrafficEvents';
import { useTrafficEventSummaries } from '../../hooks/useTrafficEventSummaries';
import { useUserLocation } from '../../hooks/useUserLocation';
import { useUserProfile } from '../../hooks/useUserProfile';
import { computeEventDistance } from '../../lib/trafficEventUtils';
import type { TrainPosition } from '../../types/trains';
import type { TrafficEvent } from '../../types/traffic';
import type { TrafficSheetSnapPoint } from '../traffic/sheetSnapPoints';
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

const COMMUTE_WINDOWS = ['05:30-08:30', '06:30-09:00', '16:00-18:30'];
const IMPACT_OPTIONS = ['low', 'medium', 'high', 'critical'] as const;
const IMPACT_LABELS: Record<(typeof IMPACT_OPTIONS)[number], string> = {
  low: 'Liten påverkan',
  medium: 'Måttlig påverkan',
  high: 'Stor påverkan',
  critical: 'Mycket stor påverkan',
};
const SEVERITY_COLORS: Record<ImpactLevel, string> = {
  low: '#34d399',
  medium: '#fbbf24',
  high: '#fb7185',
  critical: '#f87171',
};
const REGION_OPTIONS = ['Sverige', 'Stockholm', 'Göteborg', 'Malmö'];
const SEVERITY_RANK: Record<ImpactLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};
const INTEREST_TOPICS = [
  { key: 'commuter', label: 'Pendling', hint: 'Vardagar morgon/kväll' },
  { key: 'longdistance', label: 'Långresa', hint: 'Fjärr- och nattåg' },
  { key: 'maintenance', label: 'Banarbeten', hint: 'Service & avstängningar' },
  { key: 'weather', label: 'Väderpåverkan', hint: 'Snö, storm, halka' },
  { key: 'city', label: 'Storstad', hint: 'Stockholm/Göteborg/Malmö' },
] as const;
const INTEREST_KEYWORDS: Record<(typeof INTEREST_TOPICS)[number]['key'], string[]> = {
  commuter: ['pendel', 'rusning', 'försening', 'pendeltåg'],
  longdistance: ['fjärr', 'nattåg', 'intercity', 'snabbtåg', 'sj'],
  maintenance: ['banarbete', 'service', 'underhåll', 'avstängd', 'arbete'],
  weather: ['snö', 'storm', 'väder', 'halk', 'oväder'],
  city: ['stockholm', 'göteborg', 'malmö', 'pendeltåg', 'spårproblem'],
};

const BACKEND_VERSION =
  Constants.expoConfig?.extra?.backendVersion ??
  Constants.manifest?.extra?.backendVersion ??
  (typeof process !== 'undefined' ? process.env.EXPO_PUBLIC_BACKEND_VERSION : undefined) ??
  'lokal';

type ImpactLevel = (typeof IMPACT_OPTIONS)[number];

type ProfilePanelProps = {
  visible: boolean;
  initialSnap?: Exclude<TrafficSheetSnapPoint, 'hidden'>;
  onClose: () => void;
  onSnapPointChange?: (point: TrafficSheetSnapPoint) => void;
  onOpenTrain: (train: TrainPosition) => void;
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
}: ProfilePanelProps) {
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(SHEET_SNAP_POINTS.hidden);
  const startY = useSharedValue(SHEET_SNAP_POINTS.hidden);
  const onCloseRef = useRef(onClose);
  const onSnapPointChangeRef = useRef(onSnapPointChange);
  const [notificationRequesting, setNotificationRequesting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const profile = useUserProfile();
  const { items } = useTrainSearchIndex();
  const {
    status: notificationStatus,
    canAskAgain: canRequestNotifications,
    request: requestNotificationPermission,
  } = useNotificationPermission();
  const {
    coords: userCoords,
    permissionStatus: locationPermission,
    canAskAgain: canRequestLocation,
    requestPermission: requestLocationPermission,
    loading: requestingLocation,
    error: locationError,
  } = useUserLocation({ active: visible });
  const { events: trafficEvents, loading: trafficLoading, error: trafficError } = useTrafficEvents();
  const { summaries: trafficSummaries, ensureSummary: ensureTrafficSummary } = useTrafficEventSummaries();
  const reloadApp = useReloadApp();
  const { lastReloadedAt } = useReloadInfo();

  const accentColor = useMemo(() => deriveAccentColor(profile.user.id), [profile.user.id]);
  const isNotificationEnabled = notificationStatus === 'granted';
  const isLocationEnabled = locationPermission === 'granted';
  const interestTopics = profile.preferences.interestTopics ?? [];

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
      if (nextValue && !isNotificationEnabled) {
        void handleRequestNotifications();
        return;
      }
      if (!nextValue && isNotificationEnabled) {
        Linking.openSettings().catch(error => console.warn('[ProfilePanel] notification settings', error));
      }
    },
    [handleRequestNotifications, isNotificationEnabled],
  );

  const handleLocationToggle = useCallback(
    (nextValue: boolean) => {
      if (nextValue && !isLocationEnabled) {
        void requestLocationPermission();
        return;
      }
      if (!nextValue && isLocationEnabled) {
        Linking.openSettings().catch(error => console.warn('[ProfilePanel] location settings', error));
      }
    },
    [isLocationEnabled, requestLocationPermission],
  );

  const handleToggleInterest = useCallback(
    (topicKey: (typeof INTEREST_TOPICS)[number]['key']) => {
      const current = new Set(interestTopics);
      if (current.has(topicKey)) {
        current.delete(topicKey);
      } else {
        current.add(topicKey);
      }
      profile.setPreferences({ interestTopics: Array.from(current) });
    },
    [interestTopics, profile],
  );

  const handleSync = useCallback(async () => {
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

  const handleLogin = useCallback(() => {
    Linking.openURL('https://trainar.app/login').catch(error => console.warn('[ProfilePanel] login', error));
  }, []);

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
    return 'Aktivera aviseringar för störningar.';
  }, [canRequestNotifications, notificationStatus]);

  const locationMessage = useMemo(() => {
    if (locationPermission === 'granted') {
      return 'Platstjänster är aktiverade.';
    }
    if (canRequestLocation) {
      return 'Tillåt platstjänster för att visa avstånd.';
    }
    return 'Aktivera platstjänster i inställningarna.';
  }, [canRequestLocation, locationPermission]);

  const lastSyncLabel = lastReloadedAt
    ? lastReloadedAt.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
    : 'Aldrig';

  const recommendedEvents = useMemo<
    Array<{ event: TrafficEvent; distanceKm: number | null; score: number }>
  >(() => {
    if (!trafficEvents?.length) {
      return [];
    }
    const threshold = SEVERITY_RANK[profile.preferences.impactThreshold as ImpactLevel] ?? 1;
    return trafficEvents
      .filter(event => SEVERITY_RANK[event.severity as ImpactLevel] >= threshold)
      .map(event => {
        const distanceKm = userCoords ? computeEventDistance(event, userCoords) : null;
        const distanceScore =
          typeof distanceKm === 'number'
            ? Math.max(0, 1 - Math.min(distanceKm, 250) / 250)
            : isLocationEnabled
              ? 0.18
              : 0.1;
        const severityScore = (SEVERITY_RANK[event.severity as ImpactLevel] + 1) / 4;
        const haystack = `${event.title} ${event.description ?? ''} ${event.segment ?? ''}`.toLowerCase();
        const interestScore = interestTopics.reduce((score, topic) => {
          const keywords = INTEREST_KEYWORDS[topic as keyof typeof INTEREST_KEYWORDS] ?? [topic];
          return keywords.some(keyword => haystack.includes(keyword.toLowerCase())) ? score + 0.12 : score;
        }, 0);
        const regionalBoost =
          profile.preferences.defaultRegion !== 'Sverige' && event.segment
            ? event.segment.toLowerCase().includes(profile.preferences.defaultRegion.toLowerCase())
              ? 0.05
              : 0
            : 0;
        const combinedScore =
          distanceScore * 0.55 + severityScore * 0.35 + interestScore + regionalBoost;
        return { event, distanceKm, score: combinedScore };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  }, [
    trafficEvents,
    profile.preferences.impactThreshold,
    profile.preferences.defaultRegion,
    interestTopics,
    userCoords,
    isLocationEnabled,
  ]);

  useEffect(() => {
    recommendedEvents.forEach(entry => {
      ensureTrafficSummary(entry.event);
    });
  }, [ensureTrafficSummary, recommendedEvents]);

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
          contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPadding + 20 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.heroBlock}>
            <View style={[styles.avatar, { borderColor: accentColor }]}>
              <Text style={styles.avatarLabel}>
                {profile.user.name ? profile.user.name.charAt(0) : 'G'}
              </Text>
            </View>
            <View style={styles.heroText}>
              <Text style={styles.heroName}>{profile.user.name ?? 'Gäst'}</Text>
              <Text style={styles.heroTierLabel}>Medlemsnivå</Text>
              <Text style={styles.heroTier}>{profile.user.tier}</Text>
            </View>
            <View style={[styles.heroBadge, { borderColor: accentColor }]}>
              <Text style={[styles.heroBadgeText, { color: accentColor }]}>
                {profile.user.authenticated ? 'Inloggad' : 'Gäst'}
              </Text>
            </View>
          </View>

          {!profile.user.authenticated && (
            <Pressable onPress={handleLogin} style={styles.loginButton}>
              <Text style={styles.loginButtonText}>Logga in / skapa konto</Text>
            </Pressable>
          )}

          <View style={styles.metaRow}>
            <View style={[styles.metaItem, styles.metaItemLeft]}>
              <Text style={styles.metaLabel}>Favoriter</Text>
              <Text style={[styles.metaValue, { color: accentColor }]}>{totalFavorites}</Text>
              <Text style={styles.metaSub}>
                Tåg {favoriteTrains.length} · Stationer {savedStations.length}
              </Text>
            </View>
            <View style={[styles.metaItem, styles.metaItemRight]}> 
              <Text style={styles.metaLabel}>Aviseringar</Text>
              <Text style={[styles.metaValue, { color: accentColor }]}>
                {isNotificationEnabled ? 'Aktiva' : 'Inaktiva'}
              </Text>
              <Text style={styles.metaSub}>
                {notificationReason} · Tröskel {IMPACT_LABELS[profile.preferences.impactThreshold]}
              </Text>
            </View>
          </View>

          {profile.loading && !profile.error ? (
            <View style={styles.loadingSection}>
              <ActivityIndicator color="#fff" />
              <Text style={styles.loadingLabel}>Hämtar profilinformation…</Text>
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

          <View style={styles.section}> 
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Favoriter och historik</Text>
              <Text style={styles.sectionSub}>Snabbt till dina tåg</Text>
            </View>

            {favoriteTrains.length === 0 && recentTrains.length === 0 && savedStations.length === 0 && !profile.loading ? (
              <View style={styles.placeholderCard}>
                <Text style={styles.placeholderTitle}>Inget sparat ännu</Text>
                <Text style={styles.placeholderText}>Sök upp ett tåg och spara för att få snabb åtkomst här.</Text>
                <Text style={styles.placeholderHint}>
                  Använd sökfliken för att hitta ett tåg och tryck på stjärnan för att lägga till det i favoriter.
                </Text>
              </View>
            ) : null}

            {favoriteTrains.map(train => (
              <View key={`fav-${train.id}`} style={styles.trainCard}> 
                <View style={styles.cardRow}>
                  <View style={styles.iconCircle}>
                    <TrainFront size={18} color="#fff" strokeWidth={2.2} />
                  </View>
                  <View style={styles.cardBody}>
                    <Text style={styles.cardTitle}>{train.title}</Text>
                    <Text style={styles.cardSubtitle}>{train.subtitle ?? 'Operatör saknas'}</Text>
                    <Text style={styles.cardRoute}>{train.routeText ?? 'Rutt saknas'}</Text>
                  </View>
                  {train.routeText ? (
                    <View style={styles.directionChip}> 
                      <Text style={styles.directionChipText}>{train.routeText}</Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.cardActions}>
                  <Pressable onPress={() => handleOpenTrain(train.train)} style={styles.actionButton}>
                    <Text style={styles.actionLabel}>Visa på karta</Text>
                  </Pressable>
                  <Pressable onPress={() => handleToggleFavorite(train.id)} style={styles.actionButton}>
                    <Text style={styles.actionLabel}>Ta bort</Text>
                  </Pressable>
                </View>
              </View>
            ))}

            {recentTrains.map(({ entry, detail }) => (
              <View key={`recent-${detail.id}`} style={styles.trainCard}> 
                <View style={styles.cardRow}>
                  <View style={styles.iconCircleSecondary}>
                    <TrainFront size={18} color="#fff" strokeWidth={2.2} />
                  </View>
                  <View style={styles.cardBody}>
                    <Text style={styles.cardTitle}>{detail.title}</Text>
                    <Text style={styles.cardSubtitle}>{detail.subtitle ?? 'Operatör saknas'}</Text>
                    <Text style={styles.cardRoute}>{formatRelativeTime(entry.lastViewedAt)}</Text>
                  </View>
                  {detail.routeText ? (
                    <View style={styles.directionChip}> 
                      <Text style={styles.directionChipText}>{detail.routeText}</Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.cardActions}>
                  <Pressable onPress={() => handleOpenTrain(detail.train)} style={styles.actionButton}>
                    <Text style={styles.actionLabel}>Visa på karta</Text>
                  </Pressable>
                  <Pressable onPress={() => handleRemoveRecent(detail.id)} style={styles.actionButton}>
                    <Text style={styles.actionLabel}>Ta bort</Text>
                  </Pressable>
                </View>
              </View>
            ))}

            {savedStations.map(station => (
              <BlurView key={station.id} intensity={65} tint="dark" style={styles.savedCard}> 
                <View style={styles.savedRow}>
                  <View style={styles.savedIcon}>
                    <TrainFront size={16} color="#fff" strokeWidth={2} />
                  </View>
                  <View style={styles.savedBody}>
                    <Text style={styles.savedLabel}>{station.label}</Text>
                    <Text style={styles.savedSub}>{station.direction}</Text>
                  </View>
                  <Pressable onPress={() => handleRemoveStation(station.id)} style={styles.stationAction}>
                    <Text style={styles.stationActionText}>Ta bort</Text>
                  </Pressable>
                </View>
              </BlurView>
            ))}
          </View>

          <View style={styles.section}> 
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Aviseringar & plats</Text>
              <Text style={styles.sectionSub}>Plats + nivå styr vad som prioriteras</Text>
            </View>
            <View style={styles.permissionGrid}>
              <View style={styles.permissionCard}>
                <View style={styles.permissionText}> 
                  <Text style={styles.permissionTitle}>Pushnotiser</Text>
                  <Text style={styles.permissionSubtitle}>{isNotificationEnabled ? 'Aktivt' : 'Inaktivt'}</Text>
                  <Text style={styles.permissionReason}>{notificationReason}</Text>
                  <Text style={styles.permissionHint}>
                    Tröskel: {IMPACT_LABELS[profile.preferences.impactThreshold]}
                  </Text>
                </View>
                <View style={styles.permissionControls}>
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
                      styles.permissionButton,
                      styles.permissionMiniButton,
                      (!canRequestNotifications && !isNotificationEnabled) && styles.permissionButtonDisabled,
                      pressed && styles.permissionButtonPressed,
                    ]}
                  >
                    <Text style={styles.permissionButtonText}>
                      {isNotificationEnabled ? 'Hantera' : notificationRequesting ? 'Begär…' : 'Aktivera'}
                    </Text>
                  </Pressable>
                </View>
              </View>
              <View style={styles.permissionCard}>
                <View style={styles.permissionText}>
                  <Text style={styles.permissionTitle}>Platstjänster</Text>
                  <Text style={styles.permissionSubtitle}>{locationMessage}</Text>
                  {locationError ? <Text style={styles.permissionReason}>{locationError}</Text> : null}
                </View>
                <View style={styles.permissionControls}>
                  <Switch
                    value={isLocationEnabled}
                    onValueChange={handleLocationToggle}
                    disabled={!canRequestLocation && !isLocationEnabled}
                    thumbColor={isLocationEnabled ? accentColor : '#f2f2f2'}
                    trackColor={{ false: 'rgba(255,255,255,0.12)', true: 'rgba(255,255,255,0.25)' }}
                    ios_backgroundColor="rgba(255,255,255,0.12)"
                  />
                  <Pressable
                    onPress={isLocationEnabled ? () => Linking.openSettings().catch(error => console.warn(error)) : requestLocationPermission}
                    disabled={!canRequestLocation && !isLocationEnabled}
                    style={({ pressed }) => [
                      styles.permissionButton,
                      styles.permissionMiniButton,
                      (!canRequestLocation && !isLocationEnabled) && styles.permissionButtonDisabled,
                      pressed && styles.permissionButtonPressed,
                    ]}
                  >
                    <Text style={styles.permissionButtonText}>
                      {isLocationEnabled ? 'Hantera' : requestingLocation ? 'Begär…' : 'Dela plats'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>

            <View style={styles.preferenceCard}>
              <Text style={styles.preferenceLabel}>Trafiknotiser vid</Text>
              <Text style={styles.preferenceHelper}>Välj minsta allvar för att trigga en notis.</Text>
              <View style={styles.chipRow}>
                {IMPACT_OPTIONS.map(option => (
                  <Pressable
                    key={option}
                    onPress={() => profile.setPreferences({ impactThreshold: option })}
                    style={({ pressed }) => [
                      styles.preferenceChip,
                      profile.preferences.impactThreshold === option && {
                        borderColor: accentColor,
                        backgroundColor: 'rgba(255,255,255,0.12)',
                      },
                      pressed && styles.preferenceChipPressed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.preferenceChipText,
                        profile.preferences.impactThreshold === option && { color: '#fff' },
                      ]}
                    >
                      {IMPACT_LABELS[option]}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Respreferenser</Text>
              <Text style={styles.sectionSub}>Svaren styr AI-sortering tillsammans med plats</Text>
            </View>
            <View style={styles.preferenceCard}>
              <Text style={styles.preferenceLabel}>Pendlingstid</Text>
              <View style={styles.chipRow}>
                {COMMUTE_WINDOWS.map(option => (
                  <Pressable
                    key={option}
                    onPress={() => profile.setPreferences({ commuteWindow: option })}
                    style={({ pressed }) => [
                      styles.preferenceChip,
                      profile.preferences.commuteWindow === option && {
                        borderColor: accentColor,
                        backgroundColor: 'rgba(255,255,255,0.12)',
                      },
                      pressed && styles.preferenceChipPressed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.preferenceChipText,
                        profile.preferences.commuteWindow === option && { color: '#fff' },
                      ]}
                    >
                      {option}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <View style={styles.preferenceCard}>
              <Text style={styles.preferenceLabel}>Standardregion</Text>
              <View style={styles.chipRow}>
                {REGION_OPTIONS.map(option => (
                  <Pressable
                    key={option}
                    onPress={() => profile.setPreferences({ defaultRegion: option })}
                    style={({ pressed }) => [
                      styles.preferenceChip,
                      profile.preferences.defaultRegion === option && {
                        borderColor: accentColor,
                        backgroundColor: 'rgba(255,255,255,0.12)',
                      },
                      pressed && styles.preferenceChipPressed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.preferenceChipText,
                        profile.preferences.defaultRegion === option && { color: '#fff' },
                      ]}
                    >
                      {option}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
            {profile.user.authenticated ? (
              <View style={styles.preferenceCard}>
                <Text style={styles.preferenceLabel}>Vad ska vi prioritera?</Text>
                <Text style={styles.preferenceHelper}>
                  AI väger dessa intressen tillsammans med din plats för att visa viktigast först.
                </Text>
                <View style={styles.chipRow}>
                  {INTEREST_TOPICS.map(topic => {
                    const selected = interestTopics.includes(topic.key);
                    return (
                      <Pressable
                        key={topic.key}
                        onPress={() => handleToggleInterest(topic.key)}
                        style={({ pressed }) => [
                          styles.preferenceChip,
                          selected && {
                            borderColor: accentColor,
                            backgroundColor: 'rgba(255,255,255,0.12)',
                          },
                          pressed && styles.preferenceChipPressed,
                        ]}
                      >
                        <Text
                          style={[
                            styles.preferenceChipText,
                            selected && { color: '#fff' },
                          ]}
                        >
                          {topic.label}
                        </Text>
                        <Text style={styles.preferenceChipHint}>{topic.hint}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : (
              <View style={styles.preferenceCard}>
                <Text style={styles.preferenceLabel}>Personliga intressen</Text>
                <Text style={styles.preferenceHelper}>
                  Logga in för att berätta vad som är viktigt så att vi kan prio-sätta din trafikinfo.
                </Text>
              </View>
            )}
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Relaterad trafikinformation</Text>
              <Text style={styles.sectionSub}>AI väljer ut händelser nära dig och dina val</Text>
            </View>

            {!isLocationEnabled ? (
              <View style={styles.infoBanner}>
                <View style={styles.infoBannerHeader}>
                  <Text style={styles.infoBannerTitle}>Bäst med plats aktiverad</Text>
                  <Text style={styles.infoBannerText}>
                    Vi utgår alltid från din position och kompletterar med dina preferenser.
                  </Text>
                </View>
                <Pressable
                  onPress={requestLocationPermission}
                  disabled={!canRequestLocation}
                  style={({ pressed }) => [
                    styles.infoBannerAction,
                    pressed && styles.permissionButtonPressed,
                    !canRequestLocation && styles.permissionButtonDisabled,
                  ]}
                >
                  <Text style={styles.permissionButtonText}>Aktivera plats</Text>
                </Pressable>
              </View>
            ) : null}

            {trafficLoading ? (
              <View style={styles.loadingSection}>
                <ActivityIndicator color="#fff" />
                <Text style={styles.loadingLabel}>Letar efter trafik nära dig…</Text>
              </View>
            ) : null}

            {trafficError ? <Text style={styles.permissionReason}>{trafficError}</Text> : null}

            {recommendedEvents.length === 0 && !trafficLoading ? (
              <View style={styles.placeholderCard}>
                <Text style={styles.placeholderTitle}>Inga relevanta händelser just nu</Text>
                <Text style={styles.placeholderText}>
                  Vi visar upp till tre störningar som matchar din plats och dina svar.
                </Text>
              </View>
            ) : null}

            {recommendedEvents.map(({ event, distanceKm }) => {
              const aiSummary = trafficSummaries[event.id];
              return (
                <View key={`traffic-${event.id}`} style={styles.trafficCard}>
                  <View style={styles.trafficCardHeader}>
                    <View style={styles.trafficBadge}>
                      <Text style={styles.trafficBadgeLabel}>AI-vald</Text>
                    </View>
                    <Text style={styles.trafficDistance}>
                      {typeof distanceKm === 'number'
                        ? formatDistanceLabel(distanceKm)
                        : 'Dela plats för exakt läge'}
                    </Text>
                  </View>
                  <Text style={styles.trafficTitle}>{event.title}</Text>
                  <Text style={styles.trafficMeta}>
                    {IMPACT_LABELS[event.severity]}
                    {event.impactLabel ? ` · ${event.impactLabel}` : ''}
                    {event.segment ? ` · ${event.segment}` : ''}
                  </Text>
                  {aiSummary?.summary ? (
                    <Text style={styles.trafficSummary}>{aiSummary.summary}</Text>
                  ) : event.description ? (
                    <Text style={styles.trafficSummary}>{event.description}</Text>
                  ) : null}
                  {aiSummary?.advice ? (
                    <Text style={styles.trafficAdvice}>{aiSummary.advice}</Text>
                  ) : null}
                  <View style={styles.trafficFooter}>
                    <View
                      style={[
                        styles.eventSeverityDot,
                        { backgroundColor: SEVERITY_COLORS[event.severity as ImpactLevel] },
                      ]}
                    />
                    <Text style={styles.trafficFooterText}>
                      Plats + {interestTopics.length ? 'intressen' : 'inställningar'} styr prioritering
                    </Text>
                  </View>
                </View>
              );
            })}
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
                <Text style={styles.supportActionText}>Integritetsinställningar</Text>
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
    gap: 16,
    flexGrow: 1,
  },
  heroBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: 'rgba(255,255,255,0.3)',
  },
  avatarLabel: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 24,
  },
  heroText: {
    flex: 1,
  },
  heroName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  heroTierLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  heroTier: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
  },
  heroBadge: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  heroBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  loginButton: {
    alignSelf: 'flex-start',
    marginVertical: 4,
    paddingHorizontal: 14,
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
  metaRow: {
    flexDirection: 'row',
    gap: 12,
  },
  metaItem: {
    flex: 1,
    borderRadius: 16,
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  metaItemLeft: {
    paddingRight: 8,
  },
  metaItemRight: {
    alignItems: 'flex-end',
    paddingLeft: 8,
  },
  metaLabel: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  metaValue: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  metaSub: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 12,
  },
  loadingSection: {
    alignItems: 'center',
    paddingVertical: 16,
    gap: 6,
  },
  loadingLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
  },
  errorState: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,96,96,0.4)',
    backgroundColor: 'rgba(255,96,96,0.08)',
    padding: 14,
    gap: 6,
  },
  errorTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  errorSubtitle: {
    color: 'rgba(255,255,255,0.8)',
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
  placeholderCard: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 16,
    alignItems: 'center',
    backgroundColor: 'rgba(6,12,24,0.5)',
  },
  placeholderTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  placeholderText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
  },
  placeholderHint: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.55)',
    textAlign: 'center',
    marginTop: 6,
  },
  trainCard: {
    borderRadius: 18,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(6,12,24,0.58)',
    gap: 10,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleSecondary: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: {
    flex: 1,
  },
  cardTitle: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
  cardSubtitle: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
  },
  cardRoute: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
  },
  directionChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  directionChipText: {
    color: '#fff',
    fontSize: 10,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  actionLabel: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  savedCard: {
    borderRadius: 16,
    padding: 12,
    backgroundColor: 'rgba(6,12,24,0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  savedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  savedIcon: {
    width: 32,
    height: 32,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedBody: {
    flex: 1,
  },
  savedLabel: {
    color: '#fff',
    fontWeight: '600',
  },
  savedSub: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
  },
  stationAction: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  stationActionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  permissionGrid: {
    gap: 10,
  },
  permissionCard: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(6,12,24,0.55)',
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  permissionText: {
    flex: 1,
    gap: 4,
  },
  permissionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  permissionSubtitle: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 12,
  },
  permissionReason: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
  },
  permissionHint: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
  },
  permissionControls: {
    alignItems: 'flex-end',
    gap: 8,
  },
  permissionButton: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  permissionMiniButton: {
    paddingHorizontal: 12,
  },
  permissionButtonPressed: {
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  permissionButtonDisabled: {
    opacity: 0.5,
  },
  permissionButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  preferenceCard: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(6,12,24,0.5)',
    padding: 12,
    gap: 8,
  },
  preferenceLabel: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.75)',
  },
  preferenceHelper: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.55)',
    lineHeight: 16,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  preferenceChip: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.25)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.02)',
    gap: 2,
  },
  preferenceChipPressed: {
    opacity: 0.7,
  },
  preferenceChipText: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 12,
    fontWeight: '600',
  },
  preferenceChipHint: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 10,
  },
  infoBanner: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(6,12,24,0.65)',
    padding: 12,
    gap: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  infoBannerHeader: {
    flex: 1,
    gap: 4,
  },
  infoBannerTitle: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  infoBannerText: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 12,
    lineHeight: 17,
  },
  infoBannerAction: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignSelf: 'center',
  },
  trafficCard: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(6,12,24,0.58)',
    padding: 14,
    gap: 8,
  },
  trafficCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  trafficBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  trafficBadgeLabel: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  trafficDistance: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
  },
  trafficTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  trafficMeta: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
  },
  trafficSummary: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 13,
    lineHeight: 18,
  },
  trafficAdvice: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    fontStyle: 'italic',
  },
  eventSeverityDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  trafficFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  trafficFooterText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
  },
  supportCard: {
    borderRadius: 18,
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

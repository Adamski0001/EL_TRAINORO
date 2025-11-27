import { BlurView } from 'expo-blur';
import { X } from 'lucide-react-native';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { deriveAccentColor } from '../../lib/deriveAccentColor';
import { trainRouteRegistry, type RouteInfo } from '../../state/trainRouteRegistry';
import { useTrainPositions } from '../../hooks/useTrainPositions';
import { useTrafficEvents } from '../../hooks/useTrafficEvents';
import type { TrainPosition } from '../../types/trains';
import type { TrafficEvent } from '../../types/traffic';
import type {
  Station,
  StationCoordinate,
  StationTrafficVolume,
} from '../../types/stations';
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

const TIMELINE_COLUMN_WIDTH = 26;
const STOP_ROW_HORIZONTAL_PADDING = 16;
const RAIL_TRACK_LEFT = STOP_ROW_HORIZONTAL_PADDING;
const RAIL_LINE_WIDTH = 3;
const RAIL_TRACK_INSET = 2;
const RAIL_TIE_HEIGHT = 4;
const RAIL_TIE_OVERHANG = 4;
const RAIL_SLEEPER_WIDTH =
  TIMELINE_COLUMN_WIDTH - RAIL_TRACK_INSET * 2 + RAIL_TIE_OVERHANG * 2;
const RAIL_SLEEPER_LEFT = RAIL_TRACK_LEFT + RAIL_TRACK_INSET - RAIL_TIE_OVERHANG;
const RAIL_TIES_PER_GAP = 4;
const MIN_RAIL_SLEEPERS = 20;
const EARTH_RADIUS_METERS = 6_371_000;

type TabKey = 'departures' | 'arrivals';

const TAB_KEYS: TabKey[] = ['departures', 'arrivals'];
const TAB_LABELS: Record<TabKey, string> = {
  departures: 'Avgående',
  arrivals: 'Ankommande',
};

const CROWDING_MAP: Record<
  StationTrafficVolume,
  { label: string; description: string; color: string }
> = {
  high: { label: 'Fullt', description: 'Mycket folk – räkna med köer.', color: '#FF8A3D' },
  medium: { label: 'Rörligt', description: 'Normal nivå med tryggt avstånd.', color: '#62CDFF' },
  low: { label: 'Lugnt', description: 'Gott om plats och snabba byten.', color: '#8EF4A7' },
};

const TRAFFIC_SEVERITY_COLORS: Record<TrafficEvent['severity'], string> = {
  critical: '#FF5B5B',
  high: '#FF8A3D',
  medium: '#FFD166',
  low: '#7DD87C',
};

type StationTrainEntry = {
  id: string;
  label: string;
  operator: string | null;
  routeLabel: string;
  updatedLabel: string;
  updatedAt: number | null;
  distanceLabel: string | null;
  distanceMeters: number | null;
  direction: TabKey;
  train: TrainPosition;
};

const toRadians = (value: number) => (value * Math.PI) / 180;

const computeDistanceMeters = (from: StationCoordinate, to: StationCoordinate) => {
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
};

const computeBearing = (from: StationCoordinate, to: StationCoordinate) => {
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return (bearing + 360) % 360;
};

const normalizeBearing = (bearing?: number | null) => {
  if (bearing === null || bearing === undefined || Number.isNaN(bearing)) {
    return null;
  }
  return ((bearing % 360) + 360) % 360;
};

const angularDifference = (a: number, b: number) => {
  let diff = Math.abs(a - b) % 360;
  if (diff > 180) {
    diff = 360 - diff;
  }
  return diff;
};

const formatDistanceLabel = (meters: number) => {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
};

const formatUpdatedLabel = (timestamp: number | null) => {
  if (!timestamp || Number.isNaN(timestamp)) {
    return 'Uppdaterad nyligen';
  }
  const diffMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (diffMinutes < 1) {
    return 'Uppdaterad nyss';
  }
  if (diffMinutes < 60) {
    return `Uppdaterad ${diffMinutes} min sedan`;
  }
  const hours = Math.floor(diffMinutes / 60);
  const remainder = diffMinutes % 60;
  if (remainder === 0) {
    return `Uppdaterad ${hours} h sedan`;
  }
  return `Uppdaterad ${hours} h ${remainder} min sedan`;
};

const buildTrainRouteLabel = (route: RouteInfo | null, train: TrainPosition) => {
  if (route?.from && route?.to) {
    return `${route.from} → ${route.to}`;
  }
  if (route?.from && !route?.to) {
    return `Från ${route.from}`;
  }
  if (!route?.from && route?.to) {
    return `Mot ${route.to}`;
  }
  return `Tåg ${train.label}`;
};

const determineTrainDirection = (
  train: TrainPosition,
  stationSignature: string,
  stationCoordinate: StationCoordinate | null,
  route: RouteInfo | null,
): TabKey | null => {
  if (route?.to === stationSignature) {
    return 'arrivals';
  }
  if (route?.from === stationSignature) {
    return 'departures';
  }
  if (!stationCoordinate || !train.coordinate) {
    return null;
  }
  const distance = computeDistanceMeters(train.coordinate, stationCoordinate);
  if (distance > 11_000) {
    return null;
  }
  const heading = normalizeBearing(train.bearing);
  if (heading === null) {
    return null;
  }
  const bearingToStation = computeBearing(train.coordinate, stationCoordinate);
  const diff = angularDifference(heading, bearingToStation);
  if (diff <= 110) {
    return 'arrivals';
  }
  return 'departures';
};

type StationPanelProps = {
  station: Station;
  visible: boolean;
  initialSnap?: Exclude<TrafficSheetSnapPoint, 'hidden'>;
  onClose: () => void;
  onSnapPointChange?: (point: TrafficSheetSnapPoint) => void;
  onOpenTrain: (train: TrainPosition) => void;
};

function StationPanelComponent({
  station,
  visible,
  initialSnap = 'half',
  onClose,
  onSnapPointChange,
  onOpenTrain,
}: StationPanelProps) {
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(SHEET_SNAP_POINTS.hidden);
  const startY = useSharedValue(SHEET_SNAP_POINTS.hidden);
  const [activeTab, setActiveTab] = useState<TabKey>('departures');
  const onCloseRef = useRef(onClose);
  const onSnapPointChangeRef = useRef(onSnapPointChange);
  const { trains } = useTrainPositions();
  const { events } = useTrafficEvents();
  const routeSnapshot = useSyncExternalStore(
    trainRouteRegistry.subscribe,
    () => trainRouteRegistry.getSnapshot(),
    () => trainRouteRegistry.getSnapshot(),
  );

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    onSnapPointChangeRef.current = onSnapPointChange;
  }, [onSnapPointChange]);

  useEffect(() => {
    setActiveTab('departures');
  }, [station.id]);

  const accent = useMemo(() => deriveAccentColor(station.signature), [station.signature]);
  const displayName = station.displayNames[0] ?? station.displayName ?? station.signature;
  const crowding = CROWDING_MAP[station.trafficVolume];
  const crowdingLabel = crowding?.label ?? 'Okänt';
  const crowdingDescription = crowding?.description ?? 'Ingen aktuell prognos.';
  const crowdingColor = crowding?.color ?? '#62CDFF';

  const trainGroups = useMemo(() => {
    const arrivals: StationTrainEntry[] = [];
    const departures: StationTrainEntry[] = [];
    const normalizedSignature = station.signature.trim();
    const now = Date.now();

    trains.forEach(train => {
      const route = trainRouteRegistry.getRoute(train.id);
      const direction = determineTrainDirection(train, normalizedSignature, station.coordinate, route);
      if (!direction) {
        return;
      }
      const updatedAt = Number.isNaN(Date.parse(train.updatedAt)) ? now : Date.parse(train.updatedAt);
      const distanceMeters =
        station.coordinate && train.coordinate
          ? computeDistanceMeters(train.coordinate, station.coordinate)
          : null;
      const entry: StationTrainEntry = {
        id: train.id,
        label: train.label,
        operator: train.trainOwner ?? null,
        routeLabel: buildTrainRouteLabel(route, train),
        updatedLabel: formatUpdatedLabel(updatedAt),
        updatedAt,
        distanceLabel: distanceMeters !== null ? formatDistanceLabel(distanceMeters) : null,
        distanceMeters,
        direction,
        train,
      };
      if (direction === 'arrivals') {
        arrivals.push(entry);
      } else {
        departures.push(entry);
      }
    });

    const sortEntries = (list: StationTrainEntry[]) =>
      list.sort((a, b) => {
        if (a.distanceMeters !== null && b.distanceMeters !== null) {
          return a.distanceMeters - b.distanceMeters;
        }
        if (a.distanceMeters !== null) {
          return -1;
        }
        if (b.distanceMeters !== null) {
          return 1;
        }
        if (a.updatedAt !== null && b.updatedAt !== null) {
          return a.updatedAt - b.updatedAt;
        }
        return 0;
      });

    sortEntries(arrivals);
    sortEntries(departures);
    return { arrivals, departures };
  }, [
    trains,
    station.signature,
    station.coordinate?.latitude,
    station.coordinate?.longitude,
    routeSnapshot.version,
  ]);

  const activeList = activeTab === 'departures' ? trainGroups.departures : trainGroups.arrivals;
  const stationEvents = useMemo(() => {
    const normalized = station.signature.trim();
    if (!normalized) {
      return [];
    }
    return events
      .filter(event => event.stations.some(stationEntry => stationEntry.signature === normalized))
      .slice(0, 2);
  }, [events, station.signature]);

  const handleTabPress = useCallback((key: TabKey) => {
    setActiveTab(key);
  }, []);

  const handleTrainPress = useCallback(
    (entry: StationTrainEntry) => {
      onOpenTrain(entry.train);
    },
    [onOpenTrain],
  );

  const handleSnapComplete = useCallback((snap: TrafficSheetSnapPoint) => {
    onSnapPointChangeRef.current?.(snap);
    if (snap === 'hidden') {
      onCloseRef.current?.();
    }
  }, []);

  useEffect(() => {
    const target: TrafficSheetSnapPoint = visible ? initialSnap : 'hidden';
    translateY.value = withTiming(
      SHEET_SNAP_POINTS[target],
      SHEET_TIMING_CONFIG,
      finished => {
        if (finished) {
          runOnJS(handleSnapComplete)(target);
        }
      },
    );
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
          translateY.value = withTiming(
            SHEET_SNAP_POINTS[target],
            SHEET_TIMING_CONFIG,
            finished => {
              if (finished) {
                runOnJS(handleSnapComplete)(target);
              }
            },
          );
        }),
    [handleSnapComplete, startY, translateY, visible],
  );

  const animatedStyle = useAnimatedStyle(() => ({
    top: translateY.value,
  }));

  const bottomPadding = Math.max(insets.bottom, 24);

  const distanceDotStyle = (direction: TabKey) =>
    direction === 'arrivals' ? styles.timelineDotArriving : styles.timelineDotDeparting;

  const eventList = stationEvents.map(event => (
    <View key={event.id} style={styles.eventCard}>
      <View style={styles.eventHeader}>
        <View style={styles.eventSeverityRow}>
          <View
            style={[
              styles.eventSeverityDot,
              { backgroundColor: TRAFFIC_SEVERITY_COLORS[event.severity] },
            ]}
          />
          <Text style={styles.eventSeverityText}>{event.severity}</Text>
        </View>
        {event.impactLabel ? (
          <Text style={styles.eventImpactLabel}>{event.impactLabel}</Text>
        ) : null}
      </View>
      <Text style={styles.eventTitle}>{event.title}</Text>
      {event.description ? (
        <Text style={styles.eventDescription}>{event.description}</Text>
      ) : null}
    </View>
  ));

  const tabButtons = TAB_KEYS.map(key => (
    <Pressable
      key={key}
      onPress={() => handleTabPress(key)}
      style={({ pressed }) => [
        styles.tabButton,
        activeTab === key && styles.tabButtonActive,
        pressed && styles.tabButtonPressed,
      ]}
    >
      <Text style={[styles.tabLabel, activeTab === key && styles.tabLabelActive]}>
        {TAB_LABELS[key]}
      </Text>
      <Text style={styles.tabCount}>{trainGroups[key].length} tåg</Text>
    </Pressable>
  ));

  return (
    <Animated.View pointerEvents="box-none" style={[styles.container, animatedStyle]}>
      <BlurView intensity={85} tint="dark" style={[styles.sheet, { paddingBottom: bottomPadding }]}>
        <GestureDetector gesture={panGesture}>
          <View style={styles.dragZone}>
            <View style={styles.handle} />
            <View style={styles.sheetHeader}>
                <View style={styles.titleBlock}>
                  <Text style={styles.sheetTitle}>{displayName}</Text>
                  <Text style={styles.sheetSubtitle}>{station.signature}</Text>
                </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  translateY.value = withTiming(
                    SHEET_SNAP_POINTS.hidden,
                    SHEET_TIMING_CONFIG,
                    finished => {
                      if (finished) {
                        runOnJS(handleSnapComplete)('hidden');
                      }
                    },
                  );
                }}
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
          nestedScrollEnabled
        >
          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Trängsel</Text>
              <Text style={[styles.metaValue, { color: crowdingColor }]}>{crowdingLabel}</Text>
              <Text style={styles.metaSub}>{crowdingDescription}</Text>
            </View>
            <View style={[styles.metaItem, styles.metaItemRight]}>
              <Text style={styles.metaLabel}>Region</Text>
              <Text style={styles.metaValue}>{station.region}</Text>
              <Text style={styles.metaSub}>
                {station.trafficVolume.charAt(0).toUpperCase() + station.trafficVolume.slice(1)} trafik
              </Text>
            </View>
          </View>

          <View style={styles.tabRow}>{tabButtons}</View>

          <BlurView intensity={60} tint="dark" style={styles.stopList}>
            <View pointerEvents="none" style={styles.railLineContainer}>
              <View style={styles.railLine} />
              <View style={styles.railLine} />
            </View>
            <View pointerEvents="none" style={styles.railSleeperLayer}>
              {Array.from(
                { length: Math.max((activeList.length + 1) * RAIL_TIES_PER_GAP, MIN_RAIL_SLEEPERS) },
                (_, index) => (
                  <View key={`sleeper-${index}`} style={styles.railTie} />
                ),
              )}
            </View>
            {activeList.length ? (
              activeList.map((entry, index) => {
                const operatorLabel = entry.operator ?? entry.routeLabel ?? 'Operatör saknas';
                return (
                  <Pressable
                    key={entry.id}
                    onPress={() => handleTrainPress(entry)}
                    style={({ pressed }) => [
                      styles.stopRow,
                      index !== activeList.length - 1 && styles.stopRowDivider,
                      pressed && styles.stopRowPressed,
                    ]}
                  >
                    <View style={styles.timelineColumn}>
                      <View
                        style={[
                          styles.timelineConnector,
                          index === 0 && styles.connectorHidden,
                        ]}
                      />
                      <View style={[styles.timelineDot, distanceDotStyle(entry.direction)]} />
                      <View
                        style={[
                          styles.timelineConnector,
                          index === activeList.length - 1 && styles.connectorHidden,
                        ]}
                      />
                    </View>

                    <View style={styles.stopDetails}>
                      <Text style={styles.stopName} numberOfLines={1} ellipsizeMode="tail">
                        {entry.label}
                      </Text>
                      <Text style={styles.stopTrack} numberOfLines={1} ellipsizeMode="tail">
                        {entry.routeLabel}
                      </Text>
                    </View>

                    <View style={styles.stopTiming}>
                      <View style={styles.timeStack}>
                        <View style={styles.timeRow}>
                          <Text
                            style={[
                              styles.timeActual,
                              entry.direction === 'arrivals'
                                ? styles.timeActualArriving
                                : styles.timeActualDeparting,
                            ]}
                          >
                            {operatorLabel}
                          </Text>
                        </View>
                        {entry.distanceLabel ? (
                          <View style={styles.timeRow}>
                            <Text style={[styles.timePlanned, styles.timePlannedSub]}>
                              {entry.distanceLabel}
                            </Text>
                          </View>
                        ) : null}
                        <View style={styles.timeRow}>
                          <Text style={styles.stationUpdateLabel}>{entry.updatedLabel}</Text>
                        </View>
                      </View>
                    </View>
                  </Pressable>
                );
              })
            ) : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>
                  Inga {activeTab === 'departures' ? 'avgångar' : 'ankomster'} just nu
                </Text>
                <Text style={styles.emptySubtitle}>
                  Träffa nästa tåg direkt från kartan när vi får in tidtabeller.
                </Text>
              </View>
            )}
          </BlurView>

          {stationEvents.length ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Trafiknotiser</Text>
              <View style={styles.sectionBody}>{eventList}</View>
            </View>
          ) : null}

        </ScrollView>
      </BlurView>
    </Animated.View>
  );
}

export const StationPanel = memo(StationPanelComponent);

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'flex-end',
    pointerEvents: 'box-none',
    zIndex: 9998,
    elevation: 9998,
  },
  sheet: {
    flex: 1,
    width: '100%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: 'rgba(6,12,24,0.72)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowOffset: { width: 0, height: -4 },
    shadowRadius: 20,
    elevation: 18,
  },
  dragZone: {
    paddingHorizontal: 22,
    paddingBottom: 14,
    paddingTop: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    gap: 10,
  },
  handle: {
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignSelf: 'center',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  titleBlock: {
    flex: 1,
    gap: 4,
  },
  sheetTitle: {
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: '700',
  },
  sheetSubtitle: {
    color: 'rgba(255,255,255,0.68)',
    fontSize: 14,
    fontWeight: '600',
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 22,
    paddingVertical: 22,
    paddingBottom: 36,
    gap: 18,
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
    borderColor: 'rgba(255,255,255,0.05)',
  },
  metaItemRight: {
    alignItems: 'flex-end',
  },
  metaLabel: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  metaValue: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  metaSub: {
    color: 'rgba(255,255,255,0.6)',
    marginTop: 2,
    fontSize: 13,
  },
  tabRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 6,
  },
  tabButton: {
    flex: 1,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    justifyContent: 'center',
    gap: 2,
  },
  tabButtonActive: {
    borderColor: 'rgba(98,205,255,0.7)',
    backgroundColor: 'rgba(98,205,255,0.12)',
  },
  tabButtonPressed: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  tabLabel: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    fontWeight: '600',
  },
  tabLabelActive: {
    color: '#FFFFFF',
  },
  tabCount: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
  },
  stopList: {
    borderRadius: 20,
    backgroundColor: 'rgba(6,12,24,0.42)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
    position: 'relative',
  },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: STOP_ROW_HORIZONTAL_PADDING,
    paddingVertical: 12,
    gap: 12,
    position: 'relative',
    zIndex: 1,
  },
  stopRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  timelineColumn: {
    width: TIMELINE_COLUMN_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    position: 'relative',
    zIndex: 2,
  },
  timelineConnector: {
    flex: 1,
    width: 2,
    backgroundColor: 'transparent',
  },
  railLineContainer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: RAIL_TRACK_LEFT,
    width: TIMELINE_COLUMN_WIDTH,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: RAIL_TRACK_INSET,
    zIndex: 1,
  },
  railLine: {
    width: RAIL_LINE_WIDTH,
    height: '100%',
    backgroundColor: '#b3bcc6',
    borderRadius: RAIL_LINE_WIDTH / 2,
  },
  railSleeperLayer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: RAIL_SLEEPER_LEFT,
    width: RAIL_SLEEPER_WIDTH,
    justifyContent: 'space-between',
    paddingVertical: 12,
    zIndex: 0,
  },
  railTie: {
    height: RAIL_TIE_HEIGHT,
    borderRadius: RAIL_TIE_HEIGHT / 2,
    backgroundColor: '#6b4b2d',
    width: '100%',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  connectorHidden: {
    opacity: 0,
  },
  timelineDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: '#FFFFFF',
    zIndex: 3,
  },
  timelineDotArriving: {
    backgroundColor: '#62CDFF',
    borderColor: '#62CDFF',
  },
  timelineDotDeparting: {
    backgroundColor: '#FFE066',
    borderColor: '#FFE066',
  },
  stopDetails: {
    flex: 1,
    justifyContent: 'center',
    minWidth: 0,
  },
  stopName: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    flexShrink: 1,
    minWidth: 0,
  },
  stopTrack: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    marginTop: 2,
    flexShrink: 1,
  },
  stopTiming: {
    minWidth: 140,
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  timeStack: {
    gap: 8,
    alignItems: 'flex-end',
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timePlanned: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
  },
  timePlannedSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
  },
  timeActual: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  timeActualArriving: {
    color: '#62CDFF',
  },
  timeActualDeparting: {
    color: '#FFE066',
  },
  stationUpdateLabel: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
  },
  emptyState: {
    paddingVertical: 32,
    alignItems: 'center',
    gap: 6,
  },
  emptyTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  emptySubtitle: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 30,
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    color: '#F2F7FF',
    fontSize: 16,
    fontWeight: '600',
  },
  sectionBody: {
    gap: 12,
  },
  eventCard: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.06)',
    backgroundColor: 'rgba(6,12,24,0.45)',
    padding: 14,
    gap: 8,
  },
  eventHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  eventSeverityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  eventSeverityDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  eventSeverityText: {
    color: 'rgba(255,255,255,0.7)',
    textTransform: 'capitalize',
    fontSize: 12,
  },
  eventImpactLabel: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  eventTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  eventDescription: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    lineHeight: 18,
  },
  stopRowPressed: {
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
});

import { BlurView } from 'expo-blur';
import { X } from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
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

import { useTrainDetails } from '../../hooks/useTrainDetails';
import type { TrainPosition, TrainStop } from '../../types/trains';
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

type StopState = 'completed' | 'current' | 'upcoming';

type StopTimingInfo = {
  plannedLabel: string;
  actualLabel: string;
  hasDelay: boolean;
};

type RenderableStop = TrainStop & {
  etaMinutes: number | null;
  displayTime: string;
  timestamp: number | null;
  state: StopState;
  arrivalTiming: StopTimingInfo;
  departureTiming: StopTimingInfo;
};

const ACCENT_COLORS = ['#ffb703', '#fb8500', '#06d6a0', '#4cc9f0', '#f72585'];
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

const deriveAccentColor = (seed: string) => {
  if (!seed) {
    return ACCENT_COLORS[0];
  }
  const hash = Array.from(seed).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return ACCENT_COLORS[hash % ACCENT_COLORS.length];
};

const formatDisplayTime = (value: Date | null) => {
  if (!value) {
    return '—';
  }
  return value.toLocaleTimeString('sv-SE', {
    hour: '2-digit',
    minute: '2-digit',
  });
};

const buildTimingInfo = (
  planned: Date | null,
  actual: Date | null,
  estimated: Date | null,
): StopTimingInfo => {
  const plannedLabel = formatDisplayTime(planned);
  const actualSource = actual ?? estimated ?? planned ?? null;
  const actualLabel = formatDisplayTime(actualSource);
  const hasDelay = Boolean(planned && actualSource && actualSource.getTime() > planned.getTime());
  return { plannedLabel, actualLabel, hasDelay };
};

const formatEtaLabel = (stop: RenderableStop) => {
  if (stop.canceled) {
    return 'Inställt';
  }
  if (stop.etaMinutes === null) {
    return stop.timestamp ? 'Rapporterad' : 'Okänt';
  }
  if (stop.etaMinutes <= -1) {
    const minutesAgo = Math.abs(Math.round(stop.etaMinutes));
    if (minutesAgo < 60) {
      return `Avgick ${minutesAgo} min sedan`;
    }
    const hoursAgo = Math.floor(minutesAgo / 60);
    const minsAgo = minutesAgo % 60;
    return `Avgick ${hoursAgo} h${minsAgo > 0 ? ` ${minsAgo} min` : ''} sedan`;
  }
  if (stop.etaMinutes <= 0.75) {
    return 'Nu';
  }
  if (stop.etaMinutes < 60) {
    return `Om ${Math.round(stop.etaMinutes)} min`;
  }
  const hours = Math.floor(stop.etaMinutes / 60);
  const mins = Math.round(stop.etaMinutes % 60);
  if (mins === 0) {
    return `Om ${hours} h`;
  }
  return `Om ${hours} h ${mins} min`;
};

type TrainPanelProps = {
  train: TrainPosition;
  visible: boolean;
  initialSnap?: Exclude<TrafficSheetSnapPoint, 'hidden'>;
  onClose: () => void;
  onSnapPointChange?: (point: TrafficSheetSnapPoint) => void;
};


function TrainPanelComponent({ train, visible, initialSnap = 'half', onClose, onSnapPointChange }: TrainPanelProps) {
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(SHEET_SNAP_POINTS.hidden);
  const startY = useSharedValue(SHEET_SNAP_POINTS.hidden);
  const [currentSnap, setCurrentSnap] = useState<TrafficSheetSnapPoint>('hidden');
  const onCloseRef = useRef(onClose);
  const onSnapPointChangeRef = useRef(onSnapPointChange);
  const { data, loading, error, refetch } = useTrainDetails(train);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    onSnapPointChangeRef.current = onSnapPointChange;
  }, [onSnapPointChange]);

  const handleSnapComplete = useCallback((snap: TrafficSheetSnapPoint) => {
    setCurrentSnap(snap);
    onSnapPointChangeRef.current?.(snap);
    if (snap === 'hidden') {
      onCloseRef.current?.();
    }
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  useEffect(() => {
    const target: TrafficSheetSnapPoint = visible ? initialSnap : 'hidden';
    translateY.value = withTiming(SHEET_SNAP_POINTS[target], SHEET_TIMING_CONFIG, finished => {
      if (finished) {
        runOnJS(handleSnapComplete)(target);
      }
    });
  }, [handleSnapComplete, initialSnap, translateY, visible]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    setNow(Date.now());
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 30_000);
    return () => {
      clearInterval(timer);
    };
  }, [visible]);

  const accent = useMemo(() => {
    const seed = data?.operator ?? data?.productName ?? train.trainOwner ?? train.id;
    return deriveAccentColor(seed ?? train.id);
  }, [data?.operator, data?.productName, train.id, train.trainOwner]);

  const stops = useMemo(() => {
    if (!data?.stops?.length) {
      return [] as RenderableStop[];
    }

    let currentAssigned = false;
    const enriched: RenderableStop[] = data.stops.map(stop => {
      const plannedTime = stop.departureAdvertised ?? stop.arrivalAdvertised ?? null;
      const primaryTimestamp =
        stop.departureActual ??
        stop.arrivalActual ??
        stop.departureEstimated ??
        stop.arrivalEstimated ??
        plannedTime ??
        null;
      const arrivalTiming = buildTimingInfo(
        stop.arrivalAdvertised,
        stop.arrivalActual,
        stop.arrivalEstimated,
      );
      const departureTiming = buildTimingInfo(
        stop.departureAdvertised,
        stop.departureActual,
        stop.departureEstimated,
      );
      const timestamp = primaryTimestamp ? primaryTimestamp.getTime() : null;
      const etaMinutes = timestamp ? (timestamp - now) / 60000 : null;
      const completed = stop.departureActual
        ? stop.departureActual.getTime() <= now
        : stop.arrivalActual
          ? stop.arrivalActual.getTime() <= now
          : etaMinutes !== null && etaMinutes < -1;
      let state: StopState = completed ? 'completed' : 'upcoming';
      if (!completed && !currentAssigned) {
        state = 'current';
        currentAssigned = true;
      }
      const reportedLabel = formatDisplayTime(primaryTimestamp);

      return {
        ...stop,
        etaMinutes,
        displayTime: reportedLabel,
        timestamp,
        state,
        arrivalTiming,
        departureTiming,
      };
    });

    if (!currentAssigned && enriched.length > 0) {
      enriched[enriched.length - 1].state = 'current';
    }

    return enriched;
  }, [data?.stops, now]);

  const shouldShowActual = useCallback(
    (timing: StopTimingInfo) => timing.actualLabel !== '—',
    [],
  );

  const railSleeperCount = useMemo(() => {
    if (!stops.length) {
      return MIN_RAIL_SLEEPERS;
    }
    return Math.max((stops.length + 1) * RAIL_TIES_PER_GAP, MIN_RAIL_SLEEPERS);
  }, [stops.length]);

  const railSleeperSegments = useMemo(
    () => Array.from({ length: railSleeperCount }, (_, index) => index),
    [railSleeperCount],
  );

  const lastStop = stops[stops.length - 1];
  const routeTitle =
    data?.fromName && data?.toName ? `${data.fromName} → ${data.toName}` : `Tåg ${train.label}`;
  const arrivalLabel = lastStop?.displayTime ?? '—';
  const arrivalRelative = lastStop ? formatEtaLabel(lastStop) : '—';

  const bottomPadding = useMemo(() => Math.max(insets.bottom, 24), [insets.bottom]);

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

  const dismiss = useCallback(() => {
    translateY.value = withTiming(SHEET_SNAP_POINTS.hidden, SHEET_TIMING_CONFIG, finished => {
      if (finished) {
        runOnJS(handleSnapComplete)('hidden');
      }
    });
  }, [handleSnapComplete, translateY]);

  return (
    <Animated.View pointerEvents="box-none" style={[styles.container, animatedStyle]}>
      <BlurView
        intensity={85}
        tint="dark"
        pointerEvents="auto"
        style={[styles.sheet, { paddingBottom: bottomPadding }]}
      >
        <GestureDetector gesture={panGesture}>
          <View style={styles.dragZone}>
            <View style={styles.handle} />
            <View style={styles.sheetHeader}>
              <View style={styles.titleBlock}>
                <Text style={styles.sheetTitle}>{routeTitle}</Text>
                <Text style={styles.sheetSubtitle}>Tåg {train.label}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={dismiss}
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
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          scrollEnabled={currentSnap === 'full'}
        >
          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Operatör</Text>
              <Text style={styles.metaValue}>{data?.operator ?? 'Okänd operatör'}</Text>
              {data?.productName ? <Text style={styles.metaSub}>{data.productName}</Text> : null}
            </View>
            <View style={[styles.metaItem, styles.metaItemRight]}>
              <Text style={styles.metaLabel}>Ankomst</Text>
              <Text style={[styles.metaValue, { color: accent }]}>{arrivalLabel}</Text>
              <Text style={styles.metaSub}>{arrivalRelative}</Text>
            </View>
          </View>

          {loading && !stops.length ? (
            <View style={styles.loadingSection}>
              <ActivityIndicator color="#FFFFFF" />
              <Text style={styles.loadingLabel}>Hämtar tidtabell…</Text>
            </View>
          ) : null}

          {error ? (
            <View style={styles.errorState}>
              <Text style={styles.errorTitle}>Kunde inte hämta tåginformation</Text>
              <Text style={styles.errorSubtitle}>{error}</Text>
              <Pressable style={styles.retryButton} onPress={() => refetch()}>
                <Text style={styles.retryLabel}>Försök igen</Text>
              </Pressable>
            </View>
          ) : null}

          {!error && stops.length > 0 ? (
            <BlurView intensity={60} tint="dark" style={styles.stopList}>
              <View pointerEvents="none" style={styles.railLineContainer}>
                <View style={styles.railLine} />
                <View style={styles.railLine} />
              </View>
              <View pointerEvents="none" style={styles.railSleeperLayer}>
                {railSleeperSegments.map(segment => (
                  <View key={`sleeper-${segment}`} style={styles.railTie} />
                ))}
              </View>
              {stops.map((stop, index) => {
                const trackLabel = stop.track
                  ? stop.track.trim().toLowerCase().startsWith('spår')
                    ? stop.track
                    : `Spår ${stop.track}`
                  : 'Spår okänt';

                return (
                  <View
                    key={stop.id}
                    style={[styles.stopRow, index !== stops.length - 1 && styles.stopRowDivider]}
                  >
                    <View style={styles.timelineColumn}>
                      <View
                        style={[styles.timelineConnector, index === 0 && styles.connectorHidden]}
                      />
                      <View
                        style={[
                          styles.timelineDot,
                          stop.state === 'current' && [styles.timelineDotCurrent, { borderColor: accent }],
                          stop.state === 'completed' && styles.timelineDotCompleted,
                        ]}
                      />
                      <View
                        style={[
                          styles.timelineConnector,
                          index === stops.length - 1 && styles.connectorHidden,
                        ]}
                      />
                    </View>

                    <View style={styles.stopDetails}>
                      <Text
                        style={[
                          styles.stopName,
                          stop.state === 'completed' && styles.stopNameCompleted,
                        ]}
                      >
                        {stop.stationName}
                      </Text>
                      <Text style={styles.stopTrack}>{trackLabel}</Text>
                    </View>

                    <View style={styles.stopTiming}>
                      <View style={styles.timeStack}>
                        <View style={styles.timeRow}>
                          {stop.arrivalTiming.hasDelay &&
                          stop.arrivalTiming.plannedLabel !== '—' ? (
                            <Text style={[styles.timePlanned, styles.timePlannedDelayed]}>
                              {stop.arrivalTiming.plannedLabel}
                            </Text>
                          ) : null}
                          {shouldShowActual(stop.arrivalTiming) ? (
                            <Text
                              style={[
                                styles.timeActual,
                                stop.arrivalTiming.hasDelay && styles.timeActualDelayed,
                              ]}
                            >
                              {stop.arrivalTiming.actualLabel}
                            </Text>
                          ) : null}
                        </View>
                        <View style={styles.timeRow}>
                          {stop.departureTiming.hasDelay &&
                          stop.departureTiming.plannedLabel !== '—' ? (
                            <Text style={[styles.timePlanned, styles.timePlannedDelayed]}>
                              {stop.departureTiming.plannedLabel}
                            </Text>
                          ) : null}
                          {shouldShowActual(stop.departureTiming) ? (
                            <Text
                              style={[
                                styles.timeActual,
                                stop.departureTiming.hasDelay && styles.timeActualDelayed,
                              ]}
                            >
                              {stop.departureTiming.actualLabel}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                    </View>
                  </View>
                );
              })}
            </BlurView>
          ) : null}

          {!error && !loading && stops.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>Ingen tidtabell hittades</Text>
              <Text style={styles.emptySubtitle}>
                För detta tåg finns ingen annonserad stoppinformation just nu.
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </BlurView>
    </Animated.View>
  );
}

export const TrainPanel = memo(TrainPanelComponent);

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
  loadingSection: {
    alignItems: 'center',
    paddingVertical: 20,
    gap: 8,
  },
  loadingLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
  },
  errorState: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,96,96,0.3)',
    backgroundColor: 'rgba(255,96,96,0.08)',
    padding: 16,
    gap: 8,
  },
  errorTitle: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 15,
  },
  errorSubtitle: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    lineHeight: 18,
  },
  retryButton: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  retryLabel: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 13,
    letterSpacing: 0.3,
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
  timelineDotCurrent: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  timelineDotCompleted: {
    backgroundColor: '#929aa3',
    borderColor: '#929aa3',
  },
  stopDetails: {
    flex: 1,
    justifyContent: 'center',
  },
  stopName: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  stopNameCompleted: {
    color: 'rgba(255,255,255,0.7)',
  },
  stopTrack: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    marginTop: 2,
  },
  stopTiming: {
    minWidth: 160,
    alignItems: 'flex-end',
  },
  timeStack: {
    gap: 8,
    alignItems: 'flex-end',
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    justifyContent: 'flex-end',
  },
  timePlanned: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    textAlign: 'right',
  },
  timePlannedDelayed: {
    color: 'rgba(255,255,255,0.4)',
    textDecorationLine: 'line-through',
  },
  timeActual: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'right',
  },
  timeActualDelayed: {
    color: '#ff5e5e',
  },
  emptyState: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(0,0,0,0.35)',
    padding: 18,
    gap: 6,
  },
  emptyTitle: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 15,
  },
  emptySubtitle: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    lineHeight: 18,
  },
});

import { BlurView } from 'expo-blur';
import type { PermissionStatus as NotificationPermissionStatus } from 'expo-notifications';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
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

import { useTrafficEventSummaries } from '../../hooks/useTrafficEventSummaries';
import { useTrafficEvents } from '../../hooks/useTrafficEvents';
import { useTrafficAlerts } from '../../hooks/useTrafficAlerts';
import { useUserLocation } from '../../hooks/useUserLocation';
import { formatDistanceLabel } from '../../lib/geo';
import { computeEventDistance } from '../../lib/trafficEventUtils';
import type { TrafficEvent } from '../../types/traffic';
import type { TrafficSheetSnapPoint } from './sheetSnapPoints';
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
} from './sheetSnapPoints';

type TrafficInfoSheetProps = {
  visible: boolean;
  initialSnap?: Exclude<TrafficSheetSnapPoint, 'hidden'>;
  onClose?: () => void;
  onSnapPointChange?: (point: TrafficSheetSnapPoint) => void;
  notificationStatus?: NotificationPermissionStatus;
};

const severityStyles: Record<TrafficEvent['severity'], { dot: string; chip: string; text: string }> = {
  low: {
    dot: '#34d399',
    chip: 'rgba(52, 211, 153, 0.16)',
    text: '#6ee7b7',
  },
  medium: {
    dot: '#fbbf24',
    chip: 'rgba(251, 191, 36, 0.16)',
    text: '#fcd34d',
  },
  high: {
    dot: '#fb7185',
    chip: 'rgba(251, 113, 133, 0.16)',
    text: '#fda4af',
  },
  critical: {
    dot: '#f87171',
    chip: 'rgba(248, 113, 113, 0.18)',
    text: '#fecaca',
  },
};

const SEVERITY_PRIORITY: Record<TrafficEvent['severity'], number> = {
  low: 0.35,
  medium: 0.55,
  high: 0.75,
  critical: 1,
};

const IMPACT_PRIORITY: Record<string, number> = {
  'mycket stor påverkan': 1,
  'stor påverkan': 0.85,
  'måttlig påverkan': 0.65,
  'liten påverkan': 0.45,
};

const MAX_DISTANCE_PRIORITY_KM = 200;
const DEFAULT_DISTANCE_PRIORITY = 0.4;
const PRIORITY_WEIGHTS = {
  severity: 0.55,
  impact: 0.25,
  distance: 0.2,
};

const normalizeImpactLabel = (label: string | null | undefined) => label?.trim().toLowerCase() ?? null;

const computeImpactPriority = (impactLabel: string | null | undefined, severityScore: number) => {
  const normalized = normalizeImpactLabel(impactLabel);
  if (normalized && normalized in IMPACT_PRIORITY) {
    return IMPACT_PRIORITY[normalized];
  }
  return severityScore;
};

const computeDistancePriority = (distanceKm: number | null | undefined) => {
  if (typeof distanceKm !== 'number' || Number.isNaN(distanceKm)) {
    return DEFAULT_DISTANCE_PRIORITY;
  }
  const clamped = Math.min(Math.max(distanceKm, 0), MAX_DISTANCE_PRIORITY_KM);
  return 1 - clamped / MAX_DISTANCE_PRIORITY_KM;
};

const computePriorityScore = (event: TrafficEvent, distanceKm: number | null | undefined) => {
  const severityScore = SEVERITY_PRIORITY[event.severity] ?? 0.5;
  const impactScore = computeImpactPriority(event.impactLabel, severityScore);
  const distanceScore = computeDistancePriority(distanceKm);
  return (
    severityScore * PRIORITY_WEIGHTS.severity +
    impactScore * PRIORITY_WEIGHTS.impact +
    distanceScore * PRIORITY_WEIGHTS.distance
  );
};

const SEVERITY_LABELS: Record<TrafficEvent['severity'], string> = {
  low: 'Liten påverkan',
  medium: 'Måttlig påverkan',
  high: 'Stor påverkan',
  critical: 'Mycket stor påverkan',
};

const formatClockTime = (value: string | Date | null) => {
  if (!value) {
    return null;
  }
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleTimeString('sv-SE', {
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatRelativeTime = (value: string | null) => {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) {
    return 'Nyss';
  }
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) {
    return `${minutes} min sedan`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours} h sedan`;
};

export function TrafficInfoSheet({
  visible,
  initialSnap = 'half',
  onClose,
  onSnapPointChange,
  notificationStatus,
}: TrafficInfoSheetProps) {
  const translateY = useSharedValue(SHEET_SNAP_POINTS.hidden);
  const startY = useSharedValue(SHEET_SNAP_POINTS.hidden);
  const [currentSnap, setCurrentSnap] = useState<TrafficSheetSnapPoint>('hidden');
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const onCloseRef = useRef(onClose);
  const onSnapPointChangeRef = useRef(onSnapPointChange);
  const { events, loading, error, lastUpdated, refetch } = useTrafficEvents();
  const locationPromptedRef = useRef(false);
  const {
    coords: userCoords,
    permissionStatus: locationPermission,
    canAskAgain: canRequestLocation,
    requestPermission: requestLocationPermission,
    loading: requestingLocation,
    error: locationError,
  } = useUserLocation({ active: visible });
  const {
    summaries: eventSummaries,
    loadingMap: summaryLoadingMap,
    errorMap: summaryErrorMap,
    ensureSummary,
  } = useTrafficEventSummaries();
  useTrafficAlerts({
    events,
    userCoords,
    permissionStatus: notificationStatus ?? 'undetermined',
    summaries: eventSummaries,
  });

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    onSnapPointChangeRef.current = onSnapPointChange;
  }, [onSnapPointChange]);

  useEffect(() => {
    if (!visible || !events?.length) {
      return;
    }
    events.slice(0, 3).forEach(event => {
      void ensureSummary(event);
    });
  }, [visible, events, ensureSummary]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    if (locationPermission === 'undetermined' && !locationPromptedRef.current) {
      locationPromptedRef.current = true;
      void requestLocationPermission();
    }
  }, [locationPermission, requestLocationPermission, visible]);

  const handleSnapComplete = useCallback(
    (snap: TrafficSheetSnapPoint) => {
      setCurrentSnap(snap);
      onSnapPointChangeRef.current?.(snap);
      if (snap === 'hidden') {
        onCloseRef.current?.();
      }
    },
    [],
  );

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

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
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
            // Anything inside the top 25% should aggressively stick to "full".
            target = 'full';
          } else if (releaseY >= SHEET_BOTTOM_LOCK_REGION) {
            // Dragging far enough down should always hide the sheet.
            target = 'hidden';
          } else {
            // Otherwise pick the closest snap inside the generous sticky zone.
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

          // Ensure the animation starts from the gesture's release position.
          translateY.value = releaseY;
          translateY.value = withTiming(
            SHEET_SNAP_POINTS[target],
            SHEET_TIMING_CONFIG,
            finished => {
              if (finished) {
                runOnJS(handleSnapComplete)(target);
              }
            }
          );
        }),
    [handleSnapComplete, startY, translateY],
  );

  const statusMessage = useMemo(() => {
    if (loading && !events.length) {
      return 'Läser in trafikhändelser…';
    }
    if (lastUpdated) {
      return `Senast uppdaterad ${formatClockTime(lastUpdated)}`;
    }
    return 'Ingen uppdatering ännu';
  }, [events.length, lastUpdated, loading]);

  const { sortedEvents, distanceMap } = useMemo(() => {
    const enriched = events.map((event, index) => {
      const distance = userCoords ? computeEventDistance(event, userCoords) : null;
      return {
        event,
        index,
        distance,
        priority: computePriorityScore(event, distance),
      };
    });
    enriched.sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      const severityDiff =
        (SEVERITY_PRIORITY[b.event.severity] ?? 0) - (SEVERITY_PRIORITY[a.event.severity] ?? 0);
      if (severityDiff !== 0) {
        return severityDiff > 0 ? 1 : -1;
      }
      const aDistance = typeof a.distance === 'number' ? a.distance : Number.POSITIVE_INFINITY;
      const bDistance = typeof b.distance === 'number' ? b.distance : Number.POSITIVE_INFINITY;
      if (aDistance !== bDistance) {
        return aDistance - bDistance;
      }
      return a.index - b.index;
    });
    const map = new Map<string, number | null>();
    enriched.forEach(item => {
      map.set(item.event.id, typeof item.distance === 'number' ? item.distance : null);
    });
    return {
      sortedEvents: enriched.map(item => item.event),
      distanceMap: map,
    };
  }, [events, userCoords]);

  const locationInfo = useMemo(() => {
    if (locationPermission === 'granted') {
      return <Text style={styles.locationStatusText}>Visar händelser närmast din position.</Text>;
    }
    return (
      <View style={styles.locationPrompt}>
        <View style={styles.locationPromptCopy}>
          <Text style={styles.locationPromptTitle}>Sortera efter din plats</Text>
          <Text style={styles.locationPromptText}>Tillåt platstjänster för att se störningar nära dig.</Text>
          {!canRequestLocation ? (
            <Text style={styles.locationPromptText}>Aktivera platstjänster i systeminställningarna.</Text>
          ) : null}
        </View>
        {canRequestLocation ? (
          <Pressable
            onPress={requestLocationPermission}
            style={[styles.locationButton, requestingLocation && styles.locationButtonDisabled]}
            disabled={requestingLocation}
          >
            <Text style={styles.locationButtonText}>{requestingLocation ? 'Begär…' : 'Dela plats'}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }, [canRequestLocation, locationPermission, requestingLocation, requestLocationPermission]);

  const listHeader = useMemo(
    () => (
      <View style={styles.listHeader}>
        <View style={styles.statusRow}>
          <View>
            <Text style={styles.statusText}>{statusMessage}</Text>
            <Text style={styles.statusSubtle}>Automatisk uppdatering var tredje minut</Text>
          </View>
          <Pressable onPress={refetch} style={styles.refreshButton} disabled={loading}>
            <Text style={styles.refreshButtonText}>{loading ? 'Uppdaterar…' : 'Uppdatera'}</Text>
          </Pressable>
        </View>
        {locationInfo}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {locationError ? <Text style={styles.errorText}>{locationError}</Text> : null}
      </View>
    ),
    [error, locationError, loading, locationInfo, refetch, statusMessage],
  );

  const listEmptyComponent = useMemo(
    () => (
      <View style={styles.placeholderCard}>
        {loading ? (
          <>
            <ActivityIndicator color="#fff" />
            <Text style={styles.placeholderText}>Hämtar liveinformation…</Text>
          </>
        ) : (
          <>
            <Text style={styles.placeholderTitle}>Ingen känd störning</Text>
            <Text style={styles.placeholderText}>All trafik ser ut att rulla enligt plan just nu.</Text>
          </>
        )}
      </View>
    ),
    [loading],
  );

  const handleToggleEvent = useCallback(
    (event: TrafficEvent) => {
      haptics.light();
      setExpandedEventId(current => (current === event.id ? null : event.id));
      void ensureSummary(event);
    },
    [ensureSummary],
  );

  const renderEvent = useCallback(
    ({ item }: { item: TrafficEvent }) => {
      const severityTheme = severityStyles[item.severity];
      const updatedLabel = formatRelativeTime(item.updatedAt) ?? formatClockTime(item.updatedAt);
      const startLabel = formatClockTime(item.startTime);
      const distanceValue = distanceMap.get(item.id);
      const distanceLabel = typeof distanceValue === 'number' ? formatDistanceLabel(distanceValue) : null;
      const aiSummary = eventSummaries[item.id];
      const isExpanded = expandedEventId === item.id;
      const hasDescription = item.description && item.description.trim().length > 0;
      const fallbackAdvice = hasDescription ? item.description : 'Kontrollera din avgång för senaste information.';
      const previewText =
        item.description?.trim() || item.reasonDescription?.trim() || 'Ingen beskrivning tillgänglig.';
      const impactText = item.impactLabel?.trim() || SEVERITY_LABELS[item.severity] || 'Okänd påverkan';
      const loadingSummary = Boolean(summaryLoadingMap[item.id]);
      const summaryError = summaryErrorMap[item.id];
      const isAiGenerated = Boolean(aiSummary?.aiGenerated);
      const summarySourceLabel = summaryError ? 'Fel' : isAiGenerated ? 'AI-genererad' : 'Systemtext';
      const summarySourceStyle = summaryError
        ? styles.aiSummarySourceError
        : isAiGenerated
          ? styles.aiSummarySourceAi
          : styles.aiSummarySourceFallback;
      return (
        <Pressable onPress={() => handleToggleEvent(item)} style={styles.cardPressable}>
          <View style={styles.incidentCard}>
            <View style={styles.incidentHeader}>
              <View style={styles.titleRow}>
                <View style={[styles.severityDot, { backgroundColor: severityTheme.dot }]} />
                <Text style={styles.incidentTitle}>{item.title}</Text>
              </View>
              {updatedLabel ? <Text style={styles.incidentTime}>{updatedLabel}</Text> : null}
            </View>
            {item.segment ? <Text style={styles.incidentSegment}>{item.segment}</Text> : null}
            <Text numberOfLines={isExpanded ? undefined : 2} style={styles.summaryPreview}>
              {previewText}
            </Text>
            <View style={styles.metaRow}>
              <View style={styles.metaLeft}>
                <View style={[styles.severityChip, { backgroundColor: severityTheme.chip }]}>
                  <Text style={[styles.severityChipText, { color: severityTheme.text }]}>{impactText}</Text>
                </View>
                <Text style={styles.metaText}>
                  {startLabel ? `Start ${startLabel}` : 'Start okänd'}
                  {item.endTime ? ` · Slut ${formatClockTime(item.endTime)}` : ''}
                </Text>
              </View>
              {distanceLabel ? <Text style={styles.distanceText}>{distanceLabel}</Text> : null}
            </View>
            {isExpanded ? (
              <View style={styles.expandedSection}>
                {loadingSummary ? (
                  <View style={styles.aiSummaryCard}>
                    <View style={styles.aiSummaryHeader}>
                      <Text style={styles.aiSummaryLabel}>AI-sammanfattning</Text>
                      <Text style={[styles.aiSummarySource, summarySourceStyle]}>{summarySourceLabel}</Text>
                    </View>
                    <View style={styles.aiLoadingRow}>
                      <ActivityIndicator color="#7dd3fc" size="small" />
                      <Text style={styles.aiSummaryText}>Genererar sammanfattning…</Text>
                    </View>
                  </View>
                ) : aiSummary ? (
                  <View style={styles.aiSummaryCard}>
                    <View style={styles.aiSummaryHeader}>
                      <Text style={styles.aiSummaryLabel}>AI-sammanfattning</Text>
                      <Text style={[styles.aiSummarySource, summarySourceStyle]}>{summarySourceLabel}</Text>
                    </View>
                    <Text style={styles.aiSummaryText}>{aiSummary.summary}</Text>
                    <Text style={styles.aiSummaryAdvice}>
                      {aiSummary.advice || fallbackAdvice || 'Följ skyltning och planera extra tid.'}
                    </Text>
                  </View>
                ) : summaryError ? (
                  <View style={styles.aiSummaryCard}>
                    <View style={styles.aiSummaryHeader}>
                      <Text style={styles.aiSummaryLabel}>AI-sammanfattning</Text>
                      <Text style={[styles.aiSummarySource, summarySourceStyle]}>{summarySourceLabel}</Text>
                    </View>
                    <Text style={styles.aiSummaryError}>Kunde inte visa AI-svar: {summaryError}</Text>
                    <Text style={styles.aiSummaryText}>
                      {fallbackAdvice || 'Sammanfattningen visas igen när AI-tjänsten svarar.'}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.aiSummaryCard}>
                    <View style={styles.aiSummaryHeader}>
                      <Text style={styles.aiSummaryLabel}>AI-sammanfattning</Text>
                      <Text style={[styles.aiSummarySource, summarySourceStyle]}>{summarySourceLabel}</Text>
                    </View>
                    <Text style={styles.aiSummaryText}>
                      {fallbackAdvice || 'Sammanfattning laddas… försök igen om en stund.'}
                    </Text>
                  </View>
                )}
                <View style={styles.sourceCard}>
                  <Text style={styles.sourceLabel}>Beskrivning från Trafikverket</Text>
                  <Text style={styles.sourceText}>{previewText}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Påverkan</Text>
                  <Text style={styles.detailValue}>{impactText}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Sträcka</Text>
                  <Text style={styles.detailValue}>{item.segment ?? 'Okänd'}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Tidsfönster</Text>
                  <Text style={styles.detailValue}>
                    {startLabel ? `Start ${startLabel}` : 'Start okänd'}
                    {item.endTime ? ` · Slut ${formatClockTime(item.endTime)}` : ''}
                  </Text>
                </View>
              </View>
            ) : null}
          </View>
        </Pressable>
      );
    },
    [distanceMap, eventSummaries, expandedEventId, handleToggleEvent],
  );

  const keyExtractor = useCallback((item: TrafficEvent) => item.id, []);

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.container, animatedStyle]}
    >
      <BlurView
        intensity={85}
        tint="dark"
        pointerEvents="auto"
        style={styles.sheet}
      >
        <GestureDetector gesture={panGesture}>
          <View style={styles.dragZone}>
            <View style={styles.handleContainer}>
              <View style={styles.handle} />
            </View>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Trafikinfo</Text>
              <Text style={styles.sheetSubtitle}>Liveuppdateringar för tågtrafiken</Text>
            </View>
          </View>
        </GestureDetector>

        <FlatList
          data={sortedEvents}
          keyExtractor={keyExtractor}
          renderItem={renderEvent}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={listEmptyComponent}
          ItemSeparatorComponent={() => <View style={styles.itemSeparator} />}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
          windowSize={5}
          initialNumToRender={4}
          maxToRenderPerBatch={6}
          keyboardShouldPersistTaps="handled"
        />
      </BlurView>
    </Animated.View>
  );
}

export type { TrafficSheetSnapPoint } from './sheetSnapPoints';

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 9999,
    elevation: 9999,
  },
  sheet: {
    flex: 1,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: 'rgba(6,12,24,0.7)',
    paddingBottom: 40,
    overflow: 'visible',
    zIndex: 9999,
  },
  dragZone: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  handleContainer: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  handle: {
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  sheetHeader: {
    gap: 4,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  sheetSubtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: 20,
    paddingBottom: 80,
  },
  listHeader: {
    gap: 6,
    marginBottom: 12,
  },
  locationPrompt: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(13, 25, 48, 0.5)',
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  locationPromptCopy: {
    flex: 1,
    gap: 4,
  },
  locationPromptTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  locationPromptText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.75)',
  },
  locationButton: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  locationButtonDisabled: {
    opacity: 0.5,
  },
  locationButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  locationStatusText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 8,
  },
  itemSeparator: {
    height: 12,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
  },
  statusSubtle: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.55)',
  },
  refreshButton: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  refreshButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 12,
  },
  placeholderCard: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 18,
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(13, 25, 48, 0.4)',
  },
  placeholderTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  placeholderText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.75)',
    textAlign: 'center',
  },
  incidentCard: {
    backgroundColor: 'rgba(13, 25, 48, 0.6)',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 16,
    gap: 6,
  },
  cardPressable: {
    width: '100%',
  },
  incidentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  severityDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  incidentTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    flex: 1,
  },
  incidentTime: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
  },
  incidentSegment: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.75)',
  },
  summaryPreview: {
    fontSize: 13,
    color: '#e5e7eb',
    lineHeight: 18,
  },
  incidentDetail: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.75)',
    lineHeight: 18,
  },
  aiSummaryCard: {
    marginTop: 4,
    padding: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(17, 40, 68, 0.6)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 4,
  },
  aiSummaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  aiSummaryLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    color: '#7dd3fc',
    textTransform: 'uppercase',
  },
  aiSummarySource: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  aiSummarySourceAi: {
    color: '#bef264',
  },
  aiSummarySourceFallback: {
    color: 'rgba(255,255,255,0.7)',
  },
  aiSummarySourceError: {
    color: '#fca5a5',
  },
  aiSummaryText: {
    fontSize: 13,
    color: '#e0f2fe',
  },
  aiSummaryAdvice: {
    fontSize: 12,
    color: 'rgba(224, 242, 254, 0.85)',
  },
  aiSummaryError: {
    fontSize: 12,
    color: '#fca5a5',
  },
  sourceCard: {
    marginTop: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(17, 40, 68, 0.45)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 6,
  },
  sourceLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
    color: 'rgba(255,255,255,0.8)',
    textTransform: 'uppercase',
  },
  sourceText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
  },
  aiLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  expandedSection: {
    marginTop: 8,
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  detailLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
    fontWeight: '600',
  },
  detailValue: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'right',
    flex: 1,
    marginLeft: 12,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  metaLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  severityChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
  },
  severityChipText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  metaText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
  },
  distanceText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.75)',
  },
});

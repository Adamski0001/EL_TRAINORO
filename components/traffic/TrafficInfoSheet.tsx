import { BlurView } from 'expo-blur';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

import { useTrafficEvents } from '../../hooks/useTrafficEvents';
import type { TrafficEvent } from '../../types/traffic';
import type { TrafficSheetSnapPoint } from './sheetSnapPoints';
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
}: TrafficInfoSheetProps) {
  const translateY = useSharedValue(SHEET_SNAP_POINTS.hidden);
  const startY = useSharedValue(SHEET_SNAP_POINTS.hidden);
  const [currentSnap, setCurrentSnap] = useState<TrafficSheetSnapPoint>('hidden');
  const onCloseRef = useRef(onClose);
  const onSnapPointChangeRef = useRef(onSnapPointChange);
  const { events, loading, error, lastUpdated, refetch } = useTrafficEvents();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    onSnapPointChangeRef.current = onSnapPointChange;
  }, [onSnapPointChange]);

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

        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          scrollEnabled={currentSnap === 'full'}
        >
          <View style={styles.statusRow}>
            <View>
              <Text style={styles.statusText}>
                {loading && !events.length
                  ? 'Läser in trafikhändelser…'
                  : lastUpdated
                    ? `Senast uppdaterad ${formatClockTime(lastUpdated)}`
                    : 'Ingen uppdatering ännu'}
              </Text>
              <Text style={styles.statusSubtle}>Automatisk uppdatering var tredje minut</Text>
            </View>
            <Pressable onPress={refetch} style={styles.refreshButton} disabled={loading}>
              <Text style={styles.refreshButtonText}>{loading ? 'Uppdaterar…' : 'Uppdatera'}</Text>
            </Pressable>
          </View>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {loading && !events.length ? (
            <View style={styles.placeholderCard}>
              <ActivityIndicator color="#fff" />
              <Text style={styles.placeholderText}>Hämtar liveinformation…</Text>
            </View>
          ) : null}
          {!loading && !events.length ? (
            <View style={styles.placeholderCard}>
              <Text style={styles.placeholderTitle}>Ingen känd störning</Text>
              <Text style={styles.placeholderText}>All trafik ser ut att rulla enligt plan just nu.</Text>
            </View>
          ) : null}
          {events.map(event => {
            const severityTheme = severityStyles[event.severity];
            const updatedLabel = formatRelativeTime(event.updatedAt) ?? formatClockTime(event.updatedAt);
            const startLabel = formatClockTime(event.startTime);
            return (
              <View key={event.id} style={styles.incidentCard}>
                <View style={styles.incidentHeader}>
                  <View style={styles.titleRow}>
                    <View style={[styles.severityDot, { backgroundColor: severityTheme.dot }]} />
                    <Text style={styles.incidentTitle}>{event.title}</Text>
                  </View>
                  {updatedLabel ? <Text style={styles.incidentTime}>{updatedLabel}</Text> : null}
                </View>
                {event.segment ? <Text style={styles.incidentSegment}>{event.segment}</Text> : null}
                {event.description ? <Text style={styles.incidentDetail}>{event.description}</Text> : null}
                <View style={styles.metaRow}>
                  <View style={[styles.severityChip, { backgroundColor: severityTheme.chip }]}> 
                    <Text style={[styles.severityChipText, { color: severityTheme.text }]}>
                      {event.impactLabel ?? event.severity.toUpperCase()}
                    </Text>
                  </View>
                  <Text style={styles.metaText}>
                    {startLabel ? `Start ${startLabel}` : 'Start okänd'}
                    {event.endTime ? ` · Slut ${formatClockTime(event.endTime)}` : ''}
                  </Text>
                </View>
              </View>
            );
          })}
        </ScrollView>
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
    gap: 12,
    paddingBottom: 80,
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
  incidentDetail: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.75)',
    lineHeight: 18,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
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
});

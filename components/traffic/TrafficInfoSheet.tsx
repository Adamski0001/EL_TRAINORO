import { BlurView } from 'expo-blur';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
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
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

export type TrafficSheetSnapPoint = 'hidden' | 'half' | 'mostly' | 'full';

const SCREEN_HEIGHT = Dimensions.get('window').height;

const SNAP_POINTS: Record<TrafficSheetSnapPoint, number> = {
  full: 0,
  mostly: SCREEN_HEIGHT * 0.2,
  half: SCREEN_HEIGHT * 0.45,
  hidden: SCREEN_HEIGHT,
};

const TIMING_CONFIG = {
  duration: 260,
  easing: Easing.out(Easing.cubic),
};

const SNAP_SEQUENCE: Array<{ key: TrafficSheetSnapPoint; value: number }> = [
  { key: 'full', value: SNAP_POINTS.full },
  { key: 'mostly', value: SNAP_POINTS.mostly },
  { key: 'half', value: SNAP_POINTS.half },
  { key: 'hidden', value: SNAP_POINTS.hidden },
];

/**
 * How "sticky" each snap point should feel. We use a generous band (12% of the
 * screen height) so that releasing close to any snap pulls the sheet there.
 */
const STICKY_ZONE = SCREEN_HEIGHT * 0.12;

// Hard bounds so the very top/bottom of the gesture always win.
const TOP_LOCK_REGION = SCREEN_HEIGHT * 0.25;
const BOTTOM_LOCK_REGION = SCREEN_HEIGHT * 0.85;

const FLICK_VELOCITY = 1100; // px/s threshold to treat the gesture as a flick.

const clamp = (value: number, min: number, max: number) => {
  'worklet';
  return Math.min(Math.max(value, min), max);
};

const findNearestSnapPoint = (position: number): TrafficSheetSnapPoint => {
  'worklet';
  let chosen: TrafficSheetSnapPoint = 'hidden';
  let minDistance = Number.MAX_VALUE;
  for (let i = 0; i < SNAP_SEQUENCE.length; i += 1) {
    const snap = SNAP_SEQUENCE[i];
    const distance = Math.abs(position - snap.value);
    if (distance < minDistance) {
      minDistance = distance;
      chosen = snap.key;
    }
  }
  return chosen;
};

const snapInDirection = (
  position: number,
  direction: 'up' | 'down',
): TrafficSheetSnapPoint => {
  'worklet';
  if (direction === 'up') {
    let candidate: TrafficSheetSnapPoint = 'full';
    for (let i = 0; i < SNAP_SEQUENCE.length; i += 1) {
      const snap = SNAP_SEQUENCE[i];
      if (snap.value >= position) {
        return candidate;
      }
      candidate = snap.key;
    }
    return candidate;
  }

  for (let i = 0; i < SNAP_SEQUENCE.length; i += 1) {
    const snap = SNAP_SEQUENCE[i];
    if (snap.value > position) {
      return snap.key;
    }
  }
  return 'hidden';
};

type TrafficInfoSheetProps = {
  visible: boolean;
  initialSnap?: Exclude<TrafficSheetSnapPoint, 'hidden'>;
  onClose?: () => void;
  onSnapPointChange?: (point: TrafficSheetSnapPoint) => void;
};

const INCIDENTS = [
  {
    id: 'incident-01',
    title: 'Signalfel vid Solna',
    detail: 'Avgångar mot Uppsala dirigeras om · +15 min',
    updated: '08:32',
  },
  {
    id: 'incident-02',
    title: 'Kontaktledningsfel Hallsberg',
    detail: 'Godståg spåras om · Begränsad kapacitet',
    updated: '07:58',
  },
  {
    id: 'incident-03',
    title: 'Personalbrist Västra Stambanan',
    detail: 'Inställd avgång 10:05 Göteborg C – Stockholm C',
    updated: '07:40',
  },
  {
    id: 'incident-04',
    title: 'Arbete på spår Malmö – Lund',
    detail: 'Reducerad hastighet · Räkna med +5 min',
    updated: '06:55',
  },
  {
    id: 'incident-05',
    title: 'Fordonfel Arlanda Express',
    detail: 'Var 20:e minut tills vidare',
    updated: '06:20',
  },
];

export function TrafficInfoSheet({
  visible,
  initialSnap = 'half',
  onClose,
  onSnapPointChange,
}: TrafficInfoSheetProps) {
  const translateY = useSharedValue(SNAP_POINTS.hidden);
  const startY = useSharedValue(SNAP_POINTS.hidden);
  const [currentSnap, setCurrentSnap] = useState<TrafficSheetSnapPoint>('hidden');
  const onCloseRef = useRef(onClose);
  const onSnapPointChangeRef = useRef(onSnapPointChange);

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
    translateY.value = withTiming(SNAP_POINTS[target], TIMING_CONFIG, finished => {
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
          translateY.value = clamp(nextY, SNAP_POINTS.full, SNAP_POINTS.hidden);
        })
        .onEnd(event => {
          'worklet';

          const releaseY = clamp(
            startY.value + event.translationY,
            SNAP_POINTS.full,
            SNAP_POINTS.hidden,
          );
          const velocityY = event.velocityY;
          const isSwipeUp = velocityY < -FLICK_VELOCITY;
          const isSwipeDown = velocityY > FLICK_VELOCITY;

          let target: TrafficSheetSnapPoint = 'half';

          if (isSwipeUp) {
            // Fast upward fling → jump to the snap above the release point.
            target = snapInDirection(releaseY, 'up');
          } else if (isSwipeDown) {
            // Fast downward fling → jump to the snap below the release.
            target = snapInDirection(releaseY, 'down');
          } else if (releaseY <= TOP_LOCK_REGION) {
            // Anything inside the top 25% should aggressively stick to "full".
            target = 'full';
          } else if (releaseY >= BOTTOM_LOCK_REGION) {
            // Dragging far enough down should always hide the sheet.
            target = 'hidden';
          } else {
            // Otherwise pick the closest snap inside the generous sticky zone.
            let stickyTarget: TrafficSheetSnapPoint | null = null;
            let stickyDistance = Number.MAX_VALUE;
            for (let i = 0; i < SNAP_SEQUENCE.length; i += 1) {
              const snap = SNAP_SEQUENCE[i];
              const distance = Math.abs(releaseY - snap.value);
              if (distance <= STICKY_ZONE && distance < stickyDistance) {
                stickyTarget = snap.key;
                stickyDistance = distance;
              }
            }
            target = stickyTarget ?? findNearestSnapPoint(releaseY);
          }

          // Ensure the animation starts from the gesture's release position.
          translateY.value = releaseY;
          translateY.value = withTiming(
            SNAP_POINTS[target],
            TIMING_CONFIG,
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
          {INCIDENTS.map(incident => (
            <View key={incident.id} style={styles.incidentCard}>
              <View style={styles.incidentHeader}>
                <Text style={styles.incidentTitle}>{incident.title}</Text>
                <Text style={styles.incidentTime}>{incident.updated}</Text>
              </View>
              <Text style={styles.incidentDetail}>{incident.detail}</Text>
            </View>
          ))}
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
  incidentTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  incidentTime: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
  },
  incidentDetail: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.75)',
    lineHeight: 18,
  },
});

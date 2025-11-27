import { BlurView } from 'expo-blur';
import { X } from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Station, StationServices, StationTrafficVolume } from '../../types/stations';
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

type StationPanelProps = {
  station: Station;
  visible: boolean;
  initialSnap?: Exclude<TrafficSheetSnapPoint, 'hidden'>;
  onClose: () => void;
  onSnapPointChange?: (point: TrafficSheetSnapPoint) => void;
};

const SERVICE_LABELS: Record<keyof StationServices, string> = {
  hasAccessibility: 'Tillgänglighet',
  hasParking: 'Parkering',
  hasRestrooms: 'Toaletter',
  hasShops: 'Butiker',
  hasTicketOffice: 'Biljettlucka',
};

const TRAFFIC_LABELS: Record<StationTrafficVolume, string> = {
  high: 'Hög trafik',
  medium: 'Medeltrafik',
  low: 'Låg trafik',
};

const formatDisplayNames = (names: string[]) => {
  if (names.length <= 1) {
    return null;
  }
  return names.slice(1).join(' • ');
};

function StationPanelComponent({
  station,
  visible,
  initialSnap = 'half',
  onClose,
  onSnapPointChange,
}: StationPanelProps) {
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(SHEET_SNAP_POINTS.hidden);
  const startY = useSharedValue(SHEET_SNAP_POINTS.hidden);
  const onCloseRef = useRef(onClose);
  const onSnapPointChangeRef = useRef(onSnapPointChange);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    onSnapPointChangeRef.current = onSnapPointChange;
  }, [onSnapPointChange]);

  const handleSnapComplete = useCallback((snap: TrafficSheetSnapPoint) => {
    onSnapPointChangeRef.current?.(snap);
    if (snap === 'hidden') {
      onCloseRef.current?.();
    }
  }, []);

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

  const bottomPadding = Math.max(insets.bottom, 24);
  const alternateNames = formatDisplayNames(station.displayNames);

  const serviceEntries = Object.entries(station.services) as [keyof StationServices, boolean][];

  return (
    <Animated.View pointerEvents="box-none" style={[styles.container, animatedStyle]}>
      <BlurView intensity={85} tint="dark" style={[styles.sheet, { paddingBottom: bottomPadding }]}>
        <GestureDetector gesture={panGesture}>
          <View style={styles.dragZone}>
            <View style={styles.handle} />
            <View style={styles.sheetHeader}>
              <View style={styles.titleBlock}>
                <Text style={styles.sheetTitle}>{station.displayName}</Text>
                {alternateNames ? (
                  <Text style={styles.sheetSubtitle}>{alternateNames}</Text>
                ) : null}
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  translateY.value = withTiming(SHEET_SNAP_POINTS.hidden, SHEET_TIMING_CONFIG, finished => {
                    if (finished) {
                      runOnJS(handleSnapComplete)('hidden');
                    }
                  });
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
        >
          <View style={styles.badgeRow}>
            <View style={styles.badge}>
              <Text style={styles.badgeLabel}>{station.region}</Text>
            </View>
            <View style={styles.badgeSecondary}>
              <Text style={styles.badgeSecondaryLabel}>{TRAFFIC_LABELS[station.trafficVolume]}</Text>
            </View>
          </View>

          {station.lines.length ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Linjer</Text>
              <View style={styles.sectionBody}>
                {station.lines.map(line => (
                  <View key={`${station.id}-${line.name}`} style={styles.lineRow}>
                    <View style={styles.lineBadge}>
                      <Text style={styles.lineBadgeLabel}>{line.category}</Text>
                    </View>
                    <View style={styles.lineInfo}>
                      <Text style={styles.lineName}>{line.name}</Text>
                      {line.description ? (
                        <Text style={styles.lineDescription}>{line.description}</Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Tjänster</Text>
            <View style={styles.servicesRow}>
              {serviceEntries.map(([key, available]) => (
                <View
                  key={key}
                  style={[
                    styles.serviceChip,
                    available ? styles.serviceChipActive : styles.serviceChipInactive,
                  ]}
                >
                  <Text
                    style={[
                      styles.serviceLabel,
                      available ? styles.serviceLabelActive : styles.serviceLabelInactive,
                    ]}
                  >
                    {SERVICE_LABELS[key]}
                  </Text>
                </View>
              ))}
            </View>
          </View>
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
    zIndex: 30,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: 'hidden',
    backgroundColor: 'rgba(8, 14, 28, 0.85)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  dragZone: {
    paddingTop: 10,
    paddingHorizontal: 24,
  },
  handle: {
    width: 48,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.4)',
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  titleBlock: {
    flex: 1,
    paddingRight: 12,
  },
  sheetTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
  },
  sheetSubtitle: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    marginTop: 4,
  },
  closeButton: {
    padding: 6,
    borderRadius: 20,
  },
  scroll: {
    marginTop: 8,
  },
  scrollContent: {
    paddingHorizontal: 24,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 18,
  },
  badge: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  badgeLabel: {
    color: '#E2E8FF',
    fontSize: 12,
    fontWeight: '600',
  },
  badgeSecondary: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(98, 205, 255, 0.12)',
  },
  badgeSecondaryLabel: {
    color: '#62CDFF',
    fontSize: 12,
    fontWeight: '600',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    color: '#F2F7FF',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  sectionBody: {
    gap: 14,
  },
  lineRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  lineBadge: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  lineBadgeLabel: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },
  lineInfo: {
    flex: 1,
  },
  lineName: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  lineDescription: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    marginTop: 2,
  },
  servicesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  serviceChip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  serviceChipActive: {
    borderColor: 'rgba(98,205,255,0.5)',
    backgroundColor: 'rgba(98,205,255,0.1)',
  },
  serviceChipInactive: {
    borderColor: 'rgba(255,255,255,0.05)',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  serviceLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  serviceLabelActive: {
    color: '#9DDFFE',
  },
  serviceLabelInactive: {
    color: 'rgba(255,255,255,0.45)',
  },
});

import { Dimensions } from 'react-native';
import { Easing } from 'react-native-reanimated';
import type { WithTimingConfig } from 'react-native-reanimated';

export type TrafficSheetSnapPoint = 'hidden' | 'half' | 'mostly' | 'full';

const SCREEN_HEIGHT = Dimensions.get('window').height;

export const SHEET_SNAP_POINTS: Record<TrafficSheetSnapPoint, number> = {
  full: 0,
  mostly: SCREEN_HEIGHT * 0.2,
  half: SCREEN_HEIGHT * 0.45,
  hidden: SCREEN_HEIGHT,
};

export const SHEET_TIMING_CONFIG: WithTimingConfig = {
  duration: 260,
  easing: Easing.out(Easing.cubic),
};

export const SHEET_SNAP_SEQUENCE: Array<{ key: TrafficSheetSnapPoint; value: number }> = [
  { key: 'full', value: SHEET_SNAP_POINTS.full },
  { key: 'mostly', value: SHEET_SNAP_POINTS.mostly },
  { key: 'half', value: SHEET_SNAP_POINTS.half },
  { key: 'hidden', value: SHEET_SNAP_POINTS.hidden },
];

export const SHEET_STICKY_ZONE = SCREEN_HEIGHT * 0.12;
export const SHEET_TOP_LOCK_REGION = SCREEN_HEIGHT * 0.25;
export const SHEET_BOTTOM_LOCK_REGION = SCREEN_HEIGHT * 0.85;
export const SHEET_FLICK_VELOCITY = 1100;

export const clampSheetPosition = (value: number) => {
  'worklet';
  return Math.min(Math.max(value, SHEET_SNAP_POINTS.full), SHEET_SNAP_POINTS.hidden);
};

export const findNearestSheetSnap = (position: number): TrafficSheetSnapPoint => {
  'worklet';
  let chosen: TrafficSheetSnapPoint = 'hidden';
  let minDistance = Number.MAX_VALUE;
  for (let i = 0; i < SHEET_SNAP_SEQUENCE.length; i += 1) {
    const snap = SHEET_SNAP_SEQUENCE[i];
    const distance = Math.abs(position - snap.value);
    if (distance < minDistance) {
      minDistance = distance;
      chosen = snap.key;
    }
  }
  return chosen;
};

export const snapSheetInDirection = (
  position: number,
  direction: 'up' | 'down',
): TrafficSheetSnapPoint => {
  'worklet';
  if (direction === 'up') {
    let candidate: TrafficSheetSnapPoint = 'full';
    for (let i = 0; i < SHEET_SNAP_SEQUENCE.length; i += 1) {
      const snap = SHEET_SNAP_SEQUENCE[i];
      if (snap.value >= position) {
        return candidate;
      }
      candidate = snap.key;
    }
    return candidate;
  }

  for (let i = 0; i < SHEET_SNAP_SEQUENCE.length; i += 1) {
    const snap = SHEET_SNAP_SEQUENCE[i];
    if (snap.value > position) {
      return snap.key;
    }
  }
  return 'hidden';
};

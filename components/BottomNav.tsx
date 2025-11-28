import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { AlertTriangle, Home, Search, UserRound } from 'lucide-react-native';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  PanGestureHandler,
  PanGestureHandlerGestureEvent,
  PanGestureHandlerStateChangeEvent,
  State,
} from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCallback, useEffect, useRef, useState } from 'react';

export type NavKey = 'home' | 'search' | 'traffic' | 'profile';

type NavItem = {
  key: NavKey;
  label: string;
  Icon: typeof Home;
};

const NAV_ITEMS: NavItem[] = [
  { key: 'home', label: 'Hem', Icon: Home },
  { key: 'search', label: 'Sök', Icon: Search },
  { key: 'traffic', label: 'Trafikinfo', Icon: AlertTriangle },
  { key: 'profile', label: 'Profil', Icon: UserRound },
];

type BottomNavProps = {
  activeKey: NavKey;
  onSelect: (key: NavKey) => void;
};

export function BottomNav({ activeKey, onSelect }: BottomNavProps) {
  const insets = useSafeAreaInsets();
  const [hoveredKey, setHoveredKey] = useState<NavKey | null>(null);
  const hoveredKeyRef = useRef<NavKey | null>(null);
  const buttonLayouts = useRef<Record<NavKey, { x: number; width: number }>>({});
  const isDraggingRef = useRef(false);

  useEffect(() => {
    hoveredKeyRef.current = hoveredKey;
  }, [hoveredKey]);

  const setHover = useCallback(
    (key: NavKey | null, triggerHaptic = true) => {
      if (hoveredKeyRef.current === key) {
        return;
      }
      hoveredKeyRef.current = key;
      setHoveredKey(key);
      if (key && triggerHaptic) {
        Haptics.selectionAsync().catch(() => undefined);
      }
    },
    []
  );

  const handleButtonLayout = useCallback((key: NavKey, event: LayoutChangeEvent) => {
    const { x, width } = event.nativeEvent.layout;
    buttonLayouts.current[key] = { x, width };
  }, []);

  const handleHoverAtX = useCallback(
    (x: number) => {
      const nextKey =
        NAV_ITEMS.find(item => {
          const layout = buttonLayouts.current[item.key];
          if (!layout) {
            return false;
          }
          return x >= layout.x && x <= layout.x + layout.width;
        })?.key ?? null;
      setHover(nextKey, true);
    },
    [setHover]
  );

  const commitSelection = useCallback(
    (key: NavKey | null) => {
      if (!key) {
        return;
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
      setHover(null, false);
      onSelect(key);
    },
    [onSelect, setHover]
  );

  const handleGestureEvent = useCallback(
    (event: PanGestureHandlerGestureEvent) => {
      handleHoverAtX(event.nativeEvent.x);
    },
    [handleHoverAtX]
  );

  const handleGestureStateChange = useCallback(
    (event: PanGestureHandlerStateChangeEvent) => {
      const { state, x } = event.nativeEvent;

      if (state === State.BEGAN) {
        isDraggingRef.current = false;
      }

      if (state === State.BEGAN || state === State.ACTIVE) {
        handleHoverAtX(x);
      }

      if (state === State.ACTIVE) {
        isDraggingRef.current = true;
      }

      if (
        state === State.END ||
        state === State.CANCELLED ||
        state === State.FAILED
      ) {
        if (isDraggingRef.current) {
          commitSelection(hoveredKeyRef.current);
        }
        isDraggingRef.current = false;
        setHover(null, false);
      }
    },
    [commitSelection, handleHoverAtX, setHover]
  );

  const handlePressIn = useCallback(
    (key: NavKey) => {
      setHover(key, false);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    },
    [setHover]
  );

  const handleLongPress = useCallback(() => {
    Haptics.selectionAsync().catch(() => undefined);
  }, []);

  return (
    <View
      pointerEvents="box-none"
      style={[styles.root, { paddingBottom: Math.max(insets.bottom, 18) }]}
    >
      <PanGestureHandler
        onGestureEvent={handleGestureEvent}
        onHandlerStateChange={handleGestureStateChange}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <BlurView intensity={85} tint="dark" style={styles.navContainer}>
          {NAV_ITEMS.map(item => {
            const Icon = item.Icon;
            const isActive = item.key === activeKey;
            const isHovering = hoveredKey === item.key;

            return (
              <Pressable
                key={item.key}
                onPressIn={() => handlePressIn(item.key)}
                onPress={() => commitSelection(item.key)}
                onLongPress={handleLongPress}
                onLayout={event => handleButtonLayout(item.key, event)}
                style={({ pressed }) => [
                  styles.navButton,
                  isActive && styles.navButtonActive,
                  (pressed || isHovering) && !isActive && styles.navButtonPressed,
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
              >
                <Icon
                  size={22}
                  color={isActive ? '#FFFFFF' : 'rgba(255,255,255,0.75)'}
                  strokeWidth={2.4}
                />
                <Text style={[styles.navLabel, isActive && styles.navLabelActive]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </BlurView>
      </PanGestureHandler>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    alignItems: 'center',
  },
  navContainer: {
    flexDirection: 'row',
    width: '100%',
    borderRadius: 28,
    padding: 10,
    gap: 10,
    backgroundColor: 'rgba(8, 20, 50, 0.45)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(132, 170, 255, 0.3)',
    overflow: 'hidden',
    shadowColor: '#02040a',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.45,
    shadowRadius: 30,
    elevation: 25,
  },
  navButton: {
    flex: 1,
    borderRadius: 20,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  navButtonActive: {
    backgroundColor: 'rgba(142, 188, 255, 0.25)',
  },
  navButtonPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  navLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 0.2,
  },
  navLabelActive: {
    color: '#FFFFFF',
  },
});

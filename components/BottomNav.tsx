import { BlurView } from 'expo-blur';
import { AlertTriangle, Home, Search, UserRound } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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

  return (
    <View
      pointerEvents="box-none"
      style={[styles.root, { paddingBottom: Math.max(insets.bottom, 18) }]}
    >
      <BlurView intensity={85} tint="dark" style={styles.navContainer}>
        {NAV_ITEMS.map(item => {
          const Icon = item.Icon;
          const isActive = item.key === activeKey;

          return (
            <Pressable
              key={item.key}
              onPress={() => onSelect(item.key)}
              style={({ pressed }) => [
                styles.navButton,
                isActive && styles.navButtonActive,
                pressed && !isActive && styles.navButtonPressed,
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
            >
              <Icon
                size={22}
                color={isActive ? '#FFFFFF' : 'rgba(255,255,255,0.75)'}
                strokeWidth={2.4}
              />
              <Text style={[styles.navLabel, isActive && styles.navLabelActive]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </BlurView>
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

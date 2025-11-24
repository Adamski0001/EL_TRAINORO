import { BlurView } from 'expo-blur';
import { Search as SearchIcon, TrainFront, Map as RouteIcon } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const SCREEN_WIDTH = Dimensions.get('window').width;

type TrainSuggestion = {
  id: string;
  title: string;
  route: string;
  status: string;
};

const MOCK_TRAINS: TrainSuggestion[] = [
  {
    id: 'SJ2001',
    title: 'SJ Snabbtåg 2001',
    route: 'Stockholm C → Göteborg C',
    status: 'Avgår 08:12 · I tid',
  },
  {
    id: 'MTRX15',
    title: 'MTRX 15',
    route: 'Stockholm C → Göteborg C',
    status: 'Avgår 09:05 · 5 min sen',
  },
  {
    id: 'ÖTÅ120',
    title: 'Öresundståg 120',
    route: 'Malmö C → Göteborg C',
    status: 'Avgår 10:25 · I tid',
  },
  {
    id: 'NORD7',
    title: 'Norrlandståget 7',
    route: 'Stockholm C → Umeå Ö',
    status: 'Avgår 11:10 · Spår 3',
  },
  {
    id: 'PENDEL48',
    title: 'Pendeltåg 48',
    route: 'Södertälje C → Uppsala C',
    status: 'Avgår 07:32 · I tid',
  },
];

type SearchPanelProps = {
  visible: boolean;
};

export function SearchPanel({ visible }: SearchPanelProps) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const translateX = useRef(new Animated.Value(SCREEN_WIDTH)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: visible ? 0 : SCREEN_WIDTH,
        duration: 260,
        easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: visible ? 1 : 0,
        duration: 220,
        easing: visible ? Easing.out(Easing.quad) : Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(() => {
      if (!visible) {
        setQuery('');
      }
    });
  }, [opacity, translateX, visible]);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return [];
    }

    return MOCK_TRAINS.filter(item => {
      return (
        item.id.toLowerCase().includes(q) ||
        item.title.toLowerCase().includes(q) ||
        item.route.toLowerCase().includes(q)
      );
    });
  }, [query]);

  const showSuggestions = query.trim().length > 0 && suggestions.length > 0;

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[
        styles.root,
        {
          paddingTop: insets.top + 12,
          transform: [{ translateX }],
          opacity,
        },
      ]}
    >
      <View style={styles.searchWrapper}>
        <BlurView intensity={70} tint="dark" style={styles.searchBar}>
          <SearchIcon size={18} color="rgba(255,255,255,0.85)" strokeWidth={2.6} />
          <TextInput
            style={styles.input}
            placeholder="Sök tågnummer eller linje"
            placeholderTextColor="rgba(255,255,255,0.6)"
            autoCapitalize="none"
            value={query}
            onChangeText={setQuery}
          />
        </BlurView>
      </View>
      {showSuggestions && (
        <View style={styles.suggestionsList}>
          {suggestions.map(item => (
            <BlurView key={item.id} intensity={65} tint="dark" style={styles.suggestionCard}>
              <View style={styles.suggestionIcon}>
                <TrainFront size={18} color="#fff" strokeWidth={2.4} />
              </View>
              <View style={styles.suggestionBody}>
                <Text style={styles.suggestionTitle}>{item.title}</Text>
                <View style={styles.routeRow}>
                  <RouteIcon size={14} color="rgba(255,255,255,0.5)" strokeWidth={2} />
                  <Text style={styles.suggestionRoute}>{item.route}</Text>
                </View>
                <Text style={styles.suggestionStatus}>{item.status}</Text>
              </View>
              <Text style={styles.trainId}>{item.id}</Text>
            </BlurView>
          ))}
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    right: 0,
    paddingHorizontal: 20,
  },
  searchWrapper: {
    width: SCREEN_WIDTH - 40,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 22,
    overflow: 'hidden',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(5, 12, 28, 0.5)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#020617',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
  },
  suggestionsList: {
    width: SCREEN_WIDTH - 40,
    marginTop: 14,
    gap: 8,
  },
  suggestionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
    borderRadius: 18,
    overflow: 'hidden',
    paddingHorizontal: 12,
    backgroundColor: 'rgba(6, 16, 36, 0.4)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#010712',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#fff',
  },
  suggestionIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionBody: {
    flex: 1,
    gap: 2,
  },
  suggestionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  suggestionRoute: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.75)',
  },
  suggestionStatus: {
    fontSize: 12,
    color: 'rgba(142, 188, 255, 0.9)',
  },
  trainId: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.6)',
  },
});

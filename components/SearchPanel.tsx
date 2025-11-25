import { BlurView } from 'expo-blur';
import { Search as SearchIcon, TrainFront, Map as RouteIcon } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useTrainSearchIndex } from '../hooks/useTrainSearchIndex';
import type { TrainPosition } from '../types/trains';

const SCREEN_WIDTH = Dimensions.get('window').width;

type SearchPanelProps = {
  visible: boolean;
  onSelectTrain: (train: TrainPosition) => void;
  onRequestClose: () => void;
};

export function SearchPanel({ visible, onSelectTrain, onRequestClose }: SearchPanelProps) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const translateX = useSharedValue(SCREEN_WIDTH);
  const opacity = useSharedValue(0);
  const { items } = useTrainSearchIndex();

  useEffect(() => {
    const shouldReset = !visible;
    translateX.value = withTiming(visible ? 0 : SCREEN_WIDTH, {
      duration: 260,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
    }, finished => {
      if (finished && shouldReset) {
        runOnJS(setQuery)('');
      }
    });
    opacity.value = withTiming(visible ? 1 : 0, {
      duration: 220,
      easing: visible ? Easing.out(Easing.quad) : Easing.in(Easing.quad),
    });
  }, [opacity, translateX, visible]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    opacity: opacity.value,
  }));

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return [];
    }
    return items.filter(item => item.searchText.includes(q)).slice(0, 10);
  }, [items, query]);

  const showSuggestions = query.trim().length > 0 && suggestions.length > 0;
  const handleSelectSuggestion = useCallback(
    (train: TrainPosition) => {
      onSelectTrain(train);
      onRequestClose();
    },
    [onRequestClose, onSelectTrain],
  );

  const handleSubmit = useCallback(() => {
    if (!suggestions.length) {
      return;
    }
    handleSelectSuggestion(suggestions[0].train);
  }, [handleSelectSuggestion, suggestions]);

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[
        styles.root,
        { paddingTop: insets.top + 12 },
        animatedStyle,
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
            onSubmitEditing={handleSubmit}
            returnKeyType="search"
          />
        </BlurView>
      </View>
      {showSuggestions && (
        <View style={styles.suggestionsList}>
          {suggestions.map(item => (
            <Pressable
              key={item.id}
              onPress={() => handleSelectSuggestion(item.train)}
              style={({ pressed }) => [styles.suggestionPressable, pressed && styles.suggestionPressablePressed]}
            >
              <BlurView intensity={65} tint="dark" style={styles.suggestionCard}>
                <View style={styles.suggestionIcon}>
                  <TrainFront size={18} color="#fff" strokeWidth={2.4} />
                </View>
                <View style={styles.suggestionBody}>
                  <Text style={styles.suggestionTitle}>{item.title}</Text>
                  <View style={styles.routeRow}>
                    <RouteIcon size={14} color="rgba(255,255,255,0.5)" strokeWidth={2} />
                    <Text style={styles.suggestionRoute}>{item.routeText ?? 'Rutt saknas'}</Text>
                  </View>
                  <Text style={styles.suggestionStatus}>{item.subtitle ?? 'Ingen operatör tillgänglig'}</Text>
                </View>
                <Text style={styles.trainId}>
                  {item.train.advertisedTrainIdent ?? item.train.operationalTrainNumber ?? item.id}
                </Text>
              </BlurView>
            </Pressable>
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
  suggestionPressable: {
    borderRadius: 18,
  },
  suggestionPressablePressed: {
    transform: [{ scale: 0.995 }],
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

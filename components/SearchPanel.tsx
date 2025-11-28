import { BlurView } from 'expo-blur';
import { Map as RouteIcon, MapPin, Search as SearchIcon, Star, TrainFront } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { GestureResponderEvent } from 'react-native';
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
import { useUserProfile } from '../hooks/useUserProfile';
import { useStations } from '../hooks/useStations';
import type { Station } from '../types/stations';

const SCREEN_WIDTH = Dimensions.get('window').width;

type SearchPanelProps = {
  visible: boolean;
  onSelectTrain: (train: TrainPosition) => void;
  onSelectStation: (station: Station) => void;
  onRequestClose: () => void;
  topOffset?: number;
};

type TrainSuggestion = {
  type: 'train';
  id: string;
  title: string;
  subtitle: string | null;
  routeText: string | null;
  train: TrainPosition;
  searchText: string;
};

type StationSuggestion = {
  type: 'station';
  id: string;
  title: string;
  subtitle: string | null;
  regionLabel: string | null;
  linesLabel: string | null;
  signature: string;
  station: Station;
  searchText: string;
};

type SearchSuggestion = TrainSuggestion | StationSuggestion;

export function SearchPanel({
  visible,
  onSelectTrain,
  onSelectStation,
  onRequestClose,
  topOffset = 0,
}: SearchPanelProps) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const translateX = useSharedValue(SCREEN_WIDTH);
  const opacity = useSharedValue(0);
  const { items } = useTrainSearchIndex();
  const { stations } = useStations();
  const profile = useUserProfile();
  const inputRef = useRef<TextInput | null>(null);
  const favoriteSet = useMemo(() => new Set(profile.favorites), [profile.favorites]);
  const trainSuggestions = useMemo<TrainSuggestion[]>(
    () =>
      items.map(item => ({
        ...item,
        type: 'train' as const,
      })),
    [items],
  );
  const stationSuggestions = useMemo<StationSuggestion[]>(() => {
    return stations.map(station => {
      const linesLabel =
        station.lines.length > 0
          ? station.lines
              .map(line => line.name)
              .filter(Boolean)
              .slice(0, 3)
              .join(' • ')
          : null;
      const nameFields = [
        station.displayName,
        station.shortDisplayName ?? '',
        station.officialName ?? '',
        station.signature,
        ...station.displayNames,
      ];
      const haystack = nameFields
        .join(' ')
        .toLowerCase();
      return {
        type: 'station' as const,
        id: station.id,
        title: station.displayName,
        subtitle: station.officialName ?? station.shortDisplayName ?? null,
        regionLabel: station.region,
        linesLabel,
        signature: station.signature,
        station,
        searchText: haystack,
      };
    });
  }, [stations]);

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

  useEffect(() => {
    if (visible) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 120);
      return () => {
        clearTimeout(timer);
      };
    }
    inputRef.current?.blur();
  }, [visible]);

  const suggestions = useMemo<SearchSuggestion[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return [];
    }
    const scoredStations = stationSuggestions
      .filter(item => item.searchText.includes(q))
      .map(item => {
        const index = item.title.toLowerCase().indexOf(q);
        return { item, score: index === -1 ? Number.MAX_SAFE_INTEGER : index };
      })
      .sort((a, b) => a.score - b.score || a.item.title.localeCompare(b.item.title))
      .map(entry => entry.item);
    const stationMatches = scoredStations.slice(0, 3);
    const remainingSlots = Math.max(0, 10 - stationMatches.length);
    const trainMatches = trainSuggestions
      .filter(item => item.searchText.includes(q))
      .slice(0, remainingSlots);
    return [...stationMatches, ...trainMatches];
  }, [query, stationSuggestions, trainSuggestions]);

  const showSuggestions = query.trim().length > 0 && suggestions.length > 0;
  const handleSelectSuggestion = useCallback(
    (suggestion: SearchSuggestion) => {
      if (suggestion.type === 'train') {
        onSelectTrain(suggestion.train);
      } else {
        onSelectStation(suggestion.station);
      }
      onRequestClose();
    },
    [onRequestClose, onSelectStation, onSelectTrain],
  );

  const handleSubmit = useCallback(() => {
    if (!suggestions.length) {
      return;
    }
    handleSelectSuggestion(suggestions[0]);
  }, [handleSelectSuggestion, suggestions]);

  const handleToggleFavorite = useCallback(
    (trainId: string, event: GestureResponderEvent) => {
      event.stopPropagation();
      profile.toggleFavoriteTrain(trainId);
    },
    [profile],
  );

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[styles.root, { paddingTop: insets.top + 12 + topOffset }, animatedStyle]}
    >
      <View style={styles.searchWrapper}>
        <BlurView intensity={70} tint="dark" style={styles.searchBar}>
          <SearchIcon size={18} color="rgba(255,255,255,0.85)" strokeWidth={2.6} />
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder="Sök tåg, linje eller station"
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
        <ScrollView style={styles.suggestionsList} contentContainerStyle={styles.suggestionsContent}>
          {suggestions.map(item => {
            const isTrain = item.type === 'train';
            const isFavorite = isTrain ? favoriteSet.has(item.id) : false;
            const primaryDetail = isTrain ? item.routeText ?? 'Rutt saknas' : item.linesLabel ?? 'Station';
            const secondaryDetail = isTrain
              ? item.subtitle ?? 'Ingen operatör tillgänglig'
              : item.regionLabel ?? 'Station';
            const badge = isTrain
              ? item.train.advertisedTrainIdent ?? item.train.operationalTrainNumber ?? item.id
              : item.signature;
            return (
              <Pressable
                key={`${item.type}-${item.id}`}
                onPress={() => handleSelectSuggestion(item)}
                style={({ pressed }) => [styles.suggestionPressable, pressed && styles.suggestionPressablePressed]}
              >
                <BlurView intensity={65} tint="dark" style={styles.suggestionCard}>
                  <View style={styles.suggestionIcon}>
                    {isTrain ? (
                      <TrainFront size={18} color="#fff" strokeWidth={2.4} />
                    ) : (
                      <MapPin size={18} color="#fff" strokeWidth={2.4} />
                    )}
                  </View>
                  <View style={styles.suggestionBody}>
                    <Text style={styles.suggestionTitle}>{item.title}</Text>
                    <View style={styles.routeRow}>
                      {isTrain ? (
                        <RouteIcon size={14} color="rgba(255,255,255,0.5)" strokeWidth={2} />
                      ) : (
                        <MapPin size={14} color="rgba(255,255,255,0.5)" strokeWidth={2} />
                      )}
                      <Text style={styles.suggestionRoute}>{primaryDetail}</Text>
                    </View>
                    <Text style={styles.suggestionStatus}>{secondaryDetail}</Text>
                  </View>
                  <View style={styles.suggestionTrailing}>
                    <Text style={styles.trainId}>
                      {badge}
                    </Text>
                    {isTrain && (
                      <Pressable
                        onPress={event => handleToggleFavorite(item.id, event)}
                        style={({ pressed }) => [styles.favoriteButton, pressed && styles.favoriteButtonPressed]}
                      >
                        <Star
                          size={18}
                          color={isFavorite ? '#ffd564' : 'rgba(255,255,255,0.6)'}
                          strokeWidth={2.2}
                        />
                      </Pressable>
                    )}
                  </View>
                </BlurView>
              </Pressable>
            );
          })}
        </ScrollView>
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
    zIndex: 30,
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
    maxHeight: 360,
  },
  suggestionsContent: {
    gap: 8,
    paddingBottom: 12,
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
  suggestionTrailing: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 6,
  },
  trainId: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'right',
  },
  favoriteButton: {
    borderRadius: 999,
    padding: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  favoriteButtonPressed: {
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
});

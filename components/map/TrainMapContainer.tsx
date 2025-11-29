import { BlurView } from 'expo-blur';
import { memo, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type { Region } from 'react-native-maps';

import { useStations } from '../../hooks/useStations';
import { useTrainPositions } from '../../hooks/useTrainPositions';
import { trainRouteRegistry } from '../../state/trainRouteRegistry';
import type { Station } from '../../types/stations';
import type { TrainPosition } from '../../types/trains';
import { TrainMap } from './TrainMap';
import type { MapFocusRequest } from './TrainMap';

type TrainMapContainerProps = {
  style?: StyleProp<ViewStyle>;
  initialRegion: Region;
  tileUrl: string;
  selectedTrainId: string | null;
  selectedStationId: string | null;
  onSelectTrain: (train: TrainPosition) => void;
  onSelectStation: (station: Station) => void;
  focusRequest: MapFocusRequest | null;
};

function TrainMapContainerComponent({
  style,
  initialRegion,
  tileUrl,
  selectedTrainId,
  onSelectTrain,
  selectedStationId,
  onSelectStation,
  focusRequest,
}: TrainMapContainerProps) {
  const { trains, loading: trainsLoading, lastUpdated } = useTrainPositions();
  const [ready, setReady] = useState(false);
  const [showOverlay, setShowOverlay] = useState(true);
  const overlayOpacity = useMemo(() => new Animated.Value(1), []);
  const { stations } = useStations();
  const routeSnapshot = useSyncExternalStore(
    trainRouteRegistry.subscribe,
    trainRouteRegistry.getSnapshot,
    trainRouteRegistry.getSnapshot,
  );

  useEffect(() => {
    trainRouteRegistry.ensureRoutesFor(trains);
  }, [trains]);

  useEffect(() => {
    if (ready) {
      return;
    }
    if (!trainsLoading && (trains.length > 0 || lastUpdated)) {
      setReady(true);
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          setShowOverlay(false);
        }
      });
    }
  }, [lastUpdated, overlayOpacity, ready, trains.length, trainsLoading]);

  const filteredTrains = useMemo(() => {
    const routes = routeSnapshot.routes;
    return trains.filter(train => {
      const route = routes.get(train.id);
      if (!route) {
        return true;
      }
      if (!route.resolved) {
        return true;
      }
      return Boolean(route.from || route.to);
    });
  }, [routeSnapshot.version, trains]);

  const handleSelect = useCallback(
    (train: TrainPosition) => {
      onSelectTrain(train);
    },
    [onSelectTrain],
  );

  return (
    <View style={styles.container}>
      <TrainMap
        style={style}
        initialRegion={initialRegion}
        tileUrl={tileUrl}
        trains={filteredTrains}
        stations={stations}
        selectedTrainId={selectedTrainId}
        selectedStationId={selectedStationId}
        onSelectTrain={handleSelect}
        onSelectStation={onSelectStation}
        focusRequest={focusRequest}
      />
      {showOverlay ? (
        <Animated.View pointerEvents="none" style={[styles.overlay, { opacity: overlayOpacity }]}>
          <BlurView intensity={60} tint="dark" style={StyleSheet.absoluteFill}>
            <View style={styles.loaderContent}>
              <ActivityIndicator color="#FFFFFF" size="large" />
              <Text style={styles.loaderText}>Laddar tågen på kartan...</Text>
            </View>
          </BlurView>
        </Animated.View>
      ) : null}
    </View>
  );
}

export const TrainMapContainer = memo(TrainMapContainerComponent);

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loaderContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#050a16',
    paddingHorizontal: 24,
    gap: 12,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
  },
  loaderContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(5,10,22,0.32)',
    gap: 12,
    paddingHorizontal: 24,
  },
  loaderText: {
    color: '#FFFFFF',
    fontSize: 15,
    textAlign: 'center',
    opacity: 0.85,
  },
});

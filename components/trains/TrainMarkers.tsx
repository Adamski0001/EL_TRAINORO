import { memo, useCallback, useMemo } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Marker, type Region } from 'react-native-maps';

import type { TrainPosition } from '../../types/trains';
import { haptics } from '../../lib/haptics';

type TrainMarkersProps = {
  trains: TrainPosition[];
  selectedTrainId?: string | null;
  onSelectTrain: (train: TrainPosition) => void;
  viewportRegion: Region;
};

const TRAIN_ICON = require('../../assets/train-icon.png');
const TRAIN_ICON_HEADING_OFFSET = 180;
const VIEWPORT_BUFFER = 1.25;

const normalizeBearing = (bearing?: number | null) => {
  if (bearing === null || typeof bearing === 'undefined' || Number.isNaN(bearing)) {
    return 0;
  }
  const normalized = ((bearing % 360) + 360) % 360;
  return (normalized + TRAIN_ICON_HEADING_OFFSET) % 360;
};

type TrainMarkerProps = {
  train: TrainPosition;
  selected: boolean;
  onSelectTrain: (train: TrainPosition) => void;
};

const TrainMarker = memo(
  ({ train, selected, onSelectTrain }: TrainMarkerProps) => {
    const heading = normalizeBearing(train.bearing);
    const handlePress = useCallback(() => {
      onSelectTrain(train);
      haptics.light();
    }, [onSelectTrain, train]);

    return (
      <Marker
        coordinate={{
          latitude: train.coordinate.latitude,
          longitude: train.coordinate.longitude,
        }}
        anchor={{ x: 0.5, y: 0.5 }}
        tracksViewChanges={false}
        zIndex={10}
        onPress={handlePress}
      >
        <View style={[styles.markerWrapper, selected && styles.markerWrapperSelected]}>
          <View style={[styles.rotationWrapper, { transform: [{ rotate: `${heading}deg` }] }]}>
            <Image source={TRAIN_ICON} style={[styles.icon, selected && styles.iconSelected]} />
          </View>
        </View>
      </Marker>
    );
  },
  (prev, next) =>
    prev.train === next.train && prev.selected === next.selected && prev.onSelectTrain === next.onSelectTrain,
);

const buildViewportFilter = (region: Region) => {
  const latBuffer = (region.latitudeDelta / 2) * VIEWPORT_BUFFER;
  const lonBuffer = (region.longitudeDelta / 2) * VIEWPORT_BUFFER;
  const minLat = region.latitude - latBuffer;
  const maxLat = region.latitude + latBuffer;
  const minLon = region.longitude - lonBuffer;
  const maxLon = region.longitude + lonBuffer;

  return (train: TrainPosition) => {
    const { latitude, longitude } = train.coordinate;
    return latitude >= minLat && latitude <= maxLat && longitude >= minLon && longitude <= maxLon;
  };
};

function TrainMarkersComponent({ trains, selectedTrainId, onSelectTrain, viewportRegion }: TrainMarkersProps) {
  const visibleTrains = useMemo(() => {
    if (!trains.length) {
      return [];
    }
    const withinViewport = buildViewportFilter(viewportRegion);
    const filtered = trains.filter(withinViewport);

    // Mild thinning only for extreme cases
    if (filtered.length > 1200) {
      return filtered.filter((_, index) => index % 2 === 0);
    }
    return filtered;
  }, [trains, viewportRegion]);

  return (
    <>
      {visibleTrains.map(train => (
        <TrainMarker
          key={train.id}
          train={train}
          selected={train.id === selectedTrainId}
          onSelectTrain={onSelectTrain}
        />
      ))}
    </>
  );
}

export const TrainMarkers = memo(TrainMarkersComponent);

const styles = StyleSheet.create({
  markerWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 6,
    elevation: 5,
  },
  markerWrapperSelected: {
    shadowOpacity: 0.4,
    shadowRadius: 10,
  },
  rotationWrapper: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    width: 34,
    height: 34,
    resizeMode: 'contain',
  },
  iconSelected: {
    transform: [{ scale: 1.05 }],
  },
});

import { memo, useCallback } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Marker } from 'react-native-maps';

import type { TrainPosition } from '../../types/trains';

type TrainMarkersProps = {
  trains: TrainPosition[];
  selectedTrainId?: string | null;
  onSelectTrain: (train: TrainPosition) => void;
};

const TRAIN_ICON = require('../../assets/train-icon.png');
const TRAIN_ICON_HEADING_OFFSET = 180;

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
    }, [onSelectTrain, train]);

    return (
      <Marker
        coordinate={{
          latitude: train.coordinate.latitude,
          longitude: train.coordinate.longitude,
        }}
        anchor={{ x: 0.5, y: 0.5 }}
        tracksViewChanges={false}
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

function TrainMarkersComponent({ trains, selectedTrainId, onSelectTrain }: TrainMarkersProps) {
  return (
    <>
      {trains.map(train => (
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

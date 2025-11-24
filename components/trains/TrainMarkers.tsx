import { memo, useMemo } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Marker } from 'react-native-maps';

import type { TrainPosition } from '../../types/trains';

type TrainMarkersProps = {
  trains: TrainPosition[];
  selectedTrainId?: string | null;
  onSelectTrain: (train: TrainPosition) => void;
};

const TRAIN_ICON = require('../../assets/train-icon.png');

const normalizeBearing = (bearing: number) => {
  const normalized = ((bearing % 360) + 360) % 360;
  // Icon nose points south by default, so rotate 180° to align with heading.
  return (normalized + 180) % 360;
};

function TrainMarkersComponent({ trains, selectedTrainId, onSelectTrain }: TrainMarkersProps) {
  const markerElements = useMemo(
    () =>
      trains.map(train => {
        const selected = train.id === selectedTrainId;
        return (
          <Marker
            key={train.id}
            coordinate={{
              latitude: train.coordinate.latitude,
              longitude: train.coordinate.longitude,
            }}
            flat
            anchor={{ x: 0.5, y: 0.5 }}
            rotation={normalizeBearing(train.bearing ?? 0)}
            tracksViewChanges={false}
            onPress={() => onSelectTrain(train)}
          >
            <View style={[styles.markerWrapper, selected && styles.markerWrapperSelected]}>
              <Image source={TRAIN_ICON} style={[styles.icon, selected && styles.iconSelected]} />
            </View>
          </Marker>
        );
      }),
    [onSelectTrain, selectedTrainId, trains],
  );

  return <>{markerElements}</>;
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
  icon: {
    width: 34,
    height: 34,
    resizeMode: 'contain',
  },
  iconSelected: {
    transform: [{ scale: 1.05 }],
  },
});

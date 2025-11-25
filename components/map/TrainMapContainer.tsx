import { memo, useCallback } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import type { Region } from 'react-native-maps';

import { useTrainPositions } from '../../hooks/useTrainPositions';
import type { TrainPosition } from '../../types/trains';
import { TrainMap } from './TrainMap';

type TrainMapContainerProps = {
  style?: StyleProp<ViewStyle>;
  initialRegion: Region;
  tileUrl: string;
  selectedTrainId: string | null;
  onSelectTrain: (train: TrainPosition) => void;
};

function TrainMapContainerComponent({
  style,
  initialRegion,
  tileUrl,
  selectedTrainId,
  onSelectTrain,
}: TrainMapContainerProps) {
  const { trains } = useTrainPositions();
  const handleSelect = useCallback(
    (train: TrainPosition) => {
      onSelectTrain(train);
    },
    [onSelectTrain],
  );

  return (
    <TrainMap
      style={style}
      initialRegion={initialRegion}
      tileUrl={tileUrl}
      trains={trains}
      selectedTrainId={selectedTrainId}
      onSelectTrain={handleSelect}
    />
  );
}

export const TrainMapContainer = memo(TrainMapContainerComponent);

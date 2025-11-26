import { memo, useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import type { Region } from 'react-native-maps';

import { useTrainPositions } from '../../hooks/useTrainPositions';
import { trainRouteRegistry } from '../../state/trainRouteRegistry';
import type { TrainPosition } from '../../types/trains';
import { TrainMap } from './TrainMap';

type TrainMapContainerProps = {
  style?: StyleProp<ViewStyle>;
  initialRegion: Region;
  tileUrl: string;
  selectedTrainId: string | null;
  onSelectTrain: (train: TrainPosition) => void;
  focusRequest: { trainId: string; token: number } | null;
};

function TrainMapContainerComponent({
  style,
  initialRegion,
  tileUrl,
  selectedTrainId,
  onSelectTrain,
  focusRequest,
}: TrainMapContainerProps) {
  const { trains } = useTrainPositions();
  const routeSnapshot = useSyncExternalStore(
    trainRouteRegistry.subscribe,
    trainRouteRegistry.getSnapshot,
    trainRouteRegistry.getSnapshot,
  );

  useEffect(() => {
    trainRouteRegistry.ensureRoutesFor(trains);
  }, [trains]);

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
    <TrainMap
      style={style}
      initialRegion={initialRegion}
      tileUrl={tileUrl}
      trains={filteredTrains}
      selectedTrainId={selectedTrainId}
      onSelectTrain={handleSelect}
      focusRequest={focusRequest}
    />
  );
}

export const TrainMapContainer = memo(TrainMapContainerComponent);

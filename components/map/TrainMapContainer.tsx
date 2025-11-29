import { memo, useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
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
  const { trains } = useTrainPositions();
  const { stations } = useStations();
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
      return Boolean(route?.from || route?.to);
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
        stations={stations}
        selectedTrainId={selectedTrainId}
        selectedStationId={selectedStationId}
        onSelectTrain={handleSelect}
        onSelectStation={onSelectStation}
        focusRequest={focusRequest}
      />
  );
}

export const TrainMapContainer = memo(TrainMapContainerComponent);

import { memo, useEffect, useRef } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import MapView, { Region, UrlTile } from 'react-native-maps';

import type { TrainPosition } from '../../types/trains';
import { TrainMarkers } from '../trains/TrainMarkers';

type FocusRequest = {
  trainId: string;
  token: number;
} | null;

type TrainMapProps = {
  style?: StyleProp<ViewStyle>;
  initialRegion: Region;
  tileUrl: string;
  trains: TrainPosition[];
  selectedTrainId: string | null;
  onSelectTrain: (train: TrainPosition) => void;
  focusRequest: FocusRequest;
};

function TrainMapComponent({
  style,
  initialRegion,
  tileUrl,
  trains,
  selectedTrainId,
  onSelectTrain,
  focusRequest,
}: TrainMapProps) {
  const mapRef = useRef<MapView | null>(null);

  useEffect(() => {
    if (!focusRequest) {
      return;
    }
    const target = trains.find(train => train.id === focusRequest.trainId);
    if (!target || !mapRef.current) {
      return;
    }
    mapRef.current.animateToRegion(
      {
        latitude: target.coordinate.latitude,
        longitude: target.coordinate.longitude,
        latitudeDelta: 2,
        longitudeDelta: 2,
      },
      650,
    );
  }, [focusRequest, trains]);

  return (
    <MapView
      ref={map => {
        mapRef.current = map;
      }}
      style={style}
      initialRegion={initialRegion}
      showsCompass
      toolbarEnabled={false}
      moveOnMarkerPress={false}
    >
      <UrlTile urlTemplate={tileUrl} maximumZ={19} zIndex={2} tileSize={256} />
      <TrainMarkers
        trains={trains}
        selectedTrainId={selectedTrainId}
        onSelectTrain={onSelectTrain}
      />
    </MapView>
  );
}

export const TrainMap = memo(
  TrainMapComponent,
  (prev, next) =>
    prev.trains === next.trains &&
    prev.selectedTrainId === next.selectedTrainId &&
    prev.onSelectTrain === next.onSelectTrain &&
    prev.initialRegion === next.initialRegion &&
    prev.tileUrl === next.tileUrl &&
    prev.style === next.style &&
    prev.focusRequest === next.focusRequest,
);

import { memo, useEffect, useRef } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import MapView, { MapStyleElement, Region, UrlTile } from 'react-native-maps';

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

const DARK_MAP_STYLE: MapStyleElement[] = [
  { elementType: 'geometry', stylers: [{ color: '#0a0f1f' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#929cb8' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0a0f1f' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#1a2033' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#12182b' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#0f1c24' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1d2a35' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#8aa1b4' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#2c3747' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#041224' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#182031' }, { visibility: 'off' }] },
];

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
    <View style={[styles.container, style]}>
      <MapView
        ref={map => {
          mapRef.current = map;
        }}
        style={StyleSheet.absoluteFill}
        initialRegion={initialRegion}
        showsCompass
        toolbarEnabled={false}
        moveOnMarkerPress={false}
        userInterfaceStyle="dark"
        customMapStyle={DARK_MAP_STYLE}
      >
        <UrlTile urlTemplate={tileUrl} maximumZ={19} zIndex={2} tileSize={256} />
        <TrainMarkers
          trains={trains}
          selectedTrainId={selectedTrainId}
          onSelectTrain={onSelectTrain}
        />
      </MapView>
      <View pointerEvents="none" style={styles.overlay} />
    </View>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(1, 4, 12, 0.35)',
  },
});

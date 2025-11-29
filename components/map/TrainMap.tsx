import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import MapView, { MapStyleElement, Region, UrlTile } from 'react-native-maps';

import type { Station } from '../../types/stations';
import type { TrainPosition } from '../../types/trains';
import { StationMarkers } from '../stations/StationMarkers';
import { TrainMarkers } from '../trains/TrainMarkers';

export type MapFocusRequest =
  | { type: 'train'; id: string; token: number }
  | { type: 'station'; id: string; token: number };

type TrainMapProps = {
  style?: StyleProp<ViewStyle>;
  initialRegion: Region;
  tileUrl: string;
  trains: TrainPosition[];
  stations: Station[];
  selectedTrainId: string | null;
  selectedStationId: string | null;
  onSelectTrain: (train: TrainPosition) => void;
  onSelectStation: (station: Station) => void;
  focusRequest: MapFocusRequest | null;
};

const STATION_VISIBILITY_ZOOM_LEVEL = 8.2;

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

const computeZoomLevelFromDelta = (latitudeDelta: number) => {
  if (!latitudeDelta || latitudeDelta <= 0) {
    return STATION_VISIBILITY_ZOOM_LEVEL;
  }
  return Math.log2(360 / latitudeDelta);
};

const shouldShowStationsForDelta = (latitudeDelta: number) =>
  computeZoomLevelFromDelta(latitudeDelta) >= STATION_VISIBILITY_ZOOM_LEVEL;

function TrainMapComponent({
  style,
  initialRegion,
  tileUrl,
  trains,
  stations,
  selectedTrainId,
  selectedStationId,
  onSelectTrain,
  onSelectStation,
  focusRequest,
}: TrainMapProps) {
  const initialStationVisibility = shouldShowStationsForDelta(initialRegion.latitudeDelta);
  const mapRef = useRef<MapView | null>(null);
  const stationOpacity = useRef(new Animated.Value(initialStationVisibility ? 1 : 0)).current;
  const [stationZoomVisible, setStationZoomVisible] = useState(initialStationVisibility);

  useEffect(() => {
    Animated.timing(stationOpacity, {
      toValue: stationZoomVisible ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [stationOpacity, stationZoomVisible]);

  const handleRegionChangeComplete = useCallback((region: Region) => {
    setStationZoomVisible(shouldShowStationsForDelta(region.latitudeDelta));
  }, []);

  useEffect(() => {
    if (!focusRequest) {
      return;
    }
    if (!mapRef.current) {
      return;
    }

    let targetCoordinate = null;

    if (focusRequest.type === 'train') {
      const targetTrain = trains.find(train => train.id === focusRequest.id);
      if (targetTrain) {
        targetCoordinate = targetTrain.coordinate;
      }
    } else {
      const targetStation = stations.find(station => station.id === focusRequest.id);
      if (targetStation?.coordinate) {
        targetCoordinate = targetStation.coordinate;
      }
    }

    if (!targetCoordinate) {
      return;
    }

    mapRef.current.animateToRegion(
      {
        latitude: targetCoordinate.latitude,
        longitude: targetCoordinate.longitude,
        latitudeDelta: 2,
        longitudeDelta: 2,
      },
      650,
    );
  }, [focusRequest, stations, trains]);

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
        onRegionChangeComplete={handleRegionChangeComplete}
      >
        <UrlTile urlTemplate={tileUrl} maximumZ={19} zIndex={2} tileSize={256} />
        <StationMarkers
          stations={stations}
          selectedStationId={selectedStationId}
          onSelectStation={onSelectStation}
          opacity={stationOpacity}
          visible={stationZoomVisible}
        />
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
    prev.stations === next.stations &&
    prev.selectedTrainId === next.selectedTrainId &&
    prev.selectedStationId === next.selectedStationId &&
    prev.onSelectTrain === next.onSelectTrain &&
    prev.onSelectStation === next.onSelectStation &&
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

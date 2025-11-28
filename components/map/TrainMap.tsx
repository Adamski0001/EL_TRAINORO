import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
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

const ZOOMED_OUT_LATITUDE_DELTA = 6;
const CULL_RADIUS_KM = 90;
const EARTH_RADIUS_KM = 6371;

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
  stations,
  selectedTrainId,
  selectedStationId,
  onSelectTrain,
  onSelectStation,
  focusRequest,
}: TrainMapProps) {
  const mapRef = useRef<MapView | null>(null);
  const [mapRegion, setMapRegion] = useState<Region | null>(null);

  const activeRegion = mapRegion ?? initialRegion;
  const shouldCullToCenter = activeRegion.latitudeDelta > ZOOMED_OUT_LATITUDE_DELTA;
  const cullRadiusKm = shouldCullToCenter ? CULL_RADIUS_KM : null;

  const isWithinCullCircle = useCallback(
    (latitude: number, longitude: number) => {
      if (!cullRadiusKm) {
        return true;
      }

      const lat1 = (activeRegion.latitude * Math.PI) / 180;
      const lat2 = (latitude * Math.PI) / 180;
      const dLat = ((latitude - activeRegion.latitude) * Math.PI) / 180;
      const dLon = ((longitude - activeRegion.longitude) * Math.PI) / 180;

      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distanceKm = EARTH_RADIUS_KM * c;

      return distanceKm <= cullRadiusKm;
    },
    [activeRegion.latitude, activeRegion.longitude, cullRadiusKm],
  );

  const visibleStations = useMemo(() => {
    if (!cullRadiusKm) {
      return stations;
    }

    return stations.filter(station => {
      if (!station.coordinate) {
        return false;
      }
      return isWithinCullCircle(station.coordinate.latitude, station.coordinate.longitude);
    });
  }, [cullRadiusKm, isWithinCullCircle, stations]);

  const visibleTrains = useMemo(() => {
    if (!cullRadiusKm) {
      return trains;
    }

    return trains.filter(train =>
      isWithinCullCircle(train.coordinate.latitude, train.coordinate.longitude),
    );
  }, [cullRadiusKm, isWithinCullCircle, trains]);

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

    const nextRegion: Region = {
      latitude: targetCoordinate.latitude,
      longitude: targetCoordinate.longitude,
      latitudeDelta: 2,
      longitudeDelta: 2,
    };

    setMapRegion(nextRegion);
    mapRef.current.animateToRegion(nextRegion, 650);
  }, [focusRequest, stations, trains]);

  const handleRegionChangeComplete = useCallback((region: Region) => {
    setMapRegion(region);
  }, []);

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
          stations={visibleStations}
          selectedStationId={selectedStationId}
          onSelectStation={onSelectStation}
        />
        <TrainMarkers
          trains={visibleTrains}
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

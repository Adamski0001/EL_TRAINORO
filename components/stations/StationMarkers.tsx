import { memo, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Marker } from 'react-native-maps';

import type { Station } from '../../types/stations';

type StationMarkersProps = {
  stations: Station[];
  selectedStationId?: string | null;
  onSelectStation: (station: Station) => void;
};

type StationMarkerProps = {
  station: Station;
  selected: boolean;
  onSelectStation: (station: Station) => void;
};

const StationMarker = memo(
  ({ station, selected, onSelectStation }: StationMarkerProps) => {
    const handlePress = useCallback(() => {
      onSelectStation(station);
    }, [onSelectStation, station]);

    if (!station.coordinate) {
      return null;
    }

    return (
      <Marker
        coordinate={{
          latitude: station.coordinate.latitude,
          longitude: station.coordinate.longitude,
        }}
        anchor={{ x: 0.5, y: 0.5 }}
        tracksViewChanges={false}
        zIndex={1}
        onPress={handlePress}
      >
        <View style={[styles.marker, selected && styles.markerSelected]} />
      </Marker>
    );
  },
  (prev, next) =>
    prev.selected === next.selected &&
    prev.onSelectStation === next.onSelectStation &&
    prev.station.id === next.station.id &&
    prev.station.coordinate?.latitude === next.station.coordinate?.latitude &&
    prev.station.coordinate?.longitude === next.station.coordinate?.longitude,
);

// PERF NOTE:
// All stations are rendered to ensure every location (e.g., Stockholm C) is visible and searchable on the map.

function StationMarkersComponent({ stations, selectedStationId, onSelectStation }: StationMarkersProps) {
  if (__DEV__) {
    console.log('[StationMarkers][Diag] count=', stations.length);
  }

  return (
    <>
      {stations.map(station => (
        <StationMarker
          key={station.id}
          station={station}
          selected={station.id === selectedStationId}
          onSelectStation={onSelectStation}
        />
      ))}
    </>
  );
}

export const StationMarkers = memo(StationMarkersComponent);

const styles = StyleSheet.create({
  marker: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#b8bcc2',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 1.5,
    elevation: 2,
  },
  markerSelected: {
    backgroundColor: '#cfd3d8',
    transform: [{ scale: 1.15 }],
  },
});

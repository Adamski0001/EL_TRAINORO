import { memo, useCallback } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Marker } from 'react-native-maps';

import type { Station } from '../../types/stations';
import { haptics } from '../../lib/haptics';

type StationMarkersProps = {
  stations: Station[];
  selectedStationId?: string | null;
  onSelectStation: (station: Station) => void;
  opacity: Animated.Value;
  visible: boolean;
};

type StationMarkerProps = {
  station: Station;
  selected: boolean;
  onSelectStation: (station: Station) => void;
  opacity: Animated.Value;
  visible: boolean;
};

const StationMarker = memo(
  ({ station, selected, onSelectStation, opacity, visible }: StationMarkerProps) => {
    const handlePress = useCallback(() => {
      if (!visible) {
        return;
      }
      onSelectStation(station);
      haptics.light();
    }, [onSelectStation, station, visible]);

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
        <Animated.View
          pointerEvents="none"
          style={[
            styles.animatedMarker,
            {
              opacity: visible ? opacity : 0,
              transform: visible ? [{ scale: 1 }] : [{ scale: 0 }],
            },
          ]}
        >
          <View style={[styles.marker, selected && styles.markerSelected]} />
        </Animated.View>
      </Marker>
    );
  },
  (prev, next) =>
    prev.selected === next.selected &&
    prev.onSelectStation === next.onSelectStation &&
    prev.visible === next.visible &&
    prev.station.id === next.station.id &&
    prev.station.coordinate?.latitude === next.station.coordinate?.latitude &&
    prev.station.coordinate?.longitude === next.station.coordinate?.longitude,
);

// PERF NOTE:
// Markers stay mounted but fade out when zoomed out (controlled by TrainMap) to avoid map child churn.

function StationMarkersComponent({ stations, selectedStationId, onSelectStation, opacity, visible }: StationMarkersProps) {
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
          opacity={opacity}
          visible={visible}
        />
      ))}
    </>
  );
}

export const StationMarkers = memo(StationMarkersComponent);

const styles = StyleSheet.create({
  animatedMarker: {
    width: 14,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
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

import { memo, useCallback } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Marker } from 'react-native-maps';

import type { Station } from '../../types/stations';

const STATION_ICON = require('../../assets/station-icon.png');
const STATION_ICON_SELECTED = require('../../assets/station-icon-selected.png');

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
        onPress={handlePress}
      >
        <View style={[styles.markerWrapper, selected && styles.markerWrapperSelected]}>
          <Image
            source={selected ? STATION_ICON_SELECTED : STATION_ICON}
            style={styles.icon}
          />
        </View>
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

function StationMarkersComponent({ stations, selectedStationId, onSelectStation }: StationMarkersProps) {
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
  markerWrapper: {
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
    elevation: 8,
  },
  markerWrapperSelected: {
    shadowOpacity: 0.6,
    shadowRadius: 18,
  },
  icon: {
    width: 30,
    height: 30,
    resizeMode: 'contain',
  },
});

import type { Coordinates } from './geo';
import type { TrafficEvent } from '../types/traffic';
import { haversineDistance } from './geo';

export const computeEventDistance = (event: TrafficEvent, coords: Coordinates): number | null => {
  let best: number | null = null;
  event.stations.forEach(station => {
    if (typeof station.latitude !== 'number' || typeof station.longitude !== 'number') {
      return;
    }
    const result = haversineDistance(
      { latitude: station.latitude, longitude: station.longitude },
      coords,
    );
    if (best === null || result < best) {
      best = result;
    }
  });
  return best;
};

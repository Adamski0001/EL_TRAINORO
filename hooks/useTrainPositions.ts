import { useEffect, useMemo, useState } from 'react';

import { MOCK_TRAIN_POSITIONS } from '../data/mockTrains';
import type { TrainPosition } from '../types/trains';

const MS_IN_HOUR = 3_600_000;
const METERS_PER_DEGREE_LAT = 111_320; // approx

const advancePosition = (train: TrainPosition, deltaMs: number): TrainPosition => {
  const distanceKm = (train.speedKmh * deltaMs) / MS_IN_HOUR;
  const distanceMeters = distanceKm * 1000;
  const bearingRad = ((train.bearing % 360) * Math.PI) / 180;
  const deltaLat = ((distanceMeters * Math.cos(bearingRad)) / METERS_PER_DEGREE_LAT);
  const metersPerDegLng = METERS_PER_DEGREE_LAT * Math.cos((train.latitude * Math.PI) / 180);
  const deltaLng = metersPerDegLng === 0 ? 0 : (distanceMeters * Math.sin(bearingRad)) / metersPerDegLng;

  return {
    ...train,
    latitude: train.latitude + deltaLat,
    longitude: train.longitude + deltaLng,
  };
};

export function useTrainPositions() {
  const [trains, setTrains] = useState<TrainPosition[]>(MOCK_TRAIN_POSITIONS);

  useEffect(() => {
    let lastUpdate = Date.now();
    const interval = setInterval(() => {
      const now = Date.now();
      const delta = now - lastUpdate;
      lastUpdate = now;
      setTrains(current => current.map(train => advancePosition(train, delta)));
    }, 45_000);

    return () => {
      clearInterval(interval);
    };
  }, []);

  return useMemo(
    () => ({
      data: trains,
      loading: false,
      error: null as string | null,
    }),
    [trains],
  );
}

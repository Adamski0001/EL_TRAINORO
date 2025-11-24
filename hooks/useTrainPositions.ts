import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { fetchTrainPositions } from '../lib/trafikverket';
import type { TrainPosition } from '../types/trains';

const REFRESH_INTERVAL_MS = 45_000;

const normalizeTrain = (entry: Awaited<ReturnType<typeof fetchTrainPositions>>[number]): TrainPosition | null => {
  const fallbackId = entry.operationalTrainNumber ?? entry.advertisedTrainIdent;
  if (!fallbackId) {
    return null;
  }

  const latitude = entry.latitude ?? null;
  const longitude = entry.longitude ?? null;

  if (latitude === null || longitude === null) {
    return null;
  }

  const speed = entry.speed ?? null;
  const bearing = entry.bearing ?? null;
  const updatedAt = entry.modifiedTime ?? entry.timeStamp ?? new Date().toISOString();
  const advertisedTrainIdent = entry.advertisedTrainIdent ?? null;
  const operationalTrainNumber = entry.operationalTrainNumber ?? null;
  const trainOwner = entry.trainOwner ?? null;

  return {
    id: fallbackId,
    label: advertisedTrainIdent ?? operationalTrainNumber ?? `Tåg ${fallbackId}`,
    advertisedTrainIdent,
    operationalTrainNumber,
    trainOwner,
    coordinate: { latitude, longitude },
    speed,
    bearing,
    updatedAt,
  };
};

export function useTrainPositions() {
  const [trains, setTrains] = useState<TrainPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortController = useRef<AbortController | null>(null);
  const firstLoadRef = useRef(true);

  const fetchPositions = useCallback(async () => {
    abortController.current?.abort();
    const controller = new AbortController();
    abortController.current = controller;

    try {
      console.log('[TrainPositions] Fetching positions...');
      setError(null);
      if (firstLoadRef.current) {
        setLoading(true);
      }

      const data = await fetchTrainPositions({ signal: controller.signal });

      const mapped = data
        .map(normalizeTrain)
        .filter((item): item is TrainPosition => Boolean(item));

      if (data.length > 0 && mapped.length === 0) {
        console.warn('[TrainPositions] Received entries but none were mappable', {
          sample: data[0],
        });
      }

      const trainsWithCoordinates = mapped.length;
      const latestTimestamp = mapped.reduce<string | null>((latest, train) => {
        if (!train.updatedAt) {
          return latest;
        }
        if (!latest || new Date(train.updatedAt) > new Date(latest)) {
          return train.updatedAt;
        }
        return latest;
      }, null);

      console.log(
        `[TrainPositions] Loaded ${data.length} records, ${trainsWithCoordinates} with coordinates`,
        latestTimestamp ? `(latest update ${latestTimestamp})` : '',
      );

      if (__DEV__) {
        console.log('[TrainPositions][Diag] trains[] payload', mapped);
      }

      setTrains(mapped);
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        return;
      }
      console.error('[TrainPositions] Failed to load positions', err);
      setError(err instanceof Error ? err.message : 'Kunde inte läsa in tågens positioner.');
    } finally {
      if (firstLoadRef.current) {
        firstLoadRef.current = false;
      }
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPositions();
  }, [fetchPositions]);

  useEffect(() => {
    refreshTimer.current = setInterval(fetchPositions, REFRESH_INTERVAL_MS);
    return () => {
      if (refreshTimer.current) {
        clearInterval(refreshTimer.current);
      }
      abortController.current?.abort();
    };
  }, [fetchPositions]);

  const lastUpdated = useMemo(() => {
    if (!trains.length) {
      return null;
    }
    return trains.reduce<Date | null>((latest, train) => {
      const ts = new Date(train.updatedAt);
      if (!latest || ts > latest) {
        return ts;
      }
      return latest;
    }, null);
  }, [trains]);

  return {
    trains,
    loading,
    error,
    lastUpdated,
    refetch: fetchPositions,
  };
}

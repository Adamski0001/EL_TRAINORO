import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fetchStationLookup,
  fetchTrainAnnouncements,
  type StationLookup,
  type TrainAnnouncementApiEntry,
} from '../lib/trafikverket';
import type { TrainDetails, TrainPosition, TrainStop } from '../types/trains';

type UseTrainDetailsResult = {
  data: TrainDetails | undefined;
  loading: boolean;
  error: string | null;
  refetch: () => void;
};

const parseDate = (value: string | null): Date | null => {
  if (!value) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms);
};

const resolveStationName = (signature: string | null, fallback: string | null, lookup: StationLookup) => {
  if (fallback?.trim()) {
    return fallback.trim();
  }
  if (signature?.trim()) {
    return lookup[signature.trim()] ?? signature.trim();
  }
  return 'Okänd plats';
};

const activityType = (entry: TrainAnnouncementApiEntry) => (entry.activityType ?? '').toLowerCase();

const isArrivalActivity = (entry: TrainAnnouncementApiEntry) => {
  const type = activityType(entry);
  return type.includes('ank') || type.includes('arr');
};

const isDepartureActivity = (entry: TrainAnnouncementApiEntry) => {
  const type = activityType(entry);
  return type.includes('avg') || type.includes('dep');
};

type InternalStop = TrainStop & { order: number };

const buildStops = (announcements: TrainAnnouncementApiEntry[], lookup: StationLookup): TrainStop[] => {
  const stopMap = new Map<string, InternalStop>();

  announcements.forEach((entry, index) => {
    const key = entry.locationSignature ?? `${entry.advertisedLocationName ?? 'unknown'}-${index}`;
    const stationName = resolveStationName(entry.locationSignature, entry.advertisedLocationName, lookup);
    const advertised = parseDate(entry.advertisedTimeAtLocation);
    const estimated = parseDate(entry.estimatedTimeAtLocation);
    const actual = parseDate(entry.timeAtLocation);
    const arrivalActivity = isArrivalActivity(entry);
    const departureActivity = isDepartureActivity(entry);

    const existing = stopMap.get(key);
    const stop: InternalStop = existing ?? {
      id: `${key}-${index}`,
      stationName,
      track: entry.trackAtLocation ?? null,
      arrivalAdvertised: null,
      arrivalEstimated: null,
      arrivalActual: null,
      departureAdvertised: null,
      departureEstimated: null,
      departureActual: null,
      canceled: entry.canceled,
      order: index,
    };

    stop.track = stop.track ?? entry.trackAtLocation ?? null;
    stop.canceled = stop.canceled || entry.canceled;

    if (arrivalActivity || !existing) {
      stop.arrivalAdvertised = advertised ?? stop.arrivalAdvertised;
      stop.arrivalEstimated = estimated ?? stop.arrivalEstimated;
      stop.arrivalActual = actual ?? stop.arrivalActual;
    }

    if (departureActivity || !existing) {
      stop.departureAdvertised = advertised ?? stop.departureAdvertised;
      stop.departureEstimated = estimated ?? stop.departureEstimated;
      stop.departureActual = actual ?? stop.departureActual;
    }

    stopMap.set(key, stop);
  });

  return Array.from(stopMap.values())
    .sort((a, b) => a.order - b.order)
    .map(({ order, ...rest }) => rest);
};

const resolveEndpointName = (
  records: TrainAnnouncementApiEntry[],
  selector: (entry: TrainAnnouncementApiEntry) => { name: string }[],
  lookup: StationLookup,
  options: { takeLast?: boolean } = {},
) => {
  const { takeLast = true } = options;
  for (const entry of records) {
    const refs = selector(entry);
    if (!refs.length) {
      continue;
    }
    const ref = takeLast ? refs[refs.length - 1] : refs[0];
    const signature = ref.name?.trim();
    if (signature) {
      return lookup[signature] ?? signature;
    }
  }
  return null;
};

export function useTrainDetails(train: TrainPosition | null): UseTrainDetailsResult {
  const [data, setData] = useState<TrainDetails | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!train) {
      setData(undefined);
      setError(null);
      setLoading(false);
      return;
    }

    if (!train.advertisedTrainIdent && !train.operationalTrainNumber) {
      setData(undefined);
      setError('Tåget saknar identifierare.');
      setLoading(false);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);

    try {
      const [lookup, announcements] = await Promise.all([
        fetchStationLookup(),
        fetchTrainAnnouncements({
          advertisedTrainIdent: train.advertisedTrainIdent,
          operationalTrainNumber: train.operationalTrainNumber,
          windowMinutes: 1_440,
          signal: controller.signal,
        }),
      ]);

      const stops = buildStops(announcements, lookup);
      const operatorCandidate = announcements.find(item => item.operator || item.informationOwner);
      const operator =
        operatorCandidate?.operator ??
        operatorCandidate?.informationOwner ??
        announcements[0]?.trainOwner ??
        train.trainOwner ??
        null;
      const productName = announcements.find(item => item.productInformation)?.productInformation ?? null;
      const fromName = resolveEndpointName(announcements, entry => entry.fromLocations, lookup, {
        takeLast: false,
      });
      const toName = resolveEndpointName(announcements, entry => entry.toLocations, lookup, {
        takeLast: true,
      });

      setData({
        id: train.id,
        advertisedTrainIdent: train.advertisedTrainIdent,
        operationalTrainNumber: train.operationalTrainNumber,
        operator,
        productName,
        fromName,
        toName,
        stops,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        return;
      }
      setError(err instanceof Error ? err.message : 'Kunde inte hämta tåginformation.');
    } finally {
      setLoading(false);
    }
  }, [train]);

  useEffect(() => {
    load();
    return () => {
      abortRef.current?.abort();
    };
  }, [load]);

  const refetch = useCallback(() => {
    load();
  }, [load]);

  return { data, loading, error, refetch };
}

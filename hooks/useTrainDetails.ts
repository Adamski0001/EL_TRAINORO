import { useCallback, useEffect, useRef, useState } from 'react';
import { InteractionManager } from 'react-native';

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
    return lookup[signature.trim()]?.name ?? signature.trim();
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

type InternalStop = TrainStop & {
  order: number;
  hasArrival: boolean;
  hasDeparture: boolean;
};

const buildStops = (announcements: TrainAnnouncementApiEntry[], lookup: StationLookup): TrainStop[] => {
  const locationBuckets = new Map<string, InternalStop[]>();
  const stopsInOrder: InternalStop[] = [];
  let orderCounter = 0;

  const resolveKey = (entry: TrainAnnouncementApiEntry, index: number) => {
    const signature = entry.locationSignature?.trim();
    if (signature) {
      return signature;
    }
    const advertisedName = entry.advertisedLocationName?.trim();
    if (advertisedName) {
      return advertisedName;
    }
    return `unknown-${index}`;
  };

  const selectArrivalTimestamp = (stop: InternalStop) => {
    const candidate =
      stop.arrivalActual ??
      stop.arrivalEstimated ??
      stop.arrivalAdvertised ??
      stop.departureActual ??
      stop.departureEstimated ??
      stop.departureAdvertised;
    return candidate ? candidate.getTime() : Number.MAX_SAFE_INTEGER;
  };

  announcements.forEach((entry, index) => {
    const key = resolveKey(entry, index);
    const advertised = parseDate(entry.advertisedTimeAtLocation);
    const estimated = parseDate(entry.estimatedTimeAtLocation);
    const actual = parseDate(entry.timeAtLocation);
    const arrivalActivity = isArrivalActivity(entry);
    const departureActivity = isDepartureActivity(entry);
    const bucket = locationBuckets.get(key) ?? [];
    let stop = bucket[bucket.length - 1];

    const shouldReuse =
      stop &&
      ((arrivalActivity && !stop.hasArrival) ||
        (departureActivity && !stop.hasDeparture) ||
        (!arrivalActivity && !departureActivity));

    if (!shouldReuse || !stop) {
      const stationName = resolveStationName(entry.locationSignature, entry.advertisedLocationName, lookup);
      stop = {
        id: `${key}-${bucket.length}`,
        stationName,
        track: entry.trackAtLocation ?? null,
        arrivalAdvertised: null,
        arrivalEstimated: null,
        arrivalActual: null,
        departureAdvertised: null,
        departureEstimated: null,
        departureActual: null,
        canceled: entry.canceled,
        order: orderCounter++,
        hasArrival: false,
        hasDeparture: false,
      };
      bucket.push(stop);
      stopsInOrder.push(stop);
      locationBuckets.set(key, bucket);
    }

    stop.track = stop.track ?? entry.trackAtLocation ?? null;
    stop.canceled = stop.canceled || entry.canceled;

    const shouldApplyArrival = arrivalActivity || (!stop.hasArrival && !departureActivity);
    const shouldApplyDeparture = departureActivity || (!stop.hasDeparture && !arrivalActivity);

    if (shouldApplyArrival) {
      stop.arrivalAdvertised = advertised ?? stop.arrivalAdvertised;
      stop.arrivalEstimated = estimated ?? stop.arrivalEstimated;
      stop.arrivalActual = actual ?? stop.arrivalActual;
      stop.hasArrival = stop.hasArrival || arrivalActivity;
    }

    if (shouldApplyDeparture) {
      stop.departureAdvertised = advertised ?? stop.departureAdvertised;
      stop.departureEstimated = estimated ?? stop.departureEstimated;
      stop.departureActual = actual ?? stop.departureActual;
      stop.hasDeparture = stop.hasDeparture || departureActivity;
    }
  });

  return stopsInOrder
    .sort((a, b) => {
      const aKey = selectArrivalTimestamp(a);
      const bKey = selectArrivalTimestamp(b);
      if (aKey !== bKey) {
        return aKey - bKey;
      }
      return a.order - b.order;
    })
    .map(({ order, hasArrival, hasDeparture, ...rest }) => rest);
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
      return lookup[signature]?.name ?? signature;
    }
  }
  return null;
};

export function useTrainDetails(train: TrainPosition | null): UseTrainDetailsResult {
  const [data, setData] = useState<TrainDetails | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const loadTaskRef = useRef<ReturnType<typeof InteractionManager.runAfterInteractions> | null>(null);

  const performLoad = useCallback(async () => {
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
    setError(null);

    try {
      const targetDate =
        train.operationalTrainDepartureDate ?? train.journeyPlanDepartureDate ?? train.updatedAt ?? null;
      const windowMinutes = targetDate ? undefined : 1_440;

      const [lookup, announcements] = await Promise.all([
        fetchStationLookup(),
        fetchTrainAnnouncements({
          advertisedTrainIdent: train.advertisedTrainIdent,
          operationalTrainNumber: train.operationalTrainNumber,
          windowMinutes,
          signal: controller.signal,
          targetDate,
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

  const load = useCallback(
    (options: { immediate?: boolean } = {}) => {
      const { immediate = false } = options;
      loadTaskRef.current?.cancel?.();
      setLoading(true);
      if (immediate) {
        void performLoad();
        return;
      }
      loadTaskRef.current = InteractionManager.runAfterInteractions(() => {
        loadTaskRef.current = null;
        void performLoad();
      });
    },
    [performLoad],
  );

  useEffect(() => {
    load();
    return () => {
      loadTaskRef.current?.cancel?.();
      abortRef.current?.abort();
    };
  }, [load]);

  const refetch = useCallback(() => {
    load({ immediate: true });
  }, [load]);

  return { data, loading, error, refetch };
}

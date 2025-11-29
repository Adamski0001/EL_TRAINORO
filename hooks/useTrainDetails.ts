import { useCallback, useEffect, useRef, useState } from 'react';
import { InteractionManager } from 'react-native';

import {
  fetchStationLookup,
  fetchTrainAnnouncements,
  type StationLookup,
  type TrainAnnouncementApiEntry,
} from '../lib/trafikverket';
import { buildStopsFromAnnouncements } from '../lib/trainStopBuilder';
import type { TrainDetails, TrainPosition } from '../types/trains';

type UseTrainDetailsResult = {
  data: TrainDetails | undefined;
  loading: boolean;
  error: string | null;
  refetch: () => void;
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

      const stops = buildStopsFromAnnouncements(announcements, lookup);
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

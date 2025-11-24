import { useCallback, useEffect, useRef, useState } from 'react';

import { MOCK_TRAIN_DETAILS } from '../data/mockTrains';
import type { TrainDetails, TrainPosition } from '../types/trains';

type UseTrainDetailsResult = {
  data: TrainDetails | undefined;
  loading: boolean;
  error: string | null;
  refetch: () => void;
};

const FETCH_DELAY_MS = 450;

export function useTrainDetails(train: TrainPosition | null): UseTrainDetailsResult {
  const [data, setData] = useState<TrainDetails | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => {
    if (!train) {
      setData(undefined);
      setError(null);
      setLoading(false);
      return;
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    setLoading(true);
    setError(null);
    timeoutRef.current = setTimeout(() => {
      const details = MOCK_TRAIN_DETAILS[train.id];
      if (!details) {
        setData(undefined);
        setError('Vi hittar inte detaljer för detta tåg just nu.');
      } else {
        // Clone the structure so callers can safely mutate if needed.
        setData({
          ...details,
          stops: details.stops.map(stop => ({ ...stop })),
        });
        setError(null);
      }
      setLoading(false);
    }, FETCH_DELAY_MS);
  }, [train]);

  useEffect(() => {
    load();
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [load]);

  const refetch = useCallback(() => {
    load();
  }, [load]);

  return { data, loading, error, refetch };
}

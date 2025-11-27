import { useCallback, useSyncExternalStore } from 'react';

import { stationsStore } from '../state/stationsStore';

export function useStations() {
  const snapshot = useSyncExternalStore(
    stationsStore.subscribe,
    stationsStore.getSnapshot,
    stationsStore.getSnapshot,
  );

  const refresh = useCallback((options: { forceRefresh?: boolean } = {}) => {
    void stationsStore.refetch({ forceRefresh: options.forceRefresh ?? true });
  }, []);

  return {
    stations: snapshot.stations,
    loading: snapshot.loading,
    error: snapshot.error,
    lastUpdated: snapshot.lastUpdated,
    refresh,
  };
}

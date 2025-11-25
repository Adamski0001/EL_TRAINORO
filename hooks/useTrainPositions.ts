import { useCallback, useSyncExternalStore } from 'react';

import { trainPositionsStore } from '../state/trainPositionsStore';

export function useTrainPositions() {
  const snapshot = useSyncExternalStore(
    trainPositionsStore.subscribe,
    trainPositionsStore.getSnapshot,
    trainPositionsStore.getSnapshot,
  );

  const refetch = useCallback(() => {
    void trainPositionsStore.refetch({ forceFull: true });
  }, []);

  return {
    trains: snapshot.trains,
    loading: snapshot.loading,
    error: snapshot.error,
    lastUpdated: snapshot.lastUpdated,
    refetch,
  };
}

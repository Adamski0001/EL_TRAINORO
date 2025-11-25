import { useCallback, useSyncExternalStore } from 'react';

import { trafficEventsStore } from '../state/trafficEventsStore';

export function useTrafficEvents() {
  const snapshot = useSyncExternalStore(
    trafficEventsStore.subscribe,
    trafficEventsStore.getSnapshot,
    trafficEventsStore.getSnapshot,
  );

  const refetch = useCallback(() => {
    void trafficEventsStore.refetch();
  }, []);

  return {
    events: snapshot.events,
    loading: snapshot.loading,
    error: snapshot.error,
    lastUpdated: snapshot.lastUpdated,
    refetch,
  };
}

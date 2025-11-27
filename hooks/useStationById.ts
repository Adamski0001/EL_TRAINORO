import { useSyncExternalStore } from 'react';

import { stationsStore } from '../state/stationsStore';
import type { Station } from '../types/stations';

export function useStationById(stationId: string | null): Station | null {
  return useSyncExternalStore(
    stationsStore.subscribe,
    () => stationsStore.getStationById(stationId),
    () => stationsStore.getStationById(stationId),
  );
}

import { useSyncExternalStore } from 'react';

import { trainPositionsStore } from '../state/trainPositionsStore';
import type { TrainPosition } from '../types/trains';

export function useTrainPositionById(trainId: string | null): TrainPosition | null {
  return useSyncExternalStore(
    trainPositionsStore.subscribe,
    () => trainPositionsStore.getTrainById(trainId),
    () => trainPositionsStore.getTrainById(trainId),
  );
}

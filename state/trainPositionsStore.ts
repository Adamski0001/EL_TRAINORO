import { fetchTrainPositions } from '../lib/trafikverket';
import type { TrainPosition } from '../types/trains';

type RawTrainPosition = Awaited<ReturnType<typeof fetchTrainPositions>>[number];

type TrainPositionsStoreState = {
  trains: TrainPosition[];
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
};

const REFRESH_INTERVAL_MS = 45_000;
const FULL_REFRESH_INTERVAL_MS = REFRESH_INTERVAL_MS * 5;
const STALE_TRAIN_MAX_AGE_MS = 10 * 60 * 1000;
const MODIFIED_TIME_BACKTRACK_MS = 5_000;

const DEFAULT_STATE: TrainPositionsStoreState = {
  trains: [],
  loading: true,
  error: null,
  lastUpdated: null,
};

let state: TrainPositionsStoreState = DEFAULT_STATE;

const listeners = new Set<() => void>();
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let abortController: AbortController | null = null;
let firstLoad = true;
let lastFullRefreshAt = 0;
let latestServerTimestamp: string | null = null;

const trainCache = new Map<string, TrainPosition>();
let trainOrder: string[] = [];
const trainOrderSet = new Set<string>();

const emit = () => {
  listeners.forEach(listener => listener());
};

const datesEqual = (a: Date | null, b: Date | null) => {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return a.getTime() === b.getTime();
};

const assignState = (patch: Partial<TrainPositionsStoreState>) => {
  const nextState: TrainPositionsStoreState = { ...state };
  let changed = false;

  if (Object.prototype.hasOwnProperty.call(patch, 'trains')) {
    const nextTrains = patch.trains ?? [];
    if (nextTrains !== state.trains) {
      nextState.trains = nextTrains;
      changed = true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'loading') && typeof patch.loading === 'boolean') {
    if (patch.loading !== state.loading) {
      nextState.loading = patch.loading;
      changed = true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'error')) {
    const nextError = patch.error ?? null;
    if (nextError !== state.error) {
      nextState.error = nextError;
      changed = true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'lastUpdated')) {
    const nextDate = patch.lastUpdated ?? null;
    if (!datesEqual(nextDate, state.lastUpdated)) {
      nextState.lastUpdated = nextDate;
      changed = true;
    }
  }

  if (changed) {
    state = nextState;
    emit();
  }
};

const normalizeTrain = (entry: RawTrainPosition): TrainPosition | null => {
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
  const operationalTrainDepartureDate = entry.operationalTrainDepartureDate ?? null;
  const journeyPlanNumber = entry.journeyPlanNumber ?? null;
  const journeyPlanDepartureDate = entry.journeyPlanDepartureDate ?? null;

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
    operationalTrainDepartureDate,
    journeyPlanNumber,
    journeyPlanDepartureDate,
  };
};

const trainsShallowEqual = (a: TrainPosition, b: TrainPosition) => {
  if (a === b) {
    return true;
  }
  return (
    a.id === b.id &&
    a.label === b.label &&
    a.advertisedTrainIdent === b.advertisedTrainIdent &&
    a.operationalTrainNumber === b.operationalTrainNumber &&
    a.operationalTrainDepartureDate === b.operationalTrainDepartureDate &&
    a.journeyPlanNumber === b.journeyPlanNumber &&
    a.journeyPlanDepartureDate === b.journeyPlanDepartureDate &&
    a.trainOwner === b.trainOwner &&
    a.coordinate.latitude === b.coordinate.latitude &&
    a.coordinate.longitude === b.coordinate.longitude &&
    a.speed === b.speed &&
    a.bearing === b.bearing &&
    a.updatedAt === b.updatedAt
  );
};

const computeLatestTimestamp = (trains: TrainPosition[]): Date | null => {
  if (!trains.length) {
    return null;
  }
  let latest: number | null = null;
  trains.forEach(train => {
    const ms = Date.parse(train.updatedAt);
    if (Number.isNaN(ms)) {
      return;
    }
    if (latest === null || ms > latest) {
      latest = ms;
    }
  });
  return latest === null ? null : new Date(latest);
};

const pruneStaleTrains = (now: number) => {
  if (!trainOrder.length) {
    return;
  }
  const cutoff = now - STALE_TRAIN_MAX_AGE_MS;
  let changed = false;
  const nextOrder: string[] = [];
  for (const id of trainOrder) {
    const train = trainCache.get(id);
    if (!train) {
      trainOrderSet.delete(id);
      changed = true;
      continue;
    }
    const updatedAtMs = Date.parse(train.updatedAt);
    if (!Number.isNaN(updatedAtMs) && updatedAtMs < cutoff) {
      trainCache.delete(id);
      trainOrderSet.delete(id);
      changed = true;
      continue;
    }
    nextOrder.push(id);
  }
  if (changed) {
    trainOrder = nextOrder;
    trainOrderSet.clear();
    nextOrder.forEach(id => trainOrderSet.add(id));
  }
};

const buildOrderedSnapshot = (): TrainPosition[] => {
  if (!trainOrder.length && trainCache.size) {
    trainOrder = Array.from(trainCache.keys());
    trainOrderSet.clear();
    trainOrder.forEach(id => trainOrderSet.add(id));
  }

  if (!trainOrder.length) {
    return [];
  }

  const ordered: TrainPosition[] = [];
  const nextOrder: string[] = [];

  for (const id of trainOrder) {
    const train = trainCache.get(id);
    if (!train) {
      trainOrderSet.delete(id);
      continue;
    }
    ordered.push(train);
    nextOrder.push(id);
  }

  if (nextOrder.length !== trainOrder.length) {
    trainOrder = nextOrder;
    trainOrderSet.clear();
    nextOrder.forEach(id => trainOrderSet.add(id));
  }

  return ordered;
};

const processFetchResult = (
  entries: Awaited<ReturnType<typeof fetchTrainPositions>>,
  options: { fullRefresh: boolean; now: number },
) => {
  const normalized = entries
    .map(normalizeTrain)
    .filter((item): item is TrainPosition => Boolean(item));

  if (options.fullRefresh) {
    trainCache.clear();
    normalized.forEach(train => {
      trainCache.set(train.id, train);
    });
    trainOrder = normalized.map(train => train.id);
    trainOrderSet.clear();
    trainOrder.forEach(id => trainOrderSet.add(id));
  } else {
    normalized.forEach(train => {
      const cached = trainCache.get(train.id);
      if (cached && trainsShallowEqual(cached, train)) {
        return;
      }
      trainCache.set(train.id, train);
      if (!trainOrderSet.has(train.id)) {
        trainOrderSet.add(train.id);
        trainOrder.push(train.id);
      }
    });
  }

  pruneStaleTrains(options.now);

  const ordered = buildOrderedSnapshot();

  const trainsChanged =
    ordered.length !== state.trains.length || ordered.some((train, index) => train !== state.trains[index]);
  const nextLastUpdated = computeLatestTimestamp(ordered);

  const patch: Partial<TrainPositionsStoreState> = {};
  if (trainsChanged) {
    patch.trains = ordered;
  }
  if (!datesEqual(nextLastUpdated, state.lastUpdated)) {
    patch.lastUpdated = nextLastUpdated;
  }

  if (nextLastUpdated) {
    latestServerTimestamp = nextLastUpdated.toISOString();
  }

  if (Object.keys(patch).length) {
    assignState(patch);
  }
};

const createModifiedSinceTimestamp = () => {
  if (!latestServerTimestamp) {
    return null;
  }
  const ms = Date.parse(latestServerTimestamp);
  if (Number.isNaN(ms)) {
    return null;
  }
  return new Date(ms - MODIFIED_TIME_BACKTRACK_MS).toISOString();
};

const stopPolling = () => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  abortController?.abort();
  abortController = null;
};

const startPolling = () => {
  if (refreshTimer) {
    return;
  }
  void loadPositions();
  refreshTimer = setInterval(() => {
    void loadPositions();
  }, REFRESH_INTERVAL_MS);
};

async function loadPositions(options: { forceFull?: boolean } = {}) {
  const { forceFull = false } = options;
  abortController?.abort();
  const controller = new AbortController();
  abortController = controller;

  const now = Date.now();
  const shouldDoFullRefresh =
    forceFull ||
    firstLoad ||
    !latestServerTimestamp ||
    now - lastFullRefreshAt > FULL_REFRESH_INTERVAL_MS;

  const showLoading = firstLoad || forceFull;
  if (showLoading) {
    assignState({ loading: true });
  }

  try {
    if (firstLoad) {
      assignState({ error: null });
    }

    const records = await fetchTrainPositions({
      signal: controller.signal,
      modifiedSince: shouldDoFullRefresh ? null : createModifiedSinceTimestamp(),
    });

    processFetchResult(records, { fullRefresh: shouldDoFullRefresh, now });

    if (shouldDoFullRefresh) {
      lastFullRefreshAt = now;
    }
    firstLoad = false;
    assignState({ error: null });
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      return;
    }
    console.error('[TrainPositionsStore] Failed to load positions', error);
    assignState({ error: error instanceof Error ? error.message : 'Kunde inte läsa in tågens positioner.' });
  } finally {
    if (showLoading) {
      assignState({ loading: false });
    }
    firstLoad = false;
  }
}

export const trainPositionsStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    if (listeners.size === 1) {
      startPolling();
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        stopPolling();
      }
    };
  },
  getSnapshot() {
    return state;
  },
  getTrainById(id: string | null) {
    if (!id) {
      return null;
    }
    return trainCache.get(id) ?? null;
  },
  refetch(options: { forceFull?: boolean } = {}) {
    return loadPositions({ forceFull: options.forceFull ?? true });
  },
};

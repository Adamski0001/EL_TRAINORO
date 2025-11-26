import {
  fetchTrainAnnouncementsByIdentifiers,
  type TrainAnnouncementApiEntry,
} from '../lib/trafikverket';
import type { TrainPosition } from '../types/trains';

export type RouteInfo = {
  from: string | null;
  to: string | null;
  resolved: boolean;
};

type TrainIdentifierFilter = {
  advertisedTrainIdent?: string;
  operationalTrainNumber?: string;
};

type RouteSnapshot = {
  version: number;
  routes: Map<string, RouteInfo>;
};

const ROUTE_FETCH_LIMIT = 80;
const ROUTE_WINDOW_MINUTES = 2_880;

const routeMap = new Map<string, RouteInfo>();
const pending = new Map<string, TrainIdentifierFilter>();
const trainMatchIndex = new Map<string, string>();
const listeners = new Set<() => void>();

let version = 0;
const snapshot: RouteSnapshot = {
  version: 0,
  routes: routeMap,
};
let abortController: AbortController | null = null;
let fetchInFlight = false;

const emit = () => {
  version += 1;
  snapshot.version = version;
  listeners.forEach(listener => listener());
};

const normalizeIdentifier = (value: string | null | undefined) => {
  const trimmed = (value ?? '').trim();
  return trimmed.length ? trimmed : null;
};

const pickLocationSignature = (locations: { name: string }[] | undefined | null, takeFirst: boolean) => {
  if (!locations?.length) {
    return null;
  }
  if (takeFirst) {
    return locations[0]?.name ?? null;
  }
  return locations[locations.length - 1]?.name ?? null;
};

const upsertRoutes = (entries: [string, RouteInfo][]) => {
  if (!entries.length) {
    return;
  }
  entries.forEach(([id, info]) => {
    routeMap.set(id, info);
  });
  emit();
};

const resolveBatch = async (batch: [string, TrainIdentifierFilter][]) => {
  if (!batch.length) {
    return;
  }
  const filters = batch.map(([, filter]) => filter);
  const trainIds = new Set(batch.map(([id]) => id));
  const keyIndex = new Map<string, string>();
  batch.forEach(([id, filter]) => {
    if (filter.advertisedTrainIdent) {
      keyIndex.set(`adv:${filter.advertisedTrainIdent}`, id);
    }
    if (filter.operationalTrainNumber) {
      keyIndex.set(`op:${filter.operationalTrainNumber}`, id);
    }
  });

  abortController?.abort();
  abortController = new AbortController();

  try {
    const records = await fetchTrainAnnouncementsByIdentifiers(filters, {
      perBatchLimit: 400,
      windowMinutes: ROUTE_WINDOW_MINUTES,
      signal: abortController.signal,
    });
    const updates: [string, RouteInfo][] = [];
    const matched = new Set<string>();

    records.forEach((record: TrainAnnouncementApiEntry) => {
      const advKey = normalizeIdentifier(record.advertisedTrainIdent);
      const opKey = normalizeIdentifier(record.operationalTrainNumber);
      const advLookupKey = advKey ? `adv:${advKey}` : null;
      const opLookupKey = opKey ? `op:${opKey}` : null;
      const id =
        (advLookupKey && keyIndex.get(advLookupKey)) ||
        (opLookupKey && keyIndex.get(opLookupKey)) ||
        (advLookupKey && trainMatchIndex.get(advLookupKey)) ||
        (opLookupKey && trainMatchIndex.get(opLookupKey));
      if (!id) {
        return;
      }
      const fromSignature = pickLocationSignature(record.fromLocations, true);
      const toSignature = pickLocationSignature(record.toLocations, false);
      updates.push([
        id,
        {
          from: fromSignature,
          to: toSignature,
          resolved: true,
        },
      ]);
      matched.add(id);
      trainIds.delete(id);
    });

    trainIds.forEach(id => {
      updates.push([
        id,
        {
          from: null,
          to: null,
          resolved: true,
        },
      ]);
    });

    upsertRoutes(updates);
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      return;
    }
    console.warn('[TrainRouteRegistry] Route fetch failed', error);
    const fallback: [string, RouteInfo][] = batch.map(([id]) => [
      id,
      {
        from: null,
        to: null,
        resolved: true,
      },
    ]);
    upsertRoutes(fallback);
  } finally {
    fetchInFlight = false;
  }
};

const processQueue = () => {
  if (fetchInFlight || pending.size === 0) {
    return;
  }
  const batch: [string, TrainIdentifierFilter][] = [];
  for (const entry of pending.entries()) {
    batch.push(entry);
    pending.delete(entry[0]);
    if (batch.length >= ROUTE_FETCH_LIMIT) {
      break;
    }
  }
  if (!batch.length) {
    return;
  }
  fetchInFlight = true;
  void resolveBatch(batch).finally(() => {
    processQueue();
  });
};

const queueTrains = (trains: TrainPosition[]) => {
  let updated = false;
  trains.forEach(train => {
    const adv = normalizeIdentifier(train.advertisedTrainIdent);
    const op = normalizeIdentifier(train.operationalTrainNumber);
    if (adv) {
      trainMatchIndex.set(`adv:${adv}`, train.id);
    }
    if (op) {
      trainMatchIndex.set(`op:${op}`, train.id);
    }
    if (routeMap.has(train.id) || pending.has(train.id)) {
      return;
    }
    if (!adv && !op) {
      routeMap.set(train.id, {
        from: null,
        to: null,
        resolved: true,
      });
      updated = true;
      return;
    }
    pending.set(train.id, {
      advertisedTrainIdent: adv ?? undefined,
      operationalTrainNumber: op ?? undefined,
    });
  });
  if (updated) {
    emit();
  }
  processQueue();
};

export const trainRouteRegistry = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot(): RouteSnapshot {
    return snapshot;
  },
  ensureRoutesFor(trains: TrainPosition[]) {
    queueTrains(trains);
  },
  getRoute(trainId: string): RouteInfo | null {
    return routeMap.get(trainId) ?? null;
  },
};

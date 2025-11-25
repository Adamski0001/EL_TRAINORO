import { useEffect, useMemo, useRef, useState } from 'react';

import {
  fetchStationLookup,
  fetchTrainAnnouncementsByIdentifiers,
  type StationLookup,
  type TrainAnnouncementApiEntry,
} from '../lib/trafikverket';
import type { TrainPosition } from '../types/trains';
import { useTrainPositions } from './useTrainPositions';

const ROUTE_FETCH_LIMIT = 80;

type RouteInfo = {
  from: string | null;
  to: string | null;
  resolved: boolean;
};

type TrainIdentifierFilter = {
  advertisedTrainIdent?: string | null;
  operationalTrainNumber?: string | null;
};

const resolveLocationName = (code: string | null, lookup: StationLookup | null) => {
  if (!code) {
    return null;
  }
  const normalized = code.trim();
  if (!normalized) {
    return null;
  }
  if (!lookup) {
    return normalized;
  }
  return lookup[normalized]?.name ?? normalized;
};

const buildRouteLabel = (route: RouteInfo | undefined, lookup: StationLookup | null) => {
  if (!route) {
    return null;
  }
  const fromName = resolveLocationName(route.from, lookup);
  const toName = resolveLocationName(route.to, lookup);
  if (fromName && toName) {
    return `${fromName} → ${toName}`;
  }
  if (toName) {
    return `Till ${toName}`;
  }
  if (fromName) {
    return `Från ${fromName}`;
  }
  return null;
};

const pickLocationSignature = (locations: { name: string }[] | undefined | null, takeFirst = true) => {
  if (!locations?.length) {
    return null;
  }
  if (takeFirst) {
    return locations[0]?.name ?? null;
  }
  return locations[locations.length - 1]?.name ?? null;
};

export type TrainSearchItem = {
  id: string;
  title: string;
  subtitle: string | null;
  routeText: string | null;
  train: TrainPosition;
  searchText: string;
};

export function useTrainSearchIndex() {
  const { trains } = useTrainPositions();
  const routeMapRef = useRef<Map<string, RouteInfo>>(new Map());
  const [routeVersion, setRouteVersion] = useState(0);
  const [lookup, setLookup] = useState<StationLookup | null>(null);
  const [lookupReady, setLookupReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await fetchStationLookup();
        if (!cancelled) {
          setLookup(data);
        }
      } catch (error) {
        console.warn('[TrainSearchIndex] Station lookup failed', error);
      } finally {
        if (!cancelled) {
          setLookupReady(true);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateRoutes = (entries: [string, RouteInfo][]) => {
    if (!entries.length) {
      return;
    }
    const map = routeMapRef.current;
    let changed = false;
    entries.forEach(([id, info]) => {
      const current = map.get(id);
      if (
        current &&
        current.from === info.from &&
        current.to === info.to &&
        current.resolved === info.resolved
      ) {
        return;
      }
      map.set(id, info);
      changed = true;
    });
    if (changed) {
      setRouteVersion(prev => prev + 1);
    }
  };

  const trainMatchIndex = useMemo(() => {
    const map = new Map<string, string>();
    trains.forEach(train => {
      if (train.advertisedTrainIdent) {
        map.set(`adv:${train.advertisedTrainIdent}`, train.id);
      }
      if (train.operationalTrainNumber) {
        map.set(`op:${train.operationalTrainNumber}`, train.id);
      }
    });
    return map;
  }, [trains]);

  useEffect(() => {
    if (!trains.length) {
      return;
    }
    const pending: { filter: TrainIdentifierFilter; trainId: string }[] = [];
    for (const train of trains) {
      if (routeMapRef.current.has(train.id)) {
        continue;
      }
      const advertised = (train.advertisedTrainIdent ?? '').trim() || undefined;
      const operational = (train.operationalTrainNumber ?? '').trim() || undefined;
      if (!advertised && !operational) {
        continue;
      }
      pending.push({
        filter: {
          advertisedTrainIdent: advertised,
          operationalTrainNumber: operational,
        },
        trainId: train.id,
      });
      if (pending.length >= ROUTE_FETCH_LIMIT) {
        break;
      }
    }
    if (!pending.length) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const run = async () => {
      try {
        const identifiers = pending.map(item => item.filter);
        const records = await fetchTrainAnnouncementsByIdentifiers(identifiers, {
          perBatchLimit: 400,
          windowMinutes: 2_880,
          signal: controller.signal,
        });
        if (cancelled) {
          return;
        }
        const updates: [string, RouteInfo][] = [];
        const matched = new Set<string>();

        records.forEach((record: TrainAnnouncementApiEntry) => {
          const advKey = record.advertisedTrainIdent ? `adv:${record.advertisedTrainIdent}` : null;
          const opKey = record.operationalTrainNumber ? `op:${record.operationalTrainNumber}` : null;
          const id = (advKey && trainMatchIndex.get(advKey)) || (opKey && trainMatchIndex.get(opKey));
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
        });

        pending.forEach(item => {
          if (matched.has(item.trainId)) {
            return;
          }
          updates.push([
            item.trainId,
            {
              from: null,
              to: null,
              resolved: true,
            },
          ]);
        });

        updateRoutes(updates);
      } catch (error) {
        if ((error as Error).name === 'AbortError' || cancelled) {
          return;
        }
        console.warn('[TrainSearchIndex] Route fetch failed', error);
        const updates = pending.map(item => [
          item.trainId,
          { from: null, to: null, resolved: true } as RouteInfo,
        ]) as [string, RouteInfo][];
        updateRoutes(updates);
      }
    };

    run();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [trainMatchIndex, trains]);

  const items: TrainSearchItem[] = useMemo(() => {
    const map = routeMapRef.current;
    return trains.map(train => {
      const route = map.get(train.id);
      const routeText = buildRouteLabel(route, lookupReady ? lookup : null);
      const subtitle = routeText ?? train.trainOwner ?? null;
      const haystack = [
        train.label,
        train.advertisedTrainIdent ?? '',
        train.operationalTrainNumber ?? '',
        train.trainOwner ?? '',
        routeText ?? '',
        route?.from ?? '',
        route?.to ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return {
        id: train.id,
        title: train.label,
        subtitle,
        routeText,
        train,
        searchText: haystack,
      };
    });
  }, [lookup, lookupReady, routeVersion, trains]);

  return { items };
}

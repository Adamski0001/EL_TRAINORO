import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { fetchStationLookup, type StationLookup } from '../lib/trafikverket';
import { trainRouteRegistry, type RouteInfo } from '../state/trainRouteRegistry';
import type { TrainPosition } from '../types/trains';
import { useTrainPositions } from './useTrainPositions';

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
  const [lookup, setLookup] = useState<StationLookup | null>(null);
  const [lookupReady, setLookupReady] = useState(false);
  const routeSnapshot = useSyncExternalStore(
    trainRouteRegistry.subscribe,
    trainRouteRegistry.getSnapshot,
    trainRouteRegistry.getSnapshot,
  );

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

  useEffect(() => {
    trainRouteRegistry.ensureRoutesFor(trains);
  }, [trains]);

  const items: TrainSearchItem[] = useMemo(() => {
    const map = routeSnapshot.routes;
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
  }, [lookup, lookupReady, routeSnapshot.version, trains]);

  return { items };
}

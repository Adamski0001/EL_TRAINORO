import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { buildStopsFromAnnouncements } from '../lib/trainStopBuilder';
import {
  fetchStationLookup,
  fetchTrainAnnouncementsByIdentifiers,
  type TrainAnnouncementApiEntry,
} from '../lib/trafikverket';
import type { TrainPosition, TrainStop } from '../types/trains';

export type StationTrainSchedule = {
  stop: TrainStop;
  updatedAt: number | null;
  isFirstStop: boolean;
  isLastStop: boolean;
};

type UseStationTrainTimetablesOptions = {
  enabled?: boolean;
};

const normalizeIdentifier = (value: string | null | undefined) => {
  const trimmed = (value ?? '').trim();
  return trimmed.length ? trimmed : null;
};

const buildTrainKeyIndex = (trains: TrainPosition[]) => {
  const index = new Map<string, string>();
  trains.forEach(train => {
    const adv = normalizeIdentifier(train.advertisedTrainIdent);
    const op = normalizeIdentifier(train.operationalTrainNumber);
    if (adv) {
      index.set(`adv:${adv}`, train.id);
    }
    if (op) {
      index.set(`op:${op}`, train.id);
    }
  });
  return index;
};

const groupAnnouncementsByTrain = (
  announcements: TrainAnnouncementApiEntry[],
  keyIndex: Map<string, string>,
) => {
  const grouped = new Map<string, TrainAnnouncementApiEntry[]>();
  announcements.forEach(entry => {
    const adv = normalizeIdentifier(entry.advertisedTrainIdent);
    const op = normalizeIdentifier(entry.operationalTrainNumber);
    const trainId =
      (adv && keyIndex.get(`adv:${adv}`)) || (op && keyIndex.get(`op:${op}`)) || null;
    if (!trainId) {
      return;
    }
    const bucket = grouped.get(trainId) ?? [];
    bucket.push(entry);
    grouped.set(trainId, bucket);
  });
  return grouped;
};

const buildStationMatchPredicate = (
  targetSignature: string,
  targetName: string | null,
) => {
  const normalizedName = targetName?.trim().toLowerCase() ?? null;
  return (stop: TrainStop) => {
    const signature = stop.locationSignature?.trim();
    if (signature && signature === targetSignature) {
      return true;
    }
    if (!signature && normalizedName) {
      return stop.stationName.trim().toLowerCase() === normalizedName;
    }
    return false;
  };
};

export function useStationTrainTimetables(
  trains: TrainPosition[],
  stationSignature: string | null,
  options: UseStationTrainTimetablesOptions = {},
) {
  const [timetables, setTimetables] = useState<Record<string, StationTrainSchedule>>({});
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const enabled = options.enabled ?? true;

  const normalizedSignature = (stationSignature ?? '').trim();

  const identifierFilters = useMemo(() => {
    const seen = new Set<string>();
    const list: { advertisedTrainIdent?: string; operationalTrainNumber?: string }[] = [];
    trains.forEach(train => {
      const adv = normalizeIdentifier(train.advertisedTrainIdent);
      const op = normalizeIdentifier(train.operationalTrainNumber);
      if (!adv && !op) {
        return;
      }
      const key = `${adv ?? ''}|${op ?? ''}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      list.push({
        advertisedTrainIdent: adv ?? undefined,
        operationalTrainNumber: op ?? undefined,
      });
    });
    return list;
  }, [trains]);

  const keyIndex = useMemo(() => buildTrainKeyIndex(trains), [trains]);

  const performLoad = useCallback(async () => {
    if (!enabled) {
      return;
    }

    if (!normalizedSignature || identifierFilters.length === 0) {
      setTimetables({});
      setLoading(false);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);

    try {
      const [lookup, announcements] = await Promise.all([
        fetchStationLookup(),
        fetchTrainAnnouncementsByIdentifiers(identifierFilters, {
          windowMinutes: 1_440,
          signal: controller.signal,
        }),
      ]);

      const grouped = groupAnnouncementsByTrain(announcements, keyIndex);
      const stationName = lookup[normalizedSignature]?.name ?? null;
      const matchStop = buildStationMatchPredicate(normalizedSignature, stationName);
      const next: Record<string, StationTrainSchedule> = {};

      grouped.forEach((records, trainId) => {
        const stops = buildStopsFromAnnouncements(records, lookup);
        const stopIndex = stops.findIndex(matchStop);
        if (stopIndex === -1) {
          return;
        }
        const stop = stops[stopIndex];
        const isFirstStop = stopIndex === 0;
        const isLastStop = stopIndex === stops.length - 1;
        const updatedAt = records.reduce((latest, record) => {
          const time = Date.parse(record.modifiedTime ?? record.advertisedTimeAtLocation ?? '');
          if (Number.isNaN(time)) {
            return latest;
          }
          return Math.max(latest, time);
        }, 0);
        next[trainId] = { stop, updatedAt: updatedAt || null, isFirstStop, isLastStop };
      });

      setTimetables(next);
      setLastUpdated(Date.now());
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        return;
      }
      console.warn('[StationTrainTimetables] Failed to load train times', error);
    } finally {
      setLoading(false);
    }
  }, [enabled, identifierFilters, keyIndex, normalizedSignature]);

  useEffect(() => {
    if (!enabled) {
      setTimetables({});
      setLoading(false);
      abortRef.current?.abort();
      return () => {};
    }
    void performLoad();
    const interval = setInterval(() => {
      void performLoad();
    }, 60_000);
    return () => {
      clearInterval(interval);
      abortRef.current?.abort();
    };
  }, [enabled, performLoad]);

  const refetch = useCallback(() => {
    void performLoad();
  }, [performLoad]);

  return {
    timetables,
    loading,
    lastUpdated,
    refetch,
  };
}

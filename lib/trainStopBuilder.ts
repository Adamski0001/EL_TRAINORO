import {
  type StationLookup,
  type TrainAnnouncementApiEntry,
} from './trafikverket';
import type { TrainStop } from '../types/trains';

const parseDate = (value: string | null): Date | null => {
  if (!value) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms);
};

const resolveStationName = (
  signature: string | null,
  fallback: string | null,
  lookup: StationLookup,
) => {
  if (fallback?.trim()) {
    return fallback.trim();
  }
  if (signature?.trim()) {
    return lookup[signature.trim()]?.name ?? signature.trim();
  }
  return 'Okänd plats';
};

const activityType = (entry: TrainAnnouncementApiEntry) =>
  (entry.activityType ?? '').toLowerCase();

const isArrivalActivity = (entry: TrainAnnouncementApiEntry) => {
  const type = activityType(entry);
  return type.includes('ank') || type.includes('arr');
};

const isDepartureActivity = (entry: TrainAnnouncementApiEntry) => {
  const type = activityType(entry);
  return type.includes('avg') || type.includes('dep');
};

type InternalStop = TrainStop & {
  order: number;
  hasArrival: boolean;
  hasDeparture: boolean;
};

export const buildStopsFromAnnouncements = (
  announcements: TrainAnnouncementApiEntry[],
  lookup: StationLookup,
): TrainStop[] => {
  const locationBuckets = new Map<string, InternalStop[]>();
  const stopsInOrder: InternalStop[] = [];
  let orderCounter = 0;

  const resolveKey = (entry: TrainAnnouncementApiEntry, index: number) => {
    const signature = entry.locationSignature?.trim();
    if (signature) {
      return signature;
    }
    const advertisedName = entry.advertisedLocationName?.trim();
    if (advertisedName) {
      return advertisedName;
    }
    return `unknown-${index}`;
  };

  const selectArrivalTimestamp = (stop: InternalStop) => {
    const candidate =
      stop.arrivalActual ??
      stop.arrivalEstimated ??
      stop.arrivalAdvertised ??
      stop.departureActual ??
      stop.departureEstimated ??
      stop.departureAdvertised;
    return candidate ? candidate.getTime() : Number.MAX_SAFE_INTEGER;
  };

  announcements.forEach((entry, index) => {
    const key = resolveKey(entry, index);
    const advertised = parseDate(entry.advertisedTimeAtLocation);
    const estimated = parseDate(entry.estimatedTimeAtLocation);
    const actual = parseDate(entry.timeAtLocation);
    const arrivalActivity = isArrivalActivity(entry);
    const departureActivity = isDepartureActivity(entry);
    const bucket = locationBuckets.get(key) ?? [];
    let stop = bucket[bucket.length - 1];

    const shouldReuse =
      stop &&
      ((arrivalActivity && !stop.hasArrival) ||
        (departureActivity && !stop.hasDeparture) ||
        (!arrivalActivity && !departureActivity));

    if (!shouldReuse || !stop) {
      const stationName = resolveStationName(
        entry.locationSignature,
        entry.advertisedLocationName,
        lookup,
      );
      stop = {
        id: `${key}-${bucket.length}`,
        stationName,
        locationSignature: entry.locationSignature?.trim() ?? null,
        track: entry.trackAtLocation ?? null,
        arrivalAdvertised: null,
        arrivalEstimated: null,
        arrivalActual: null,
        departureAdvertised: null,
        departureEstimated: null,
        departureActual: null,
        canceled: entry.canceled,
        order: orderCounter++,
        hasArrival: false,
        hasDeparture: false,
      };
      bucket.push(stop);
      stopsInOrder.push(stop);
      locationBuckets.set(key, bucket);
    }

    stop.track = stop.track ?? entry.trackAtLocation ?? null;
    stop.canceled = stop.canceled || entry.canceled;

    const shouldApplyArrival = arrivalActivity || (!stop.hasArrival && !departureActivity);
    const shouldApplyDeparture = departureActivity || (!stop.hasDeparture && !arrivalActivity);

    if (shouldApplyArrival) {
      stop.arrivalAdvertised = advertised ?? stop.arrivalAdvertised;
      stop.arrivalEstimated = estimated ?? stop.arrivalEstimated;
      stop.arrivalActual = actual ?? stop.arrivalActual;
      stop.hasArrival = stop.hasArrival || arrivalActivity;
    }

    if (shouldApplyDeparture) {
      stop.departureAdvertised = advertised ?? stop.departureAdvertised;
      stop.departureEstimated = estimated ?? stop.departureEstimated;
      stop.departureActual = actual ?? stop.departureActual;
      stop.hasDeparture = stop.hasDeparture || departureActivity;
    }
  });

  const sortedStops = stopsInOrder.sort((a, b) => {
    const aKey = selectArrivalTimestamp(a);
    const bKey = selectArrivalTimestamp(b);
    if (aKey !== bKey) {
      return aKey - bKey;
    }
    return a.order - b.order;
  });

  const firstActiveIndex = sortedStops.findIndex(stop => !stop.canceled);
  let lastActiveIndex = -1;
  for (let i = sortedStops.length - 1; i >= 0; i -= 1) {
    if (!sortedStops[i].canceled) {
      lastActiveIndex = i;
      break;
    }
  }

  const trimmedStops =
    firstActiveIndex !== -1 && lastActiveIndex !== -1
      ? sortedStops.slice(firstActiveIndex, lastActiveIndex + 1)
      : sortedStops;

  return trimmedStops.map(({ order, hasArrival, hasDeparture, ...rest }) => rest);
};


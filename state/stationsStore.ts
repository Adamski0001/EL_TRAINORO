import { fetchStationLookup, type StationLookupEntry } from '../lib/trafikverket';
import type {
  Station,
  StationCoordinate,
  StationLineCategory,
  StationLineInfo,
  StationRegion,
  StationServices,
  StationTrafficVolume,
} from '../types/stations';

type StationStoreState = {
  stations: Station[];
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
};

type StationDerivedMetadata = {
  region: StationRegion;
  trafficVolume: StationTrafficVolume;
  lines: StationLineInfo[];
  services: StationServices;
  displayNames: string[];
  coordinateKey: string;
};

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const FULL_REFRESH_INTERVAL_MS = 4 * REFRESH_INTERVAL_MS;

const DEFAULT_STATE: StationStoreState = {
  stations: [],
  loading: true,
  error: null,
  lastUpdated: null,
};

let state: StationStoreState = DEFAULT_STATE;
let firstLoad = true;
let lastFullRefreshAt = 0;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();
const stationCache = new Map<string, Station>();
const derivedMetadataCache = new Map<string, StationDerivedMetadata>();

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

const assignState = (patch: Partial<StationStoreState>) => {
  const nextState: StationStoreState = { ...state };
  let changed = false;

  if (Object.prototype.hasOwnProperty.call(patch, 'stations')) {
    const nextStations = patch.stations ?? [];
    if (nextStations !== state.stations) {
      nextState.stations = nextStations;
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

const REGION_ZONES: Array<{
  name: StationRegion;
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}> = [
  { name: 'Stockholm', latMin: 59.1, latMax: 60.7, lonMin: 17.2, lonMax: 19.5 },
  { name: 'Malardalen', latMin: 59.0, latMax: 60.9, lonMin: 15.0, lonMax: 17.3 },
  { name: 'Vastra Gotaland', latMin: 57.1, latMax: 59.7, lonMin: 10.2, lonMax: 13.6 },
  { name: 'Skane', latMin: 55.3, latMax: 57.6, lonMin: 11.0, lonMax: 15.0 },
  { name: 'Norra Sverige', latMin: 62.0, latMax: 70.0, lonMin: 11.5, lonMax: 25.5 },
  { name: 'Ovriga Sodra Sverige', latMin: 56.0, latMax: 62.0, lonMin: 13.0, lonMax: 25.5 },
];

const MAJOR_CITY_COORDINATES = [
  { name: 'Stockholm', latitude: 59.3326, longitude: 18.0649 },
  { name: 'Goteborg', latitude: 57.7089, longitude: 11.9746 },
  { name: 'Malmo', latitude: 55.6059, longitude: 13.0006 },
  { name: 'Uppsala', latitude: 59.8586, longitude: 17.6389 },
  { name: 'Orebro', latitude: 59.2753, longitude: 15.2134 },
  { name: 'Linkoping', latitude: 58.4108, longitude: 15.6216 },
  { name: 'Umea', latitude: 63.8258, longitude: 20.2630 },
  { name: 'Lulea', latitude: 65.5848, longitude: 22.1547 },
];

const createCoordinateKey = (coordinate: StationCoordinate | null) => {
  if (!coordinate) {
    return 'null';
  }
  return `${coordinate.latitude.toFixed(6)}:${coordinate.longitude.toFixed(6)}`;
};

const classifyRegion = (coordinate: StationCoordinate | null): StationRegion => {
  if (!coordinate) {
    return 'Sverige';
  }
  const { latitude, longitude } = coordinate;
  for (const zone of REGION_ZONES) {
    if (
      latitude >= zone.latMin &&
      latitude <= zone.latMax &&
      longitude >= zone.lonMin &&
      longitude <= zone.lonMax
    ) {
      return zone.name;
    }
  }
  return 'Sverige';
};

const isNearMajorCity = (coordinate: StationCoordinate | null) => {
  if (!coordinate) {
    return false;
  }
  return MAJOR_CITY_COORDINATES.some(city => {
    const latDiff = Math.abs(city.latitude - coordinate.latitude);
    const lonDiff = Math.abs(city.longitude - coordinate.longitude);
    return latDiff <= 0.5 && lonDiff <= 0.65;
  });
};

const determineTrafficVolume = (
  name: string,
  coordinate: StationCoordinate | null,
  region: StationRegion,
): StationTrafficVolume => {
  const normalized = name.trim().toLowerCase();
  if (normalized.includes('central')) {
    return 'high';
  }
  if (isNearMajorCity(coordinate)) {
    return 'high';
  }
  if (region === 'Skane' || region === 'Vastra Gotaland' || region === 'Malardalen') {
    return 'medium';
  }
  if (region === 'Norra Sverige' && coordinate?.latitude && coordinate.latitude >= 63) {
    return 'low';
  }
  if (coordinate && coordinate.latitude >= 64) {
    return 'low';
  }
  return 'medium';
};

const buildLineInfo = (region: StationRegion, trafficVolume: StationTrafficVolume): StationLineInfo[] => {
  const entries = new Map<StationLineCategory, StationLineInfo>();

  const addLine = (category: StationLineCategory, name: string, description?: string) => {
    if (!entries.has(category)) {
      entries.set(category, { name, category, description });
    }
  };

  addLine('Regionaltåg', 'Regionaltåg');

  if (trafficVolume === 'high') {
    addLine('Fjärrtåg', 'Fjärrtåg');
    addLine('Godståg', 'Godståg');
  } else {
    addLine('Lokaltåg', 'Lokaltåg');
  }

  if (region === 'Stockholm') {
    addLine('Pendeltåg', 'Pendeltåg');
  }

  return Array.from(entries.values());
};

const buildServices = (trafficVolume: StationTrafficVolume): StationServices => ({
  hasParking: trafficVolume !== 'low',
  hasRestrooms: true,
  hasAccessibility: true,
  hasTicketOffice: trafficVolume !== 'low',
  hasShops: trafficVolume === 'high',
});

const buildDisplayNames = (
  entry: StationLookupEntry,
  fallbackName: string,
): string[] => {
  const candidates = [fallbackName, entry.shortName ?? null, entry.officialName ?? null];
  const normalized = candidates.filter(Boolean).map(name => name!.trim());
  return Array.from(new Set(normalized));
};

const getStationDerivedMetadata = (
  entry: StationLookupEntry,
  coordinate: StationCoordinate | null,
): StationDerivedMetadata => {
  const coordinateKey = createCoordinateKey(coordinate);
  const cached = derivedMetadataCache.get(entry.signature);
  if (cached && cached.coordinateKey === coordinateKey) {
    return cached;
  }

  const displayName = entry.name?.trim() || entry.signature;
  const region = classifyRegion(coordinate);
  const trafficVolume = determineTrafficVolume(displayName, coordinate, region);
  const lines = buildLineInfo(region, trafficVolume);
  const services = buildServices(trafficVolume);
  const displayNames = buildDisplayNames(entry, displayName);

  const metadata: StationDerivedMetadata = {
    region,
    trafficVolume,
    lines,
    services,
    displayNames,
    coordinateKey,
  };

  derivedMetadataCache.set(entry.signature, metadata);
  return metadata;
};

const normalizeStation = (entry: StationLookupEntry): Station | null => {
  const signature = entry.signature?.trim();
  if (!signature) {
    return null;
  }

  const latitude = typeof entry.latitude === 'number' ? entry.latitude : null;
  const longitude = typeof entry.longitude === 'number' ? entry.longitude : null;
  const coordinate =
    latitude === null || longitude === null
      ? null
      : {
          latitude,
          longitude,
        };

  const derived = getStationDerivedMetadata(entry, coordinate);

  return {
    id: signature,
    signature,
    displayName:
      entry.name?.trim() || entry.officialName?.trim() || entry.shortName?.trim() || signature,
    shortDisplayName: entry.shortName ?? null,
    officialName: entry.officialName ?? null,
    displayNames: derived.displayNames,
    coordinate,
    region: derived.region,
    trafficVolume: derived.trafficVolume,
    lines: derived.lines,
    services: derived.services,
  };
};

const startPolling = () => {
  if (refreshTimer) {
    return;
  }
  void loadStations();
  refreshTimer = setInterval(() => {
    void loadStations();
  }, REFRESH_INTERVAL_MS);
};

const stopPolling = () => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
};

async function loadStations(options: { forceRefresh?: boolean } = {}) {
  const now = Date.now();
  const shouldForceRefresh =
    options.forceRefresh || firstLoad || now - lastFullRefreshAt > FULL_REFRESH_INTERVAL_MS;
  const showLoading = firstLoad || Boolean(options.forceRefresh);

  if (showLoading) {
    assignState({ loading: true });
  }

  if (firstLoad) {
    assignState({ error: null });
  }

  try {
    const lookup = await fetchStationLookup({ forceRefresh: shouldForceRefresh });
    const normalized = Object.values(lookup)
      .map(normalizeStation)
      .filter((station): station is Station => Boolean(station));

    normalized.sort((a, b) => a.displayName.localeCompare(b.displayName));

    stationCache.clear();
    normalized.forEach(station => {
      stationCache.set(station.id, station);
    });

    const stationsChanged =
      normalized.length !== state.stations.length ||
      normalized.some((station, index) => state.stations[index]?.id !== station.id);

    const patch: Partial<StationStoreState> = {
      error: null,
      lastUpdated: new Date(),
    };

    if (stationsChanged) {
      patch.stations = normalized;
    }

    if (Object.keys(patch).length) {
      assignState(patch);
    }

    if (shouldForceRefresh) {
      lastFullRefreshAt = now;
    }
  } catch (error) {
    console.error('[StationsStore] Failed to load stations', error);
    assignState({
      error: error instanceof Error ? error.message : 'Kunde inte läsa in stationerna.',
    });
  } finally {
    if (showLoading) {
      assignState({ loading: false });
    }
    firstLoad = false;
  }
}

export const stationsStore = {
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
  getStationById(id: string | null) {
    if (!id) {
      return null;
    }
    return stationCache.get(id) ?? null;
  },
  refetch(options: { forceRefresh?: boolean } = {}) {
    return loadStations({ forceRefresh: options.forceRefresh ?? true });
  },
};

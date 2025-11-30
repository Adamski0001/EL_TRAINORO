import { BlurView } from 'expo-blur';
import { X } from 'lucide-react-native';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { trainRouteRegistry, type RouteInfo } from '../../state/trainRouteRegistry';
import { useTrainPositions } from '../../hooks/useTrainPositions';
import { useTrafficEvents } from '../../hooks/useTrafficEvents';
import type { TrainPosition, TrainStop } from '../../types/trains';
import type { TrafficEvent } from '../../types/traffic';
import type {
  Station,
  StationCoordinate,
  StationTrafficVolume,
} from '../../types/stations';
import type { TrafficSheetSnapPoint } from '../traffic/sheetSnapPoints';
import {
  SHEET_BOTTOM_LOCK_REGION,
  SHEET_FLICK_VELOCITY,
  SHEET_SNAP_POINTS,
  SHEET_SNAP_SEQUENCE,
  SHEET_STICKY_ZONE,
  SHEET_TIMING_CONFIG,
  SHEET_TOP_LOCK_REGION,
  clampSheetPosition,
  findNearestSheetSnap,
  snapSheetInDirection,
} from '../traffic/sheetSnapPoints';
import { useStations } from '../../hooks/useStations';
import {
  useStationTrainTimetables,
  type StationTrainSchedule,
} from '../../hooks/useStationTrainTimetables';
import { haptics } from '../../lib/haptics';

const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/+$/, '');

const TIMELINE_COLUMN_WIDTH = 26;
const STOP_ROW_HORIZONTAL_PADDING = 16;
const EARTH_RADIUS_METERS = 6_371_000;
const PAST_GRACE_MINUTES = 15;
const UPCOMING_WINDOW_MINUTES = 12 * 60;

type TabKey = 'departures' | 'arrivals';

const TAB_KEYS: TabKey[] = ['departures', 'arrivals'];
const TAB_LABELS: Record<TabKey, string> = {
  departures: 'Avgående',
  arrivals: 'Ankommande',
};

const CROWDING_MAP: Record<
  StationTrafficVolume,
  { label: string; description: string; color: string }
> = {
  high: { label: 'Fullt', description: 'Mycket folk – räkna med köer.', color: '#FF8A3D' },
  medium: { label: 'Rörligt', description: 'Normal nivå med tryggt avstånd.', color: '#62CDFF' },
  low: { label: 'Lugnt', description: 'Gott om plats och snabba byten.', color: '#8EF4A7' },
};

const TRAFFIC_SEVERITY_COLORS: Record<TrafficEvent['severity'], string> = {
  critical: '#FF5B5B',
  high: '#FF8A3D',
  medium: '#FFD166',
  low: '#7DD87C',
};

type StationStopApiEntry = {
  advertisedTrainIdent: string | null;
  operationalTrainNumber: string | null;
  fromLocation: string[];
  toLocation: string[];
  activityType: 'Arrival' | 'Departure';
  advertisedTimeAtLocation: string | null;
  estimatedTimeAtLocation: string | null;
  timeAtLocation: string | null;
  trackAtLocation: string | null;
  canceled: boolean;
  deviation: string[];
  productInformation: string[];
  operator: string | null;
};

type StationStopApiResponse = {
  station: string;
  arrivals: StationStopApiEntry[];
  departures: StationStopApiEntry[];
};

type StopStatus = 'on-time' | 'delayed' | 'canceled';

type StationTrainEntry = {
  id: string;
  label: string;
  operator: string | null;
  routeLabel: string;
  updatedLabel: string;
  updatedAt: number | null;
  distanceLabel: string | null;
  distanceMeters: number | null;
  direction: TabKey;
  train: TrainPosition;
  isLive: boolean;
  sortTimestamp: number;
  track: string | null;
  status: StopStatus;
  etaLabel: string | null;
  plannedTime: Date | null;
  estimatedTime: Date | null;
  canceled: boolean;
  delayMinutes: number | null;
};

type StationStopGroups = {
  arrivals: StationTrainEntry[];
  departures: StationTrainEntry[];
  timetables: Record<string, StationTrainSchedule>;
};

const toRadians = (value: number) => (value * Math.PI) / 180;

const computeDistanceMeters = (from: StationCoordinate, to: StationCoordinate) => {
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
};

const computeBearing = (from: StationCoordinate, to: StationCoordinate) => {
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return (bearing + 360) % 360;
};

const normalizeBearing = (bearing?: number | null) => {
  if (bearing === null || bearing === undefined || Number.isNaN(bearing)) {
    return null;
  }
  return ((bearing % 360) + 360) % 360;
};

const angularDifference = (a: number, b: number) => {
  let diff = Math.abs(a - b) % 360;
  if (diff > 180) {
    diff = 360 - diff;
  }
  return diff;
};

const formatDistanceLabel = (meters: number) => {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
};

const formatUpdatedLabel = (timestamp: number | null) => {
  if (!timestamp || Number.isNaN(timestamp)) {
    return 'Uppdaterad nyligen';
  }
  const diffMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (diffMinutes < 1) {
    return 'Uppdaterad nyss';
  }
  if (diffMinutes < 60) {
    return `Uppdaterad ${diffMinutes} min sedan`;
  }
  const hours = Math.floor(diffMinutes / 60);
  const remainder = diffMinutes % 60;
  if (remainder === 0) {
    return `Uppdaterad ${hours} h sedan`;
  }
  return `Uppdaterad ${hours} h ${remainder} min sedan`;
};

const parseApiDate = (value: string | null | undefined): Date | null => {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }
  return new Date(timestamp);
};

const buildEtaLabel = (target: Date | null, canceled: boolean, now: number) => {
  if (canceled) {
    return 'Inställt';
  }
  if (!target) {
    return null;
  }
  const diffMinutes = Math.round((target.getTime() - now) / 60000);
  if (diffMinutes <= -1) {
    return 'Nyss';
  }
  if (diffMinutes <= 0) {
    return 'Nu';
  }
  if (diffMinutes < 60) {
    return `Om ${diffMinutes} min`;
  }
  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;
  if (minutes === 0) {
    return `Om ${hours} h`;
  }
  return `Om ${hours} h ${minutes} min`;
};

const computeStopStatus = (
  planned: Date | null,
  estimated: Date | null,
  actual: Date | null,
  canceled: boolean,
): { status: StopStatus; delayMinutes: number | null } => {
  if (canceled) {
    return { status: 'canceled', delayMinutes: null };
  }
  const reference = actual ?? estimated;
  if (planned && reference) {
    const diffMinutes = Math.round((reference.getTime() - planned.getTime()) / 60000);
    if (diffMinutes > 0) {
      return { status: 'delayed', delayMinutes: diffMinutes };
    }
  }
  return { status: 'on-time', delayMinutes: null };
};

const buildStopSortInfo = (announcement: StationStopApiEntry) => {
  const advertisedTime = parseApiDate(announcement.advertisedTimeAtLocation);
  const estimatedTime = parseApiDate(announcement.estimatedTimeAtLocation);
  const actualTime = parseApiDate(announcement.timeAtLocation);
  const targetTime = actualTime ?? estimatedTime ?? advertisedTime ?? null;
  const sortTimestamp = targetTime ? targetTime.getTime() : Number.MAX_SAFE_INTEGER;
  return { advertisedTime, estimatedTime, actualTime, targetTime, sortTimestamp };
};

const sortTrainEntriesByTime = (list: StationTrainEntry[]) =>
  list.sort((a, b) => {
    if (a.sortTimestamp !== b.sortTimestamp) {
      return a.sortTimestamp - b.sortTimestamp;
    }
    const aTime = a.updatedAt ?? 0;
    const bTime = b.updatedAt ?? 0;
    return aTime - bTime;
  });

const getEntryTimestamp = (entry: StationTrainEntry): number | null => {
  const candidate =
    entry.estimatedTime ??
    entry.plannedTime ??
    (entry.sortTimestamp !== Number.MAX_SAFE_INTEGER
      ? new Date(entry.sortTimestamp)
      : null);
  if (!candidate) {
    return null;
  }
  const ts = candidate.getTime();
  return Number.isNaN(ts) ? null : ts;
};

const determineTrainDirection = (
  train: TrainPosition,
  stationSignature: string,
  stationCoordinate: StationCoordinate | null,
  route: RouteInfo | null,
): TabKey | null => {
  if (route?.to === stationSignature) {
    return 'arrivals';
  }
  if (route?.from === stationSignature) {
    return 'departures';
  }
  if (!stationCoordinate || !train.coordinate) {
    return null;
  }
  const distance = computeDistanceMeters(train.coordinate, stationCoordinate);
  if (distance > 11_000) {
    return null;
  }
  const heading = normalizeBearing(train.bearing);
  if (heading === null) {
    return null;
  }
  const bearingToStation = computeBearing(train.coordinate, stationCoordinate);
  const diff = angularDifference(heading, bearingToStation);
  if (diff <= 110) {
    return 'arrivals';
  }
  return 'departures';
};

const resolveDirectionForStop = (
  schedule: StationTrainSchedule,
  train: TrainPosition,
  stationSignature: string,
  stationCoordinate: StationCoordinate | null,
  route: RouteInfo | null,
): TabKey => {
  if (schedule.isFirstStop) {
    return 'departures';
  }
  if (schedule.isLastStop) {
    return 'arrivals';
  }
  if (route?.to === stationSignature) {
    return 'arrivals';
  }
  if (route?.from === stationSignature) {
    return 'departures';
  }
  return determineTrainDirection(train, stationSignature, stationCoordinate, route) ?? 'arrivals';
};

type TimingInfo = {
  plannedLabel: string;
  actualLabel: string;
  hasDelay: boolean;
  delayMinutes: number | null;
};

type StopTiming = {
  arrival: TimingInfo | null;
  departure: TimingInfo | null;
};

const formatDisplayTime = (value: Date | null) => {
  if (!value) {
    return '—';
  }
  return value.toLocaleTimeString('sv-SE', {
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatDisplayDate = (value: Date | null, referenceTimestamp?: number) => {
  if (!value) {
    return null;
  }
  const reference = referenceTimestamp ? new Date(referenceTimestamp) : new Date();
  const options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
  };
  if (value.getFullYear() !== reference.getFullYear()) {
    options.year = 'numeric';
  }
  return value.toLocaleDateString('sv-SE', options);
};

const buildTimingInfo = (
  planned: Date | null,
  actual: Date | null,
  estimated: Date | null,
): TimingInfo | null => {
  const actualSource = actual ?? estimated ?? planned ?? null;
  if (!planned && !actualSource) {
    return null;
  }
  const plannedLabel = formatDisplayTime(planned);
  const actualLabel = formatDisplayTime(actualSource);
  const delayMinutes =
    planned && actualSource
      ? Math.max(0, Math.round((actualSource.getTime() - planned.getTime()) / 60000))
      : null;
  const hasDelay = delayMinutes !== null && delayMinutes > 0;
  return { plannedLabel, actualLabel, hasDelay, delayMinutes: hasDelay ? delayMinutes : null };
};

const extractTimingFromStop = (schedule: StationTrainSchedule | null | undefined): StopTiming => {
  if (!schedule) {
    return { arrival: null, departure: null };
  }
  const { stop, isFirstStop, isLastStop } = schedule;
  const arrival = buildTimingInfo(stop.arrivalAdvertised, stop.arrivalActual, stop.arrivalEstimated);
  let departure = isLastStop
    ? null
    : buildTimingInfo(stop.departureAdvertised, stop.departureActual, stop.departureEstimated);

  // Origin: mirror departure as arrival when arrival is missing
  let arrivalTiming = arrival;
  if (!arrivalTiming && isFirstStop && departure) {
    arrivalTiming = departure;
  }
  // Origin with only arrival: mirror arrival to departure to show both
  if (isFirstStop && arrivalTiming && !departure) {
    departure = arrivalTiming;
  }

  return { arrival: arrivalTiming, departure };
};

type StationPanelProps = {
  station: Station;
  visible: boolean;
  initialSnap?: Exclude<TrafficSheetSnapPoint, 'hidden'>;
  onClose: () => void;
  onSnapPointChange?: (point: TrafficSheetSnapPoint) => void;
  onOpenTrain: (train: TrainPosition) => void;
};

function StationPanelComponent({
  station,
  visible,
  initialSnap = 'half',
  onClose,
  onSnapPointChange,
  onOpenTrain,
}: StationPanelProps) {
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(SHEET_SNAP_POINTS.hidden);
  const startY = useSharedValue(SHEET_SNAP_POINTS.hidden);
  const [activeTab, setActiveTab] = useState<TabKey>('departures');
  const onCloseRef = useRef(onClose);
  const onSnapPointChangeRef = useRef(onSnapPointChange);
  const { trains } = useTrainPositions();
  const { events } = useTrafficEvents();
  const { stations } = useStations();
  const [stationStops, setStationStops] = useState<StationStopApiResponse | null>(null);
  const [stationStopsLoading, setStationStopsLoading] = useState(false);
  const [stationStopsError, setStationStopsError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const routeSnapshot = useSyncExternalStore(
    trainRouteRegistry.subscribe,
    () => trainRouteRegistry.getSnapshot(),
    () => trainRouteRegistry.getSnapshot(),
  );

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    onSnapPointChangeRef.current = onSnapPointChange;
  }, [onSnapPointChange]);

  useEffect(() => {
    setActiveTab('departures');
  }, [station.id]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    setNow(Date.now());
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 30_000);
    return () => {
      clearInterval(timer);
    };
  }, [visible]);

  useEffect(() => {
    trainRouteRegistry.ensureRoutesFor(trains);
  }, [trains]);

  const stationNameLookup = useMemo(() => {
    const map = new Map<string, Station>();
    stations.forEach(entry => map.set(entry.signature, entry));
    return map;
  }, [stations]);

  const resolveStationName = useCallback(
    (signature: string | null | undefined) => {
      const normalized = (signature ?? '').trim();
      if (!normalized) {
        return null;
      }
      const stationEntry = stationNameLookup.get(normalized);
      if (!stationEntry) {
        return normalized;
      }
      return (
        stationEntry.officialName?.trim() ||
        stationEntry.displayName?.trim() ||
        stationEntry.displayNames.find(Boolean)?.trim() ||
        stationEntry.shortDisplayName?.trim() ||
        normalized
      );
    },
    [stationNameLookup],
  );

  const normalizeOperatorLabel = useCallback((value: string | null | undefined) => {
    const trimmed = (value ?? '').trim();
    if (!trimmed) {
      return null;
    }
    return trimmed.length <= 4 ? trimmed.toUpperCase() : trimmed;
  }, []);

  const loadStationStops = useCallback(
    async (signature: string, signal?: AbortSignal): Promise<StationStopApiResponse> => {
      const normalized = signature.trim();
      if (!normalized) {
        throw new Error('Station saknas.');
      }
      if (!API_BASE_URL) {
        console.warn(
          '[StationPanel] EXPO_PUBLIC_API_BASE_URL saknas – använder relativ /api/station, sätt env för fullständiga tidtabeller.',
        );
      }
      const endpoint = `${API_BASE_URL ? `${API_BASE_URL}` : ''}/api/station/${encodeURIComponent(normalized)}`;
      const response = await fetch(endpoint, { signal });
      if (!response.ok) {
        const message = await response.text().catch(() => '');
        throw new Error(message || `Kunde inte hämta station (${response.status})`);
      }
      return (await response.json()) as StationStopApiResponse;
    },
    [],
  );

  const buildTrainRouteLabel = useCallback(
    (route: RouteInfo | null, train: TrainPosition, fromOverride?: string | null, toOverride?: string | null) => {
      const fromLabel = fromOverride ?? (route?.from ? resolveStationName(route.from) : null);
      const toLabel = toOverride ?? (route?.to ? resolveStationName(route.to) : null);
      if (fromLabel && toLabel) {
        return `${fromLabel} → ${toLabel}`;
      }
      if (fromLabel && !toLabel) {
        return `Från ${fromLabel}`;
      }
      if (!fromLabel && toLabel) {
        return `Mot ${toLabel}`;
      }
      return train.label ? `Tåg ${train.label}` : 'Tåg';
    },
    [resolveStationName],
  );

  const displayName =
    resolveStationName(station.signature) ??
    station.officialName?.trim() ??
    station.displayName ??
    station.signature;
  const isStockholmC =
    station.signature?.trim().toLowerCase() === 'cst' ||
    (displayName?.trim().toLowerCase() ?? '') === 'stockholm c';
  const crowding = CROWDING_MAP[station.trafficVolume];
  const crowdingLabel = crowding?.label ?? 'Okänt';
  const crowdingDescription = crowding?.description ?? 'Ingen aktuell prognos.';
  const crowdingColor = crowding?.color ?? '#62CDFF';

  useEffect(() => {
    const signature = station.signature?.trim();
    if (!visible || !signature) {
      setStationStops(null);
      setStationStopsError(null);
      setStationStopsLoading(false);
      return () => {};
    }
    const controller = new AbortController();
    setStationStopsLoading(true);
    setStationStopsError(null);
    loadStationStops(signature, controller.signal)
      .then(data => {
        setStationStops(data);
      })
      .catch(error => {
        if (controller.signal.aborted) {
          return;
        }
        setStationStops(null);
        setStationStopsError(
          error instanceof Error ? error.message : 'Kunde inte hämta stationstider',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setStationStopsLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [loadStationStops, station.signature, visible]);

  useEffect(() => {
    if (stationStopsError) {
      console.warn('[StationPanel] station stop load failed', stationStopsError);
    }
  }, [stationStopsError]);

  const { timetables } = useStationTrainTimetables(trains, station.signature, {
    enabled: visible && !stationStops,
    includeStationScope: true,
    windowMinutes: 2_880,
  });

  const liveTrainGroups = useMemo(() => {
    const arrivals: StationTrainEntry[] = [];
    const departures: StationTrainEntry[] = [];
    const normalizedSignature = station.signature.trim();
    const nowMs = now;
    const liveTrainMap = new Map<string, TrainPosition>();
    trains.forEach(train => liveTrainMap.set(train.id, train));

    Object.entries(timetables).forEach(([id, schedule]) => {
      const stop = schedule.stop;
      const liveTrain = liveTrainMap.get(id) ?? null;
      const trainId =
        liveTrain?.id ?? schedule.advertisedTrainIdent ?? schedule.operationalTrainNumber ?? id;
      const route = trainRouteRegistry.getRoute(trainId);
      const baseTrain: TrainPosition =
        liveTrain ??
        ({
          id: trainId,
          label: schedule.advertisedTrainIdent ?? schedule.operationalTrainNumber ?? `Tåg ${trainId}`,
          advertisedTrainIdent: schedule.advertisedTrainIdent,
          operationalTrainNumber: schedule.operationalTrainNumber,
          operationalTrainDepartureDate: null,
          journeyPlanNumber: null,
          journeyPlanDepartureDate: null,
          trainOwner: schedule.operator,
          coordinate: station.coordinate ?? { latitude: 0, longitude: 0 },
          speed: null,
          bearing: null,
          updatedAt: new Date(Math.max(schedule.updatedAt ?? nowMs, nowMs)).toISOString(),
        } as TrainPosition);

      const direction = resolveDirectionForStop(
        schedule,
        baseTrain,
        normalizedSignature,
        station.coordinate,
        route,
      );
      const updatedAt = Number.isNaN(Date.parse(baseTrain.updatedAt))
        ? nowMs
        : Date.parse(baseTrain.updatedAt);
      const distanceMeters =
        station.coordinate && liveTrain?.coordinate
          ? computeDistanceMeters(liveTrain.coordinate, station.coordinate)
          : null;
      const stopTime =
        direction === 'departures'
          ? stop.departureActual ?? stop.departureEstimated ?? stop.departureAdvertised
          : stop.arrivalActual ?? stop.arrivalEstimated ?? stop.arrivalAdvertised;
      const sortTimestamp = stopTime ? stopTime.getTime() : Number.MAX_SAFE_INTEGER;
      const plannedTime =
        direction === 'departures' ? stop.departureAdvertised : stop.arrivalAdvertised;
      const estimatedTime =
        direction === 'departures' ? stop.departureEstimated : stop.arrivalEstimated;
      const actualTime = direction === 'departures' ? stop.departureActual : stop.arrivalActual;
      const targetTime = stopTime ?? plannedTime ?? null;
      const { status, delayMinutes } = computeStopStatus(
        plannedTime,
        estimatedTime,
        actualTime,
        stop.canceled,
      );
      const etaLabel = buildEtaLabel(targetTime, stop.canceled, nowMs);
      const track = stop.track ?? null;
      const operatorLabel =
        normalizeOperatorLabel(route?.operator) ??
        normalizeOperatorLabel(schedule.operator) ??
        normalizeOperatorLabel(baseTrain.trainOwner) ??
        null;
      const entry: StationTrainEntry = {
        id: trainId,
        label: baseTrain.label,
        operator: operatorLabel,
        routeLabel: buildTrainRouteLabel(
          route,
          baseTrain,
          schedule.fromStationName,
          schedule.toStationName,
        ),
        updatedLabel: formatUpdatedLabel(updatedAt),
        updatedAt,
        distanceLabel: distanceMeters !== null ? formatDistanceLabel(distanceMeters) : null,
        distanceMeters,
        direction,
        train: baseTrain,
        isLive: Boolean(liveTrain),
        sortTimestamp,
        track,
        status,
        etaLabel,
        plannedTime: plannedTime ?? null,
        estimatedTime: estimatedTime ?? null,
        canceled: stop.canceled,
        delayMinutes,
      };
      if (direction === 'arrivals') {
        arrivals.push(entry);
      } else {
        departures.push(entry);
      }
    });

    sortTrainEntriesByTime(arrivals);
    sortTrainEntriesByTime(departures);
    return { arrivals, departures };
  }, [
    buildTrainRouteLabel,
    normalizeOperatorLabel,
    station.coordinate,
    station.signature,
    timetables,
    trains,
    now,
  ]);

  const stationStopGroups = useMemo<StationStopGroups | null>(() => {
    if (!stationStops) {
      return null;
    }

    const buildEntry = (announcement: StationStopApiEntry, direction: TabKey, index: number) => {
      const { advertisedTime, estimatedTime, actualTime, targetTime, sortTimestamp } =
        buildStopSortInfo(announcement);
      const idBase =
        announcement.operationalTrainNumber ??
        announcement.advertisedTrainIdent ??
        `${direction}-${index}`;
      const entryId = `${direction}-${idBase}-${announcement.advertisedTimeAtLocation ?? index}`;
      const operatorLabel =
        normalizeOperatorLabel(announcement.operator ?? announcement.productInformation?.[0]) ??
        null;
      const fromSignature = announcement.fromLocation[0] ?? null;
      const toSignature = announcement.toLocation[0] ?? null;
      const fromName = fromSignature ? resolveStationName(fromSignature) : null;
      const toName = toSignature ? resolveStationName(toSignature) : null;

      const stop: TrainStop = {
        id: entryId,
        stationName: displayName,
        locationSignature: station.signature,
        track: announcement.trackAtLocation ?? null,
        arrivalAdvertised: direction === 'arrivals' ? advertisedTime : null,
        arrivalEstimated: direction === 'arrivals' ? estimatedTime : null,
        arrivalActual: direction === 'arrivals' ? actualTime : null,
        departureAdvertised: direction === 'departures' ? advertisedTime : null,
        departureEstimated: direction === 'departures' ? estimatedTime : null,
        departureActual: direction === 'departures' ? actualTime : null,
        canceled: announcement.canceled,
      };

      const schedule: StationTrainSchedule = {
        stop,
        updatedAt: targetTime?.getTime() ?? null,
        isFirstStop: direction === 'departures',
        isLastStop: direction === 'arrivals',
      };

      const baseTrain: TrainPosition = {
        id: entryId,
        label:
          announcement.advertisedTrainIdent ??
          announcement.operationalTrainNumber ??
          `Tåg ${entryId}`,
        advertisedTrainIdent: announcement.advertisedTrainIdent,
        operationalTrainNumber: announcement.operationalTrainNumber,
        operationalTrainDepartureDate: null,
        journeyPlanNumber: null,
        journeyPlanDepartureDate: null,
        trainOwner: operatorLabel,
        coordinate: station.coordinate ?? { latitude: 0, longitude: 0 },
        speed: null,
        bearing: null,
        updatedAt: (targetTime ?? new Date()).toISOString(),
      };

      const { status, delayMinutes } = computeStopStatus(
        direction === 'departures' ? stop.departureAdvertised : stop.arrivalAdvertised,
        direction === 'departures' ? stop.departureEstimated : stop.arrivalEstimated,
        direction === 'departures' ? stop.departureActual : stop.arrivalActual,
        stop.canceled,
      );

      const etaLabel = buildEtaLabel(targetTime, stop.canceled, now);

      const routeLabel =
        direction === 'arrivals'
          ? buildTrainRouteLabel(null, baseTrain, fromName, displayName)
          : buildTrainRouteLabel(null, baseTrain, displayName, toName);

      const entry: StationTrainEntry = {
        id: entryId,
        label:
          announcement.advertisedTrainIdent ??
          announcement.operationalTrainNumber ??
          idBase.toString(),
        operator: operatorLabel,
        routeLabel,
        updatedLabel: targetTime ? formatUpdatedLabel(targetTime.getTime()) : 'Uppdaterad nyligen',
        updatedAt: targetTime ? targetTime.getTime() : null,
        distanceLabel: null,
        distanceMeters: null,
        direction,
        train: baseTrain,
        isLive: false,
        sortTimestamp,
        track: announcement.trackAtLocation ?? null,
        status,
        etaLabel,
        plannedTime: advertisedTime,
        estimatedTime: estimatedTime ?? actualTime,
        canceled: stop.canceled,
        delayMinutes,
      };

      return { entry, schedule };
    };

    const timetableMap: Record<string, StationTrainSchedule> = {};

    const arrivalEntries = stationStops.arrivals.map((announcement, index) => {
      const { entry, schedule } = buildEntry(announcement, 'arrivals', index);
      timetableMap[entry.id] = schedule;
      return entry;
    });

    const departureEntries = stationStops.departures.map((announcement, index) => {
      const { entry, schedule } = buildEntry(announcement, 'departures', index);
      timetableMap[entry.id] = schedule;
      return entry;
    });

    sortTrainEntriesByTime(arrivalEntries);
    sortTrainEntriesByTime(departureEntries);

    return {
      arrivals: arrivalEntries,
      departures: departureEntries,
      timetables: timetableMap,
    };
  }, [
    buildTrainRouteLabel,
    displayName,
    normalizeOperatorLabel,
    now,
    resolveStationName,
    station.coordinate,
    station.signature,
    stationStops,
  ]);

  const combinedTimetables = stationStopGroups?.timetables ?? timetables;
  const trainGroups = stationStopGroups
    ? { arrivals: stationStopGroups.arrivals, departures: stationStopGroups.departures }
    : liveTrainGroups;

  const displayedTrainGroups = useMemo(() => {
    if (stationStopGroups) {
      return {
        arrivals: stationStopGroups.arrivals,
        departures: stationStopGroups.departures,
      };
    }
    return {
      arrivals: liveTrainGroups.arrivals,
      departures: liveTrainGroups.departures,
    };
  }, [liveTrainGroups.arrivals, liveTrainGroups.departures, stationStopGroups]);

  const filteredTrainGroups = useMemo(() => {
    const minTs = now - PAST_GRACE_MINUTES * 60_000;
    const maxTs = now + UPCOMING_WINDOW_MINUTES * 60_000;
    const filterList = (list: StationTrainEntry[]) => {
      const filtered = list.filter(entry => {
        const ts = getEntryTimestamp(entry);
        if (ts === null) {
          return false;
        }
        return ts >= minTs && ts <= maxTs;
      });
      return sortTrainEntriesByTime([...filtered]);
    };
    return {
      arrivals: filterList(displayedTrainGroups.arrivals ?? []),
      departures: filterList(displayedTrainGroups.departures ?? []),
    };
  }, [displayedTrainGroups.arrivals, displayedTrainGroups.departures, now]);

  const activeList =
    activeTab === 'departures' ? filteredTrainGroups.departures : filteredTrainGroups.arrivals;

  useEffect(() => {
    if (!visible || !isStockholmC) {
      return;
    }
    console.log('[StationPanel][Diag][Stockholm C] stop list snapshot', {
      station: station.signature,
      displayName,
      source: stationStopGroups ? 'api' : 'live',
      arrivals: activeTab === 'arrivals' ? activeList : filteredTrainGroups.arrivals ?? [],
      departures: activeTab === 'departures' ? activeList : filteredTrainGroups.departures ?? [],
      rawArrivals: trainGroups?.arrivals ?? [],
      rawDepartures: trainGroups?.departures ?? [],
      stationStops,
      stationStopsError,
      timestamp: new Date().toISOString(),
    });
  }, [
    activeList,
    displayName,
    isStockholmC,
    station.signature,
    stationStopGroups,
    stationStops,
    stationStopsError,
    trainGroups,
    visible,
    activeTab,
    filteredTrainGroups.arrivals,
    filteredTrainGroups.departures,
  ]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    const buildEntryLabel = (entry: StationTrainEntry) => {
      const schedule = combinedTimetables[entry.id];
      const { arrival, departure } = extractTimingFromStop(schedule);
      const timing = entry.direction === 'arrivals' ? arrival : departure;
      const mainTime =
        timing?.actualLabel ??
        timing?.plannedLabel ??
        formatDisplayTime(entry.plannedTime ?? entry.estimatedTime ?? null);
      const plannedTime = timing?.plannedLabel ?? formatDisplayTime(entry.plannedTime ?? null);
      const dateLabel = formatDisplayDate(entry.plannedTime ?? entry.estimatedTime ?? null, now);
      const parts = [
        entry.direction === 'arrivals' ? 'Ank' : 'Avg',
        mainTime,
        plannedTime ? `(plan ${plannedTime})` : null,
        dateLabel ? `[${dateLabel}]` : null,
        entry.routeLabel,
        entry.track ? `Spår ${entry.track}` : null,
        entry.etaLabel ? `ETA ${entry.etaLabel}` : null,
      ].filter(Boolean);
      return parts.join(' · ');
    };

    const logList = (label: string, list: StationTrainEntry[]) => {
      const lines = list.map(buildEntryLabel);
      console.log('[StationPanel][Debug][Stoplist]', {
        station: station.signature,
        source: stationStopGroups ? 'api' : 'live',
        list: label,
        count: list.length,
        entries: lines,
      });
    };

    logList('arrivals', filteredTrainGroups.arrivals ?? []);
    logList('departures', filteredTrainGroups.departures ?? []);
  }, [
    combinedTimetables,
    filteredTrainGroups.arrivals,
    filteredTrainGroups.departures,
    now,
    station.signature,
    stationStopGroups,
    visible,
  ]);

  useEffect(() => {
    if (stationStopsError && isStockholmC) {
      console.error('[StationPanel][Diag][Stockholm C] stop load error', {
        station: station.signature,
        displayName,
        error: stationStopsError,
      });
    }
  }, [displayName, isStockholmC, station.signature, stationStopsError]);

  const stationEvents = useMemo(() => {
    const normalized = station.signature.trim();
    if (!normalized) {
      return [];
    }
    return events
      .filter(event => event.stations.some(stationEntry => stationEntry.signature === normalized))
      .slice(0, 2);
  }, [events, station.signature]);

  const handleTabPress = useCallback((key: TabKey) => {
    setActiveTab(key);
  }, []);

  const handleTrainPress = useCallback(
    (entry: StationTrainEntry) => {
      haptics.light();
      onOpenTrain(entry.train);
    },
    [onOpenTrain],
  );

  const handleSnapComplete = useCallback((snap: TrafficSheetSnapPoint) => {
    onSnapPointChangeRef.current?.(snap);
    if (snap === 'hidden') {
      onCloseRef.current?.();
    }
  }, []);

  useEffect(() => {
    const target: TrafficSheetSnapPoint = visible ? initialSnap : 'hidden';
    translateY.value = withTiming(
      SHEET_SNAP_POINTS[target],
      SHEET_TIMING_CONFIG,
      finished => {
        if (finished) {
          runOnJS(handleSnapComplete)(target);
        }
      },
    );
  }, [handleSnapComplete, initialSnap, translateY, visible]);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(visible)
        .shouldCancelWhenOutside(false)
        .onBegin(() => {
          startY.value = translateY.value;
        })
        .onUpdate(event => {
          const nextY = startY.value + event.translationY;
          translateY.value = clampSheetPosition(nextY);
        })
        .onEnd(event => {
          'worklet';
          const releaseY = clampSheetPosition(startY.value + event.translationY);
          const velocityY = event.velocityY;
          const isSwipeUp = velocityY < -SHEET_FLICK_VELOCITY;
          const isSwipeDown = velocityY > SHEET_FLICK_VELOCITY;
          let target: TrafficSheetSnapPoint = 'half';
          if (isSwipeUp) {
            target = snapSheetInDirection(releaseY, 'up');
          } else if (isSwipeDown) {
            target = snapSheetInDirection(releaseY, 'down');
          } else if (releaseY <= SHEET_TOP_LOCK_REGION) {
            target = 'full';
          } else if (releaseY >= SHEET_BOTTOM_LOCK_REGION) {
            target = 'hidden';
          } else {
            let stickyTarget: TrafficSheetSnapPoint | null = null;
            let stickyDistance = Number.MAX_VALUE;
            for (let i = 0; i < SHEET_SNAP_SEQUENCE.length; i += 1) {
              const snap = SHEET_SNAP_SEQUENCE[i];
              const distance = Math.abs(releaseY - snap.value);
              if (distance <= SHEET_STICKY_ZONE && distance < stickyDistance) {
                stickyTarget = snap.key;
                stickyDistance = distance;
              }
            }
            target = stickyTarget ?? findNearestSheetSnap(releaseY);
          }

          translateY.value = releaseY;
          translateY.value = withTiming(
            SHEET_SNAP_POINTS[target],
            SHEET_TIMING_CONFIG,
            finished => {
              if (finished) {
                runOnJS(handleSnapComplete)(target);
              }
            },
          );
        }),
    [handleSnapComplete, startY, translateY, visible],
  );

  const animatedStyle = useAnimatedStyle(() => ({
    top: translateY.value,
  }));

  const bottomPadding = Math.max(insets.bottom, 24);

  const distanceDotStyle = (direction: TabKey) =>
    direction === 'arrivals' ? styles.timelineDotArriving : styles.timelineDotDeparting;

  const statusDotStyle = (status: StopStatus) => {
    switch (status) {
      case 'delayed':
        return styles.statusDotDelayed;
      case 'canceled':
        return styles.statusDotCanceled;
      default:
        return styles.statusDotOnTime;
    }
  };

  const eventList = stationEvents.map(event => (
    <View key={event.id} style={styles.eventCard}>
      <View style={styles.eventHeader}>
        <View style={styles.eventSeverityRow}>
          <View
            style={[
              styles.eventSeverityDot,
              { backgroundColor: TRAFFIC_SEVERITY_COLORS[event.severity] },
            ]}
          />
          <Text style={styles.eventSeverityText}>{event.severity}</Text>
        </View>
        {event.impactLabel ? (
          <Text style={styles.eventImpactLabel}>{event.impactLabel}</Text>
        ) : null}
      </View>
      <Text style={styles.eventTitle}>{event.title}</Text>
      {event.description ? (
        <Text style={styles.eventDescription}>{event.description}</Text>
      ) : null}
    </View>
  ));

  const tabButtons = TAB_KEYS.map(key => (
    <Pressable
      key={key}
      onPress={() => handleTabPress(key)}
      style={({ pressed }) => [
        styles.tabButton,
        activeTab === key && styles.tabButtonActive,
        pressed && styles.tabButtonPressed,
      ]}
    >
      <Text style={[styles.tabLabel, activeTab === key && styles.tabLabelActive]}>
        {TAB_LABELS[key]}
      </Text>
      <Text style={styles.tabCount}>{displayedTrainGroups[key].length} tåg</Text>
    </Pressable>
  ));

  return (
    <Animated.View pointerEvents="box-none" style={[styles.container, animatedStyle]}>
      <BlurView intensity={85} tint="dark" style={[styles.sheet, { paddingBottom: bottomPadding }]}>
        <GestureDetector gesture={panGesture}>
          <View style={styles.dragZone}>
            <View style={styles.handle} />
            <View style={styles.sheetHeader}>
                <View style={styles.titleBlock}>
                  <Text style={styles.sheetTitle}>{displayName}</Text>
                  <Text style={styles.sheetSubtitle}>{station.signature}</Text>
                </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  haptics.medium();
                  translateY.value = withTiming(
                    SHEET_SNAP_POINTS.hidden,
                    SHEET_TIMING_CONFIG,
                    finished => {
                      if (finished) {
                        runOnJS(handleSnapComplete)('hidden');
                      }
                    },
                  );
                }}
                hitSlop={10}
                style={styles.closeButton}
              >
                <X color="rgba(255,255,255,0.75)" size={18} />
              </Pressable>
            </View>
          </View>
        </GestureDetector>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPadding + 20 }]}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
        >
          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Trängsel</Text>
              <Text style={[styles.metaValue, { color: crowdingColor }]}>{crowdingLabel}</Text>
              <Text style={styles.metaSub}>{crowdingDescription}</Text>
            </View>
            <View style={[styles.metaItem, styles.metaItemRight]}>
              <Text style={styles.metaLabel}>Region</Text>
              <Text style={styles.metaValue}>{station.region}</Text>
              <Text style={styles.metaSub}>
                {station.trafficVolume.charAt(0).toUpperCase() + station.trafficVolume.slice(1)} trafik
              </Text>
            </View>
          </View>

          <View style={styles.tabRow}>{tabButtons}</View>

          <BlurView intensity={60} tint="dark" style={styles.stopList}>
            {activeList.length ? (
              activeList.map((entry, index) => {
                const operatorLabel = entry.operator ?? '—';
                const schedule = combinedTimetables[entry.id];
                const { arrival, departure } = extractTimingFromStop(schedule);
                const stopCanceled = schedule?.stop?.canceled ?? entry.canceled;
                const stopArrivalTime =
                  schedule?.stop.arrivalActual ??
                  schedule?.stop.arrivalEstimated ??
                  schedule?.stop.arrivalAdvertised ??
                  null;
                const stopDepartureTime =
                  schedule?.stop.departureActual ??
                  schedule?.stop.departureEstimated ??
                  schedule?.stop.departureAdvertised ??
                  null;
                const arrivalDateLabel = formatDisplayDate(
                  stopArrivalTime ?? entry.estimatedTime ?? entry.plannedTime,
                  now,
                );
                const departureDateLabel = formatDisplayDate(
                  stopDepartureTime ?? entry.estimatedTime ?? entry.plannedTime,
                  now,
                );
                const arrivalEta = buildEtaLabel(stopArrivalTime, stopCanceled ?? false, now);
                const departureEta = buildEtaLabel(
                  stopDepartureTime,
                  stopCanceled ?? false,
                  now,
                );
                const primaryTiming = entry.direction === 'arrivals' ? arrival : departure;
                const plannedLabel =
                  primaryTiming?.plannedLabel ?? formatDisplayTime(entry.plannedTime ?? null);
                const actualTimeLabel =
                  primaryTiming?.actualLabel ??
                  primaryTiming?.plannedLabel ??
                  formatDisplayTime(entry.plannedTime ?? null);
                const delayMinutes =
                  primaryTiming?.delayMinutes ?? entry.delayMinutes ?? null;
                const status: StopStatus =
                  entry.status ??
                  (stopCanceled
                    ? 'canceled'
                    : delayMinutes && delayMinutes > 0
                      ? 'delayed'
                      : 'on-time');
                const etaLabel =
                  entry.direction === 'arrivals'
                    ? arrivalEta ?? entry.etaLabel
                    : departureEta ?? entry.etaLabel;
                const showDelayBadge =
                  status === 'delayed' && delayMinutes !== null && delayMinutes > 0;
                const trainTitle = entry.label ? `Tåg ${entry.label}` : 'Tåg';
                const trainSubtitle =
                  operatorLabel !== '—' ? `${trainTitle} · ${operatorLabel}` : trainTitle;
                const trackLabel = entry.track ? `Spår ${entry.track}` : null;
                const subtitleLabel =
                  [trackLabel, trainSubtitle].filter(Boolean).join(' • ') || trainSubtitle;

                return (
                  <Pressable
                    key={entry.id}
                    onPress={() => handleTrainPress(entry)}
                    style={({ pressed }) => [
                      styles.stopRow,
                      index !== activeList.length - 1 && styles.stopRowDivider,
                      pressed && styles.stopRowPressed,
                      status === 'canceled' && styles.stopRowCanceled,
                    ]}
                  >
                    <View style={styles.timelineColumn}>
                      <View
                        style={[
                          styles.timelineConnector,
                          index === 0 && styles.connectorHidden,
                        ]}
                      />
                      <View style={[styles.timelineDot, distanceDotStyle(entry.direction)]} />
                      <View
                        style={[
                          styles.timelineConnector,
                          index === activeList.length - 1 && styles.connectorHidden,
                        ]}
                      />
                    </View>

                    <View style={styles.stopDetails}>
                      <Text
                        style={styles.stopName}
                        numberOfLines={2}
                        ellipsizeMode="tail"
                        adjustsFontSizeToFit
                        minimumFontScale={0.85}
                      >
                        {entry.routeLabel}
                      </Text>
                      <Text style={styles.stopTrack} numberOfLines={1} ellipsizeMode="tail">
                        {subtitleLabel}
                      </Text>
                    </View>

                    <View style={styles.stopTiming}>
                      <View style={styles.timeStack}>
                        {arrival ? (
                          <>
                            <View style={styles.timeRow}>
                              <View style={[styles.statusDot, statusDotStyle(status)]} />
                              <Text style={styles.timeLabel}>Ank</Text>
                              <Text
                                style={[
                                  styles.timeActual,
                                  styles.timeActualArriving,
                                  status === 'canceled' && styles.timeActualCanceled,
                                ]}
                              >
                                {arrival.actualLabel ?? actualTimeLabel}
                              </Text>
                              {showDelayBadge ? (
                                <View style={styles.delayBadge}>
                                  <Text style={styles.delayText}>+{delayMinutes}m</Text>
                                </View>
                              ) : null}
                            </View>
                            {arrivalDateLabel ? (
                              <Text style={styles.timeDate}>{arrivalDateLabel}</Text>
                            ) : null}
                            {showDelayBadge && plannedLabel ? (
                              <Text style={styles.timePlanned}>Plan {plannedLabel}</Text>
                            ) : null}
                            {etaLabel ? <Text style={styles.timePlannedSub}>{etaLabel}</Text> : null}
                          </>
                        ) : null}
                        {departure ? (
                          <>
                            <View style={[styles.timeRow, styles.timeRowTight]}>
                              <View style={[styles.statusDot, statusDotStyle(status)]} />
                              <Text style={styles.timeLabel}>Avg</Text>
                              <Text
                                style={[
                                  styles.timeActual,
                                  styles.timeActualDeparting,
                                  status === 'canceled' && styles.timeActualCanceled,
                                ]}
                              >
                                {departure.actualLabel ?? actualTimeLabel}
                              </Text>
                              {showDelayBadge ? (
                                <View style={styles.delayBadge}>
                                  <Text style={styles.delayText}>+{delayMinutes}m</Text>
                                </View>
                              ) : null}
                            </View>
                            {departureDateLabel ? (
                              <Text style={styles.timeDate}>{departureDateLabel}</Text>
                            ) : null}
                            {showDelayBadge && plannedLabel ? (
                              <Text style={styles.timePlanned}>Plan {plannedLabel}</Text>
                            ) : null}
                            {etaLabel ? (
                              <Text style={styles.timePlannedSub}>{etaLabel}</Text>
                            ) : null}
                          </>
                        ) : null}
                      </View>
                    </View>
                  </Pressable>
                );
              })
            ) : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>
                  {stationStopsLoading
                    ? 'Laddar stationstider...'
                    : `Inga ${activeTab === 'departures' ? 'avgångar' : 'ankomster'} just nu`}
                </Text>
                <Text style={styles.emptySubtitle}>
                  {stationStopsLoading
                    ? 'Hämtar ankomster och avgångar för stationen.'
                    : 'Träffa nästa tåg direkt från kartan när vi får in tidtabeller.'}
                </Text>
              </View>
            )}
          </BlurView>

          {stationEvents.length ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Trafiknotiser</Text>
              <View style={styles.sectionBody}>{eventList}</View>
            </View>
          ) : null}

        </ScrollView>
      </BlurView>
    </Animated.View>
  );
}

export const StationPanel = memo(StationPanelComponent);

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'flex-end',
    pointerEvents: 'box-none',
    zIndex: 9998,
    elevation: 9998,
  },
  sheet: {
    flex: 1,
    width: '100%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: 'rgba(6,12,24,0.72)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowOffset: { width: 0, height: -4 },
    shadowRadius: 20,
    elevation: 18,
  },
  dragZone: {
    paddingHorizontal: 22,
    paddingBottom: 14,
    paddingTop: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    gap: 10,
  },
  handle: {
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignSelf: 'center',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  titleBlock: {
    flex: 1,
    gap: 4,
  },
  sheetTitle: {
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: '700',
  },
  sheetSubtitle: {
    color: 'rgba(255,255,255,0.68)',
    fontSize: 14,
    fontWeight: '600',
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 22,
    paddingVertical: 22,
    paddingBottom: 36,
    gap: 18,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 12,
  },
  metaItem: {
    flex: 1,
    borderRadius: 16,
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  metaItemRight: {
    alignItems: 'flex-end',
  },
  metaLabel: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  metaValue: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  metaSub: {
    color: 'rgba(255,255,255,0.6)',
    marginTop: 2,
    fontSize: 13,
  },
  tabRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 6,
  },
  tabButton: {
    flex: 1,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    justifyContent: 'center',
    gap: 2,
  },
  tabButtonActive: {
    borderColor: 'rgba(98,205,255,0.7)',
    backgroundColor: 'rgba(98,205,255,0.12)',
  },
  tabButtonPressed: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  tabLabel: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    fontWeight: '600',
  },
  tabLabelActive: {
    color: '#FFFFFF',
  },
  tabCount: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
  },
  stopList: {
    borderRadius: 20,
    backgroundColor: 'rgba(6,12,24,0.42)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
    position: 'relative',
  },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: STOP_ROW_HORIZONTAL_PADDING,
    paddingVertical: 12,
    gap: 12,
    position: 'relative',
    zIndex: 1,
    minHeight: 88,
  },
  stopRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  timelineColumn: {
    width: TIMELINE_COLUMN_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    position: 'relative',
    zIndex: 2,
  },
  timelineConnector: {
    flex: 1,
    width: 2,
    backgroundColor: 'transparent',
  },
  connectorHidden: {
    opacity: 0,
  },
  timelineDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: '#FFFFFF',
    zIndex: 3,
  },
  timelineDotArriving: {
    backgroundColor: '#62CDFF',
    borderColor: '#62CDFF',
  },
  timelineDotDeparting: {
    backgroundColor: '#FFE066',
    borderColor: '#FFE066',
  },
  stopDetails: {
    flex: 1,
    justifyContent: 'center',
    minWidth: 0,
    gap: 2,
    paddingVertical: 2,
  },
  stopName: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    flexShrink: 1,
    minWidth: 0,
    lineHeight: 18,
  },
  stopTrack: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    marginTop: 0,
    flexShrink: 1,
  },
  stopTiming: {
    minWidth: 120,
    maxWidth: 142,
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  timeStack: {
    gap: 4,
    alignItems: 'flex-end',
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  timeRowTight: {
    marginTop: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 2,
    backgroundColor: '#8EF4A7',
  },
  statusDotOnTime: {
    backgroundColor: '#8EF4A7',
  },
  statusDotDelayed: {
    backgroundColor: '#FF5B5B',
  },
  statusDotCanceled: {
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  timePlanned: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    marginTop: 2,
  },
  timeDate: {
    color: 'rgba(255,255,255,0.68)',
    fontSize: 12,
    marginTop: 2,
  },
  timePlannedSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
  },
  timeActual: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  timeActualArriving: {
    color: '#62CDFF',
  },
  timeActualDeparting: {
    color: '#FFE066',
  },
  timeActualCanceled: {
    color: 'rgba(255,255,255,0.55)',
  },
  timeLabel: {
    color: 'rgba(255,255,255,0.68)',
    fontSize: 11,
    fontWeight: '600',
  },
  delayBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,91,91,0.65)',
    backgroundColor: 'rgba(255,91,91,0.12)',
  },
  delayText: {
    color: '#FF5B5B',
    fontSize: 11,
    fontWeight: '700',
  },
  stationUpdateLabel: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
  },
  emptyState: {
    paddingVertical: 32,
    alignItems: 'center',
    gap: 6,
  },
  emptyTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  emptySubtitle: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 30,
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    color: '#F2F7FF',
    fontSize: 16,
    fontWeight: '600',
  },
  sectionBody: {
    gap: 12,
  },
  eventCard: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.06)',
    backgroundColor: 'rgba(6,12,24,0.45)',
    padding: 14,
    gap: 8,
  },
  eventHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  eventSeverityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  eventSeverityDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  eventSeverityText: {
    color: 'rgba(255,255,255,0.7)',
    textTransform: 'capitalize',
    fontSize: 12,
  },
  eventImpactLabel: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  eventTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  eventDescription: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    lineHeight: 18,
  },
  stopRowPressed: {
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  stopRowCanceled: {
    opacity: 0.72,
  },
});

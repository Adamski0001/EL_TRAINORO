import stationFallback from '../assets/mock_api/trainstation.sample.json';

declare const __DEV__: boolean | undefined;
const IS_DEV = typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';

const TRAFIKVERKET_ENDPOINT = 'https://api.trafikinfo.trafikverket.se/v2/data.json';
const TRAIN_POSITION_BODY = `<?xml version="1.0" encoding="UTF-8"?>
<REQUEST>
  <LOGIN authenticationkey="%API_KEY%" />
  <QUERY objecttype="TrainPosition" schemaversion="1.1" namespace="järnväg.trafikinfo">
    <FILTER>
      <EQ name="Deleted" value="false" />
      <EQ name="Status.Active" value="true" />
    </FILTER>
  </QUERY>
</REQUEST>`;

type XmlNode = Record<string, unknown>;

type TrainStationMetadata = {
  LocationSignature?: string;
  AdvertisedLocationName?: string;
  AdvertisedShortLocationName?: string;
  OfficialLocationName?: string;
};

export type StationLookup = Record<string, string>;

const buildStationLookup = (entries: TrainStationMetadata[]): StationLookup =>
  entries.reduce<StationLookup>((acc, entry) => {
    const signature = (entry.LocationSignature ?? '').trim();
    if (!signature) {
      return acc;
    }
    const preferredName =
      (entry.AdvertisedLocationName ?? '').trim() ||
      (entry.OfficialLocationName ?? '').trim() ||
      (entry.AdvertisedShortLocationName ?? '').trim() ||
      signature;
    acc[signature] = preferredName;
    return acc;
  }, {});

const TRAIN_STATION_BODY = `<?xml version="1.0" encoding="UTF-8"?>
<REQUEST>
  <LOGIN authenticationkey="%API_KEY%" />
  <QUERY objecttype="TrainStation" schemaversion="1.5" namespace="rail.infrastructure" limit="4000">
    <FILTER>
      <EQ name="Deleted" value="false" />
    </FILTER>
    <INCLUDE>LocationSignature</INCLUDE>
    <INCLUDE>AdvertisedLocationName</INCLUDE>
    <INCLUDE>AdvertisedShortLocationName</INCLUDE>
    <INCLUDE>OfficialLocationName</INCLUDE>
  </QUERY>
</REQUEST>`;

const fallbackStationLookup = buildStationLookup((stationFallback as TrainStationMetadata[]) ?? []);

let stationLookupCache: StationLookup | null = null;
let stationLookupPromise: Promise<StationLookup> | null = null;

const ensureArray = <T,>(value: T | T[] | undefined | null): T[] => {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
};

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const parseNumber = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const parseBoolean = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') {
      return true;
    }
    if (normalized === 'false' || normalized === '0') {
      return false;
    }
  }
  if (typeof value === 'number') {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
  }
  return null;
};

const chunkArray = <T,>(items: T[], chunkSize: number): T[][] => {
  if (chunkSize <= 0) {
    return [items];
  }
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    result.push(items.slice(i, i + chunkSize));
  }
  return result;
};

const pickRecordNode = (value: unknown): XmlNode | null => {
  if (!value) {
    return null;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const node = pickRecordNode(entry);
      if (node) {
        return node;
      }
    }
    return null;
  }
  return typeof value === 'object' ? (value as XmlNode) : null;
};

const pickStringValue = (value: unknown): string | null => {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const str = pickStringValue(entry);
      if (str) {
        return str;
      }
    }
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : null;
  }
  return null;
};

const pickNumberValue = (value: unknown): number | null => {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const parsed = pickNumberValue(entry);
      if (parsed !== null) {
        return parsed;
      }
    }
    return null;
  }
  return parseNumber(value);
};

const parseWktPoint = (value: unknown): [number, number] | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const match = value
    .trim()
    .match(/POINT(?:\s+Z)?\s*\(\s*([-+0-9.,Ee]+)\s+([-+0-9.,Ee]+)\s*\)/i);

  if (!match) {
    return null;
  }

  const lon = parseNumber(match[1]?.replace(',', '.'));
  const lat = parseNumber(match[2]?.replace(',', '.'));

  if (lon === null || lat === null) {
    return null;
  }

  return [lon, lat];
};

const collectCoordinateNodes = (
  entry: XmlNode,
): { nodes: XmlNode[]; positionNode: XmlNode | null; coordinateNode: XmlNode | null } => {
  const nodes: XmlNode[] = [entry];
  const pushNode = (node: XmlNode | null | undefined) => {
    if (node) {
      nodes.push(node);
    }
  };

  const positionNode = pickRecordNode(entry?.Position);
  pushNode(positionNode);

  const coordinateNode = pickRecordNode(positionNode?.Coordinate) ?? pickRecordNode(entry?.Coordinate);
  pushNode(coordinateNode);

  const entryGeometry = pickRecordNode(entry?.Geometry);
  pushNode(entryGeometry);

  const positionGeometry = pickRecordNode(positionNode?.Geometry);
  pushNode(positionGeometry);

  const coordinateGeometry = pickRecordNode(coordinateNode?.Geometry);
  pushNode(coordinateGeometry);

  return { nodes, positionNode, coordinateNode };
};

const resolveCoordinates = (entry: XmlNode): { latitude: number; longitude: number } | null => {
  const { nodes } = collectCoordinateNodes(entry);

  const findPointFromKeys = (keys: string[]): { latitude: number; longitude: number } | null => {
    for (const node of nodes) {
      for (const key of keys) {
        const wkt = pickStringValue(node[key]);
        if (!wkt) {
          continue;
        }
        const parsed = parseWktPoint(wkt);
        if (parsed) {
          const [longitude, latitude] = parsed;
          return { latitude, longitude };
        }
      }
    }
    return null;
  };

  const findNumberFromKeys = (keys: string[]): number | null => {
    for (const node of nodes) {
      for (const key of keys) {
        const value = pickNumberValue(node[key]);
        if (value !== null) {
          return value;
        }
      }
    }
    return null;
  };

  const wgs84 = findPointFromKeys(['WGS84', 'Geometry.WGS84', 'Coordinate.WGS84']);
  if (wgs84) {
    return wgs84;
  }

  const latitude = findNumberFromKeys(['Latitude', 'Lat', 'Coordinate.Latitude']);
  const longitude = findNumberFromKeys(['Longitude', 'Lon', 'Coordinate.Longitude']);
  if (latitude !== null && longitude !== null) {
    return { latitude, longitude };
  }

  const x = findNumberFromKeys(['X', 'Coordinate.X']);
  const y = findNumberFromKeys(['Y', 'Coordinate.Y']);
  if (x !== null && y !== null) {
    return { latitude: y, longitude: x };
  }

  const sweref = findPointFromKeys(['SWEREF99TM', 'Geometry.SWEREF99TM', 'Coordinate.SWEREF99TM']);
  if (sweref) {
    return sweref;
  }

  return null;
};

const mapLocationRefs = (value: unknown): AnnouncementLocationRef[] =>
  ensureArray(value as XmlNode | XmlNode[])
    .map(item => {
      const name = (item?.LocationName as string) ?? null;
      if (!name) {
        return null;
      }
      return {
        name,
        order: parseNumber(item?.Order),
        priority: parseNumber(item?.Priority),
      };
    })
    .filter((item): item is AnnouncementLocationRef => Boolean(item))
    .sort((a, b) => {
      const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      const priorityA = a.priority ?? Number.MAX_SAFE_INTEGER;
      const priorityB = b.priority ?? Number.MAX_SAFE_INTEGER;
      return priorityA - priorityB;
    });

const pickProductDescription = (value: unknown): string | null => {
  const items = ensureArray(value as XmlNode | XmlNode[]);
  for (const item of items) {
    const description = (item?.Description as string) ?? null;
    if (description) {
      return description;
    }
  }
  return null;
};

const collectDeviationDescriptions = (value: unknown): string[] =>
  ensureArray(value as XmlNode | XmlNode[])
    .map(item => ((item?.Description as string) ?? '').trim())
    .filter(description => description.length > 0);

const resolveApiKey = (): string => {
  const globalObj = globalThis as Record<string, any> | undefined;
  const manifestExtra =
    globalObj?.ExpoConfig?.extra ??
    globalObj?.expoConfig?.extra ??
    globalObj?.ExpoConstants?.manifest2?.extra ??
    globalObj?.ExpoConstants?.manifest?.extra ??
    undefined;

  const apiKey =
    process.env.TRAFIKVERKET_API_KEY ??
    process.env.EXPO_PUBLIC_TRAFIKVERKET_API_KEY ??
    manifestExtra?.trafikverketApiKey;

  if (!apiKey) {
    throw new Error('TRAFIKVERKET_API_KEY saknas. Lägg till den i .env och starta om appen.');
  }

  return apiKey;
};

const sendTrafikverketRequest = async (body: string, signal?: AbortSignal) => {
  const apiKey = resolveApiKey();
  const payload = body.replace('%API_KEY%', apiKey);

  const response = await fetch(TRAFIKVERKET_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml' },
    body: payload,
    signal,
  });

  const text = await response.text();
  if (!response.ok) {
    console.error('[Trafikverket] Request failed', {
      status: response.status,
      statusText: response.statusText,
      body: text,
    });
    throw new Error(`Trafikverket API-svar ${response.status}: ${text.slice(0, 200)}`);
  }
  return text;
};

const parseApiResponse = (payload: string, objectType: string): XmlNode[] => {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    console.error('[Trafikverket] Failed to parse API response as JSON', {
      snippet: payload.slice(0, 200),
      error,
    });
    throw new Error('Trafikverket-svaret kunde inte tolkas.');
  }

  const response = (parsed?.RESPONSE ?? {}) as Record<string, unknown>;
  const resultEntries = ensureArray(response.RESULT as Record<string, unknown> | Record<string, unknown>[]);

  if (IS_DEV && objectType === 'TrainPosition') {
    console.log('[Trafikverket][Diag] Parsed RESULT payload', {
      total: resultEntries.length,
      sample: resultEntries.slice(0, 1),
    });
  }

  const errors: string[] = [];
  const collectError = (node: unknown) => {
    const arr = ensureArray(node as XmlNode | XmlNode[]);
    arr.forEach(entry => {
      if (!entry) {
        return;
      }
      if (typeof entry === 'string') {
        errors.push(entry);
        return;
      }
      const source = (entry?.SOURCE as string) ?? '';
      const message = (entry?.MESSAGE as string) ?? (entry?._ as string) ?? '';
      if (source || message) {
        errors.push([source, message].filter(Boolean).join(': ').trim());
      }
    });
  };

  if (response.ERROR) {
    collectError(response.ERROR);
  }

  resultEntries.forEach(entry => {
    if (entry && 'ERROR' in entry) {
      collectError((entry as XmlNode).ERROR);
    }
  });

  if (errors.length) {
    console.error('[Trafikverket] Response contained errors', {
      objectType,
      errors,
      snippet: payload.slice(0, 500),
    });
    throw new Error(`Trafikverket API-fel: ${errors.join('; ')}`);
  }

  const records: XmlNode[] = [];
  resultEntries.forEach(entry => {
    const typedEntry = entry as Record<string, unknown>;
    if (!typedEntry) {
      return;
    }
    const rows = ensureArray(typedEntry[objectType] as XmlNode | XmlNode[]);
    records.push(...rows);
  });

  if (!records.length) {
    console.warn(
      `[Trafikverket] API response for ${objectType} returned 0 records. Snippet: ${payload.slice(0, 200)}`,
    );
  }

  return records;
};

const fetchTrainStationsFromApi = async () => {
  const xml = await sendTrafikverketRequest(TRAIN_STATION_BODY);
  const records = parseApiResponse(xml, 'TrainStation');
  return records.map(entry => ({
    LocationSignature: (entry?.LocationSignature as string) ?? undefined,
    AdvertisedLocationName: (entry?.AdvertisedLocationName as string) ?? undefined,
    AdvertisedShortLocationName: (entry?.AdvertisedShortLocationName as string) ?? undefined,
    OfficialLocationName: (entry?.OfficialLocationName as string) ?? undefined,
  }));
};

export const fetchStationLookup = async (options: { forceRefresh?: boolean } = {}) => {
  const { forceRefresh = false } = options;

  if (!forceRefresh && stationLookupCache) {
    return stationLookupCache;
  }
  if (!forceRefresh && stationLookupPromise) {
    return stationLookupPromise;
  }

  const loadStations = async () => {
    try {
      const payload = await fetchTrainStationsFromApi();
      const lookup = buildStationLookup(payload);
      if (!Object.keys(lookup).length) {
        throw new Error('Stationslistan var tom.');
      }
      stationLookupCache = lookup;
      return lookup;
    } catch (error) {
      console.warn('[TrainStations] Stationsmetadata kunde inte hämtas, använder fallback-data.', error);
      stationLookupCache = fallbackStationLookup;
      return fallbackStationLookup;
    } finally {
      stationLookupPromise = null;
    }
  };

  const request = loadStations();
  if (!forceRefresh) {
    stationLookupPromise = request;
  }
  return request;
};

export type TrainPositionApiEntry = {
  operationalTrainNumber: string | null;
  advertisedTrainIdent: string | null;
  trainOwner: string | null;
  bearing: number | null;
  speed: number | null;
  x: number | null;
  y: number | null;
  latitude: number | null;
  longitude: number | null;
  timeStamp: string | null;
  modifiedTime: string | null;
};

type AnnouncementLocationRef = {
  name: string;
  order: number | null;
  priority: number | null;
};

export type TrainAnnouncementApiEntry = {
  advertisedTrainIdent: string | null;
  operationalTrainNumber: string | null;
  locationSignature: string | null;
  advertisedLocationName: string | null;
  activityType: string | null;
  advertisedTimeAtLocation: string | null;
  estimatedTimeAtLocation: string | null;
  timeAtLocation: string | null;
  trackAtLocation: string | null;
  canceled: boolean;
  operator: string | null;
  productInformation: string | null;
  trainOwner: string | null;
  informationOwner: string | null;
  fromLocations: AnnouncementLocationRef[];
  toLocations: AnnouncementLocationRef[];
  viaToLocations: AnnouncementLocationRef[];
  deviationTexts: string[];
  modifiedTime: string | null;
};

type TrainIdentifierFilter = {
  advertisedTrainIdent?: string | null;
  operationalTrainNumber?: string | null;
};

const STATIONARY_SPEED_THRESHOLD = 0.5;
const STATIONARY_DURATION_MS = 15 * 60_000;
const MAX_POSITION_AGE_MS = 60 * 60_000;

const mapTrainPosition = (entry: XmlNode): TrainPositionApiEntry => {
  const trainNode = pickRecordNode(entry?.Train);
  const operationalTrainNumber =
    pickStringValue(trainNode?.OperationalTrainNumber) ??
    pickStringValue(entry?.OperationalTrainNumber) ??
    pickStringValue(trainNode?.TrainNumber) ??
    pickStringValue(entry?.TrainNumber) ??
    null;
  const advertisedTrainIdent =
    pickStringValue(trainNode?.AdvertisedTrainIdent) ??
    pickStringValue(trainNode?.AdvertisedTrainNumber) ??
    pickStringValue(entry?.AdvertisedTrainIdent) ??
    pickStringValue(entry?.AdvertisedTrainNumber) ??
    null;
  const trainOwner =
    pickStringValue(entry?.TrainOwner) ?? pickStringValue(trainNode?.TrainOwner) ?? null;
  const bearing = pickNumberValue(entry?.Bearing);
  const speed = pickNumberValue(entry?.Speed);
  const timeStamp = pickStringValue(entry?.TimeStamp);
  const modifiedTime = pickStringValue(entry?.ModifiedTime);

  const { positionNode, coordinateNode } = collectCoordinateNodes(entry);
  const coordinate = resolveCoordinates(entry);
  const x = pickNumberValue(positionNode?.X ?? coordinateNode?.X);
  const y = pickNumberValue(positionNode?.Y ?? coordinateNode?.Y);
  const latitude = coordinate?.latitude ?? null;
  const longitude = coordinate?.longitude ?? null;

  return {
    operationalTrainNumber,
    advertisedTrainIdent,
    trainOwner,
    bearing,
    speed,
    x,
    y,
    latitude,
    longitude,
    timeStamp,
    modifiedTime,
  };
};

const parseTimestamp = (value: string | null): number | null => {
  if (!value) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
};

const shouldIncludeTrainPosition = (entry: TrainPositionApiEntry): boolean => {
  const advertisedIdent = (entry.advertisedTrainIdent ?? '').trim();
  if (!advertisedIdent) {
    return false;
  }

  const updatedAtMs = parseTimestamp(entry.modifiedTime ?? entry.timeStamp);
  const ageMs = updatedAtMs !== null ? Date.now() - updatedAtMs : null;
  if (ageMs !== null && ageMs > MAX_POSITION_AGE_MS) {
    return false;
  }

  const speed = entry.speed ?? null;
  const isStationary = speed === null || speed <= STATIONARY_SPEED_THRESHOLD;
  if (isStationary && ageMs !== null && ageMs > STATIONARY_DURATION_MS) {
    return false;
  }

  return true;
};

const TRAIN_ANNOUNCEMENT_INCLUDES = [
  'AdvertisedTrainIdent',
  'OperationalTrainNumber',
  'LocationSignature',
  'ActivityType',
  'AdvertisedTimeAtLocation',
  'EstimatedTimeAtLocation',
  'TimeAtLocation',
  'TrackAtLocation',
  'Canceled',
  'Operator',
  'ProductInformation',
  'TrainOwner',
  'InformationOwner',
  'FromLocation',
  'ToLocation',
  'ViaToLocation',
  'Deviation',
  'ModifiedTime',
];

const formatDateComponent = (value: number) => String(value).padStart(2, '0');

const resolveDailyBounds = (targetDate?: Date | string | null) => {
  const base = targetDate ? new Date(targetDate) : new Date();
  const startDate = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 1);

  const format = (date: Date) =>
    `${date.getFullYear()}-${formatDateComponent(date.getMonth() + 1)}-${formatDateComponent(date.getDate())}`;

  return {
    start: `${format(startDate)}T00:00:00`,
    end: `${format(endDate)}T00:00:00`,
  };
};

const buildTrainAnnouncementQuery = (options: {
  advertisedTrainIdent?: string | null;
  operationalTrainNumber?: string | null;
  windowMinutes?: number;
  limit?: number;
  targetDate?: Date | string | null;
  allowEmptyFilter?: boolean;
  trainFilters?: TrainIdentifierFilter[];
  includeFields?: string[];
}) => {
  const {
    advertisedTrainIdent,
    operationalTrainNumber,
    windowMinutes,
    limit = 160,
    targetDate = null,
    allowEmptyFilter = false,
    trainFilters = [],
  } = options;
  const includeFields = options.includeFields && options.includeFields.length > 0 ? options.includeFields : null;

  const normalizedFilters: TrainIdentifierFilter[] = [];
  const pushFilter = (filter: TrainIdentifierFilter | null | undefined) => {
    if (!filter) {
      return;
    }
    const normalizedAdvertised = (filter.advertisedTrainIdent ?? '').trim();
    const normalizedOperational = (filter.operationalTrainNumber ?? '').trim();
    if (!normalizedAdvertised && !normalizedOperational) {
      return;
    }
    normalizedFilters.push({
      advertisedTrainIdent: normalizedAdvertised || undefined,
      operationalTrainNumber: normalizedOperational || undefined,
    });
  };

  trainFilters.forEach(pushFilter);
  pushFilter({ advertisedTrainIdent, operationalTrainNumber });

  if (!normalizedFilters.length && !allowEmptyFilter) {
    throw new Error('En tågidentitet krävs för att läsa detaljer.');
  }

  let start: string;
  let end: string;
  if (windowMinutes && windowMinutes > 0) {
    const windowMs = Math.max(windowMinutes, 30) * 60 * 1000;
    const now = Date.now();
    start = new Date(now - windowMs).toISOString();
    end = new Date(now + windowMs).toISOString();
  } else {
    const bounds = resolveDailyBounds(targetDate);
    start = bounds.start;
    end = bounds.end;
  }

  const idFilters: string[] = normalizedFilters
    .map(filter => {
      const clauses: string[] = [];
      if (filter.advertisedTrainIdent) {
        clauses.push(`<EQ name="AdvertisedTrainIdent" value="${escapeXml(filter.advertisedTrainIdent)}" />`);
      }
      if (filter.operationalTrainNumber) {
        clauses.push(`<EQ name="OperationalTrainNumber" value="${escapeXml(filter.operationalTrainNumber)}" />`);
      }
      if (clauses.length === 0) {
        return null;
      }
      if (clauses.length === 1) {
        return clauses[0];
      }
      return `<AND>${clauses.join('')}</AND>`;
    })
    .filter((entry): entry is string => Boolean(entry));

  const identifierFilter =
    idFilters.length > 1 ? `<OR>${idFilters.join('')}</OR>` : idFilters.length === 1 ? idFilters[0] : '';

  const filterExpressions = [
    identifierFilter,
    '<EQ name="Deleted" value="false" />',
    '<EQ name="Advertised" value="true" />',
    `<GT name="AdvertisedTimeAtLocation" value="${start}" />`,
    `<LT name="AdvertisedTimeAtLocation" value="${end}" />`,
  ].filter(Boolean);

  const filterBody =
    filterExpressions.length === 1 ? filterExpressions[0] : `<AND>${filterExpressions.join('')}</AND>`;

  const fieldsToInclude = includeFields ?? TRAIN_ANNOUNCEMENT_INCLUDES;
  const includes = fieldsToInclude.map(field => `<INCLUDE>${field}</INCLUDE>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<REQUEST>
  <LOGIN authenticationkey="%API_KEY%" />
  <QUERY objecttype="TrainAnnouncement" schemaversion="1.9" limit="${limit}" orderby="AdvertisedTimeAtLocation">
    <FILTER>
      ${filterBody}
    </FILTER>
    ${includes}
  </QUERY>
</REQUEST>`;
};

const mapTrainAnnouncement = (entry: XmlNode): TrainAnnouncementApiEntry => {
  const advertisedTrainIdent = (entry?.AdvertisedTrainIdent as string) ?? null;
  const operationalTrainNumber = (entry?.OperationalTrainNumber as string) ?? null;
  const locationSignature = (entry?.LocationSignature as string) ?? null;
  const advertisedLocationName = (entry?.AdvertisedLocationName as string) ?? null;
  const activityType = (entry?.ActivityType as string) ?? null;
  const advertisedTimeAtLocation = (entry?.AdvertisedTimeAtLocation as string) ?? null;
  const estimatedTimeAtLocation = (entry?.EstimatedTimeAtLocation as string) ?? null;
  const timeAtLocation = (entry?.TimeAtLocation as string) ?? null;
  const trackAtLocation = (entry?.TrackAtLocation as string) ?? null;
  const canceled = Boolean(parseBoolean(entry?.Canceled));
  const operator = (entry?.Operator as string) ?? null;
  const productInformation = pickProductDescription(entry?.ProductInformation);
  const trainOwner = (entry?.TrainOwner as string) ?? null;
  const informationOwner = (entry?.InformationOwner as string) ?? null;
  const fromLocations = mapLocationRefs(entry?.FromLocation);
  const toLocations = mapLocationRefs(entry?.ToLocation);
  const viaToLocations = mapLocationRefs(entry?.ViaToLocation);
  const deviationTexts = collectDeviationDescriptions(entry?.Deviation);
  const modifiedTime = (entry?.ModifiedTime as string) ?? null;
  return {
    advertisedTrainIdent,
    operationalTrainNumber,
    locationSignature,
    advertisedLocationName,
    activityType,
    advertisedTimeAtLocation,
    estimatedTimeAtLocation,
    timeAtLocation,
    trackAtLocation,
    canceled,
    operator,
    productInformation,
    trainOwner,
    informationOwner,
    fromLocations,
    toLocations,
    viaToLocations,
    deviationTexts,
    modifiedTime,
  };
};

export async function fetchTrainPositions(options: { signal?: AbortSignal } = {}) {
  const payload = await sendTrafikverketRequest(TRAIN_POSITION_BODY, options.signal);
  if (IS_DEV) {
    console.log('[Trafikverket][Diag] TrainPosition raw payload snippet', payload.slice(0, 500));
  }
  const records = parseApiResponse(payload, 'TrainPosition');
  return records.map(mapTrainPosition).filter(shouldIncludeTrainPosition);
}

export async function fetchTrainAnnouncements(
  options: {
    advertisedTrainIdent?: string | null;
    operationalTrainNumber?: string | null;
    windowMinutes?: number;
    signal?: AbortSignal;
    limit?: number;
    targetDate?: Date | string | null;
  } = {},
) {
  const xml = await sendTrafikverketRequest(buildTrainAnnouncementQuery(options), options.signal);
  const records = parseApiResponse(xml, 'TrainAnnouncement');
  return records.map(mapTrainAnnouncement);
}

const ROUTE_BATCH_SIZE = 40;

export async function fetchTrainAnnouncementsByIdentifiers(
  identifiers: TrainIdentifierFilter[],
  options: {
    windowMinutes?: number;
    perBatchLimit?: number;
    targetDate?: Date | string | null;
    signal?: AbortSignal;
    onChunk?: (records: TrainAnnouncementApiEntry[]) => void;
  } = {},
) {
  const ROUTE_INCLUDES = [
    'AdvertisedTrainIdent',
    'OperationalTrainNumber',
    'LocationSignature',
    'ActivityType',
    'AdvertisedTimeAtLocation',
    'FromLocation',
    'ToLocation',
  ];
  const meaningful = identifiers.filter(
    identifier =>
      Boolean((identifier.advertisedTrainIdent ?? '').trim()) ||
      Boolean((identifier.operationalTrainNumber ?? '').trim()),
  );

  if (!meaningful.length) {
    return [];
  }

  const chunks = chunkArray(meaningful, ROUTE_BATCH_SIZE);
  const records: TrainAnnouncementApiEntry[] = [];

  for (const chunk of chunks) {
    const limit = options.perBatchLimit ?? Math.max(200, chunk.length * 50);
    const xml = await sendTrafikverketRequest(
      buildTrainAnnouncementQuery({
        windowMinutes: options.windowMinutes ?? 1_440,
        limit,
        targetDate: options.targetDate ?? null,
        trainFilters: chunk,
        includeFields: ROUTE_INCLUDES,
      }),
      options.signal,
    );
    const parsed = parseApiResponse(xml, 'TrainAnnouncement');
    const mapped = parsed.map(mapTrainAnnouncement);
    records.push(...mapped);
    options.onChunk?.(mapped);
  }

  return records;
}

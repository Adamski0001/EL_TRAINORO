const http = require('node:http');
const { parse: parseUrl } = require('node:url');
const { parseStringPromise } = require('xml2js');

const PORT = process.env.PORT || 3001;
const TRAFIKVERKET_ENDPOINT = 'https://api.trafikinfo.trafikverket.se/v2/data.xml';
const STATION_LOOKAHEAD_HOURS = 48;
const STATION_PAST_GRACE_MINUTES = 15;
const STATION_QUERY_LIMIT = 400;

const ensureArray = value => {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null) {
    return [];
  }
  return [value];
};

const pickString = value => {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const str = pickString(entry);
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
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
};

const pickBoolean = value => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }
  return null;
};

const pickNumber = value => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const escapeXml = value =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const buildRequestBody = (signature, apiKey) => {
  const now = Date.now();
  const windowStartIso = new Date(now - STATION_PAST_GRACE_MINUTES * 60 * 1000).toISOString();
  const windowEndIso = new Date(now + STATION_LOOKAHEAD_HOURS * 60 * 60 * 1000).toISOString();

  return `<?xml version="1.0" encoding="UTF-8"?>
<REQUEST>
  <LOGIN authenticationkey="${escapeXml(apiKey)}" />
  <QUERY objecttype="TrainAnnouncement" schemaversion="1.9" orderby="AdvertisedTimeAtLocation" limit="${STATION_QUERY_LIMIT}">
    <FILTER>
      <AND>
        <EQ name="LocationSignature" value="${escapeXml(signature)}" />
        <GT name="AdvertisedTimeAtLocation" value="${escapeXml(windowStartIso)}" />
        <LT name="AdvertisedTimeAtLocation" value="${escapeXml(windowEndIso)}" />
      </AND>
    </FILTER>

    <INCLUDE>AdvertisedTrainIdent</INCLUDE>
    <INCLUDE>OperationalTrainNumber</INCLUDE>
    <INCLUDE>ProductInformation</INCLUDE>
    <INCLUDE>FromLocation</INCLUDE>
    <INCLUDE>ToLocation</INCLUDE>
    <INCLUDE>ActivityType</INCLUDE>
    <INCLUDE>AdvertisedTimeAtLocation</INCLUDE>
    <INCLUDE>EstimatedTimeAtLocation</INCLUDE>
    <INCLUDE>TimeAtLocation</INCLUDE>
    <INCLUDE>TrackAtLocation</INCLUDE>
    <INCLUDE>Deviation</INCLUDE>
    <INCLUDE>Canceled</INCLUDE>
    <INCLUDE>OtherInformation</INCLUDE>
  </QUERY>
</REQUEST>`;

const sortLocations = locations =>
  [...locations].sort((a, b) => {
    const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
    const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    const priorityA = a.priority ?? Number.MAX_SAFE_INTEGER;
    const priorityB = b.priority ?? Number.MAX_SAFE_INTEGER;
    return priorityA - priorityB;
  });

const mapLocations = value =>
  sortLocations(
    ensureArray(value).map(entry => ({
      name: pickString(entry?.LocationName),
      priority: pickNumber(entry?.Priority),
      order: pickNumber(entry?.Order),
    })),
  )
    .map(entry => entry.name)
    .filter(Boolean);

const mapDeviation = value =>
  ensureArray(value)
    .map(entry => pickString(entry?.Description))
    .filter(Boolean);

const mapProductInformation = value =>
  ensureArray(value)
    .map(entry => pickString(entry?.Description))
    .filter(Boolean);

const normalizeActivity = value => {
  const normalized = (pickString(value) ?? '').toLowerCase();
  if (normalized === 'arrival') return 'Arrival';
  if (normalized === 'departure') return 'Departure';
  return null;
};

const mapAnnouncement = record => {
  const activityType = normalizeActivity(record?.ActivityType);
  if (!activityType) {
    return null;
  }
  const productInformation = mapProductInformation(record?.ProductInformation);
  return {
    advertisedTrainIdent: pickString(record?.AdvertisedTrainIdent),
    operationalTrainNumber: pickString(record?.OperationalTrainNumber),
    fromLocation: mapLocations(record?.FromLocation),
    toLocation: mapLocations(record?.ToLocation),
    activityType,
    advertisedTimeAtLocation: pickString(record?.AdvertisedTimeAtLocation),
    estimatedTimeAtLocation: pickString(record?.EstimatedTimeAtLocation),
    timeAtLocation: pickString(record?.TimeAtLocation),
    trackAtLocation: pickString(record?.TrackAtLocation),
    canceled: pickBoolean(record?.Canceled) ?? false,
    deviation: mapDeviation(record?.Deviation),
    productInformation,
    operator: productInformation[0] ?? null,
  };
};

const fetchAnnouncementsForStation = async signature => {
  const apiKey =
    process.env.TRAFIKVERKET_API_KEY || process.env.EXPO_PUBLIC_TRAFIKVERKET_API_KEY;
  if (!apiKey) {
    throw new Error('TRAFIKVERKET_API_KEY saknas');
  }

  const body = buildRequestBody(signature, apiKey);
  const response = await fetch(TRAFIKVERKET_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml' },
    body,
  });

  const payload = await response.text();
  if (!response.ok) {
    throw new Error(`Trafikverket svarade med ${response.status}: ${payload.slice(0, 200)}`);
  }

  const parsed = await parseStringPromise(payload);
  const resultNodes = ensureArray(parsed?.RESPONSE?.RESULT);
  const announcements = [];
  resultNodes.forEach(result => {
    ensureArray(result?.TrainAnnouncement).forEach(entry => {
      const mapped = mapAnnouncement(entry);
      if (mapped) {
        announcements.push(mapped);
      }
    });
  });
  return announcements;
};

const sortByAdvertisedTime = (a, b) => {
  const timeA = Date.parse(a.advertisedTimeAtLocation ?? '') || Number.MAX_SAFE_INTEGER;
  const timeB = Date.parse(b.advertisedTimeAtLocation ?? '') || Number.MAX_SAFE_INTEGER;
  return timeA - timeB;
};

const sendJson = (res, statusCode, payload) => {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
};

const handleStationRequest = async (signature, res) => {
  try {
    if (!signature) {
      sendJson(res, 400, { error: 'Station signature is required' });
      return;
    }
    const announcements = await fetchAnnouncementsForStation(signature);
    const arrivals = announcements
      .filter(item => item.activityType === 'Arrival')
      .sort(sortByAdvertisedTime);
    const departures = announcements
      .filter(item => item.activityType === 'Departure')
      .sort(sortByAdvertisedTime);

    sendJson(res, 200, {
      station: signature,
      arrivals,
      departures,
    });
  } catch (error) {
    console.error('[Station API] Failed to fetch station data', { signature, error });
    sendJson(res, 500, { error: error.message || 'Internal server error' });
  }
};

const server = http.createServer((req, res) => {
  const { pathname } = parseUrl(req.url || '', true);
  if (!pathname) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  if (req.method === 'GET' && pathname.startsWith('/api/station/')) {
    const signature = decodeURIComponent(pathname.replace('/api/station/', '')).trim();
    void handleStationRequest(signature, res);
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    });
    res.end();
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Station API listening on port ${PORT}`);
  });
}

module.exports = server;

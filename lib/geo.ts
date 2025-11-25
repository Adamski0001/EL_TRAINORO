export type Coordinates = {
  latitude: number;
  longitude: number;
};

const EARTH_RADIUS_KM = 6_371;

const toRadians = (value: number) => (value * Math.PI) / 180;

export const haversineDistance = (a: Coordinates, b: Coordinates) => {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const haversine = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(haversine));
};

export const formatDistanceLabel = (kilometers: number): string => {
  if (kilometers >= 1) {
    const digits = kilometers >= 10 ? 0 : 1;
    const formatter = new Intl.NumberFormat('sv-SE', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    return `${formatter.format(kilometers)} km bort`;
  }
  const meters = Math.max(1, Math.round(kilometers * 1_000));
  return `${meters} m bort`;
};

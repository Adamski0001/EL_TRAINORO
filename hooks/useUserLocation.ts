import { useCallback, useEffect, useRef, useState } from 'react';

import * as Location from 'expo-location';
import type { LocationObject, LocationSubscription } from 'expo-location';

type Coordinates = {
  latitude: number;
  longitude: number;
};

type UseUserLocationOptions = {
  active?: boolean;
};

export type UserLocationState = {
  coords: Coordinates | null;
  permissionStatus: Location.PermissionStatus;
  canAskAgain: boolean;
  requestPermission: () => Promise<void>;
  loading: boolean;
  error: string | null;
};

const toCoordinates = (location: LocationObject | null | undefined): Coordinates | null => {
  if (!location) {
    return null;
  }
  const { latitude, longitude } = location.coords;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return null;
  }
  return { latitude, longitude };
};

export function useUserLocation(options: UseUserLocationOptions = {}): UserLocationState {
  const { active = true } = options;
  const [coords, setCoords] = useState<Coordinates | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<Location.PermissionStatus>(
    Location.PermissionStatus.UNDETERMINED,
  );
  const [canAskAgain, setCanAskAgain] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const watcherRef = useRef<LocationSubscription | null>(null);

  const updatePermission = useCallback((status: Location.PermissionStatus, canRequest: boolean) => {
    setPermissionStatus(status);
    setCanAskAgain(canRequest);
  }, []);

  const fetchCurrentLocation = useCallback(async () => {
    try {
      const lastKnown = await Location.getLastKnownPositionAsync();
      const candidate = toCoordinates(lastKnown);
      if (candidate) {
        setCoords(candidate);
        return;
      }
      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const next = toCoordinates(current);
      if (next) {
        setCoords(next);
      }
    } catch (fetchError) {
      console.warn('[useUserLocation] Failed to fetch current position', fetchError);
      setError('Kunde inte hämta din plats.');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const syncPermission = async () => {
      try {
        const response = await Location.getForegroundPermissionsAsync();
        if (cancelled) {
          return;
        }
        updatePermission(response.status, response.canAskAgain ?? false);
        if (response.status === Location.PermissionStatus.GRANTED) {
          const lastKnown = toCoordinates(await Location.getLastKnownPositionAsync());
          if (lastKnown && !cancelled) {
            setCoords(lastKnown);
          }
        }
      } catch (statusError) {
        if (!cancelled) {
          console.warn('[useUserLocation] Permission status check failed', statusError);
          setError('Kunde inte läsa platsbehörighet.');
        }
      }
    };
    syncPermission();
    return () => {
      cancelled = true;
    };
  }, [updatePermission]);

  const requestPermission = useCallback(async () => {
    if (loading) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await Location.requestForegroundPermissionsAsync();
      updatePermission(response.status, response.canAskAgain ?? false);
      if (response.status === Location.PermissionStatus.GRANTED) {
        await fetchCurrentLocation();
      }
    } catch (requestError) {
      console.warn('[useUserLocation] Permission request failed', requestError);
      setError('Kunde inte begära platsbehörighet.');
    } finally {
      setLoading(false);
    }
  }, [fetchCurrentLocation, loading, updatePermission]);

  useEffect(() => {
    if (permissionStatus === Location.PermissionStatus.GRANTED && !coords) {
      void fetchCurrentLocation();
    }
  }, [coords, fetchCurrentLocation, permissionStatus]);

  useEffect(() => {
    let cancelled = false;
    if (!active || permissionStatus !== Location.PermissionStatus.GRANTED) {
      watcherRef.current?.remove();
      watcherRef.current = null;
      return () => {
        cancelled = true;
      };
    }
    const startWatching = async () => {
      try {
        watcherRef.current = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            distanceInterval: 500,
            timeInterval: 30_000,
          },
          location => {
            if (cancelled) {
              return;
            }
            const next = toCoordinates(location);
            if (next) {
              setCoords(next);
            }
          },
        );
      } catch (watchError) {
        if (!cancelled) {
          console.warn('[useUserLocation] Failed to start watcher', watchError);
          setError('Kunde inte dela din plats.');
        }
      }
    };
    startWatching();
    return () => {
      cancelled = true;
      watcherRef.current?.remove();
      watcherRef.current = null;
    };
  }, [active, permissionStatus]);

  return {
    coords,
    permissionStatus,
    canAskAgain,
    requestPermission,
    loading,
    error,
  };
}

import { useCallback, useEffect, useState } from 'react';

import * as Notifications from 'expo-notifications';

export function useNotificationPermission() {
  const [status, setStatus] = useState<Notifications.PermissionStatus>(Notifications.PermissionStatus.UNDETERMINED);
  const [canAskAgain, setCanAskAgain] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Notifications.getPermissionsAsync()
      .then(result => {
        if (!cancelled) {
          setStatus(result.status);
          setCanAskAgain(result.canAskAgain ?? true);
        }
      })
      .catch(error => console.warn('[Notifications] status failed', error));
    return () => {
      cancelled = true;
    };
  }, []);

  const request = useCallback(async () => {
    try {
      const result = await Notifications.requestPermissionsAsync();
      setStatus(result.status);
      setCanAskAgain(result.canAskAgain ?? false);
      return result.status === Notifications.PermissionStatus.GRANTED;
    } catch (error) {
      console.warn('[Notifications] request failed', error);
      return false;
    }
  }, []);

  return { status, canAskAgain, request };
}

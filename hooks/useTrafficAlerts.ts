import { useEffect, useRef, useState } from 'react';

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { fetchNotificationCopy, ensureClientId, type TrafficEventAiSummary } from '../lib/trafficAiService';
import { computeEventDistance } from '../lib/trafficEventUtils';
import type { Coordinates } from '../lib/geo';
import type { TrafficEvent } from '../types/traffic';

const NOTIFIED_EVENTS_KEY = '@trainar/notified-events';
const DEFAULT_DISTANCE_THRESHOLD_KM = 25;

export function useTrafficAlerts(options: {
  events: TrafficEvent[];
  userCoords: Coordinates | null;
  permissionStatus: Notifications.PermissionStatus | 'undetermined';
  summaries: Record<string, TrafficEventAiSummary>;
  distanceThresholdKm?: number;
}) {
  const { events, userCoords, permissionStatus, summaries, distanceThresholdKm = DEFAULT_DISTANCE_THRESHOLD_KM } = options;
  const [clientId, setClientId] = useState<string | null>(null);
  const [storeReady, setStoreReady] = useState(false);
  const sentRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    ensureClientId().then(setClientId).catch(error => console.warn('[TrafficAlerts] clientId error', error));
  }, []);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(NOTIFIED_EVENTS_KEY)
      .then(raw => {
        if (raw && !cancelled) {
          const data = JSON.parse(raw) as string[];
          sentRef.current = new Set(data);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setStoreReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (
      !storeReady ||
      permissionStatus !== Notifications.PermissionStatus.GRANTED ||
      !userCoords ||
      !clientId
    ) {
      return;
    }
    events.forEach(event => {
      if (!event?.id || sentRef.current.has(event.id)) {
        return;
      }
      const summary = summaries[event.id];
      if (!summary) {
        return;
      }
      const distance = computeEventDistance(event, userCoords);
      if (distance === null || distance > distanceThresholdKm) {
        return;
      }
      fetchNotificationCopy(event, clientId)
        .then(async copy => {
          if (!copy) {
            return;
          }
          if (copy.alreadySent) {
            sentRef.current.add(event.id);
            await AsyncStorage.setItem(NOTIFIED_EVENTS_KEY, JSON.stringify(Array.from(sentRef.current)));
            return;
          }
          await Notifications.scheduleNotificationAsync({
            content: {
              title: copy.title || summary.notificationTitle,
              body: copy.body || summary.notificationBody,
            },
            trigger:
              Platform.OS === 'android'
                ? { channelId: 'traffic-alerts', seconds: 1 }
                : null,
          });
          sentRef.current.add(event.id);
          await AsyncStorage.setItem(NOTIFIED_EVENTS_KEY, JSON.stringify(Array.from(sentRef.current)));
        })
        .catch(error => console.warn('[TrafficAlerts] notification failed', error));
    });
  }, [storeReady, events, userCoords, permissionStatus, summaries, clientId, distanceThresholdKm]);
}

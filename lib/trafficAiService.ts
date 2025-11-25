import AsyncStorage from '@react-native-async-storage/async-storage';

import type { TrafficEvent } from '../types/traffic';

export type TrafficEventAiSummary = {
  summary: string;
  advice: string;
  notificationTitle: string;
  notificationBody: string;
  generatedAt: string;
  aiGenerated: boolean;
};

export type NotificationCopy = {
  title: string;
  body: string;
  alreadySent: boolean;
};

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';
const SUMMARY_STORAGE_PREFIX = '@trainar/traffic-ai-summary';
const CLIENT_ID_STORAGE_KEY = '@trainar/traffic-ai-client-id';

const memoryCache = new Map<string, TrafficEventAiSummary>();

const buildSummaryKey = (eventId: string) => `${SUMMARY_STORAGE_PREFIX}:${eventId}`;

const serializeEvent = (event: TrafficEvent) => ({
  eventId: event.id,
  title: event.title,
  description: event.description,
  segment: event.segment,
  reasonDescription: event.description,
  severity: event.severity,
  impactLabel: event.impactLabel,
  startTime: event.startTime,
  endTime: event.endTime,
  stations: event.stations ?? [],
});

const readAsyncCache = async (eventId: string) => {
  if (memoryCache.has(eventId)) {
    return memoryCache.get(eventId)!;
  }
  try {
    const raw = await AsyncStorage.getItem(buildSummaryKey(eventId));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as TrafficEventAiSummary;
    memoryCache.set(eventId, parsed);
    return parsed;
  } catch {
    return null;
  }
};

const writeAsyncCache = async (eventId: string, summary: TrafficEventAiSummary) => {
  memoryCache.set(eventId, summary);
  try {
    await AsyncStorage.setItem(buildSummaryKey(eventId), JSON.stringify(summary));
  } catch (error) {
    console.warn('[TrafficAI] Failed to persist summary', error);
  }
};

export const ensureClientId = async () => {
  const existing = await AsyncStorage.getItem(CLIENT_ID_STORAGE_KEY);
  if (existing) {
    return existing;
  }
  const generated = `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await AsyncStorage.setItem(CLIENT_ID_STORAGE_KEY, generated);
  return generated;
};

export const fetchEventSummary = async (
  event: TrafficEvent,
  options: { force?: boolean } = {},
): Promise<TrafficEventAiSummary | null> => {
  if (!API_BASE_URL) {
    return null;
  }
  if (!options.force) {
    const cached = await readAsyncCache(event.id);
    if (cached) {
      return cached;
    }
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/traffic/event-summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: serializeEvent(event), forceRefresh: options.force ?? false }),
    });
    if (!response.ok) {
      console.warn('[TrafficAI] API responded with', response.status);
      return null;
    }
    const json = (await response.json()) as Partial<TrafficEventAiSummary> & Record<string, unknown>;
    if (json?.summary) {
      const adviceText = (json.advice as string) ?? (json.recommendation as string) ?? '';
      const prepared: TrafficEventAiSummary = {
        summary: json.summary,
        advice: adviceText,
        notificationTitle: json.notificationTitle ?? event.title,
        notificationBody: json.notificationBody ?? json.summary,
        generatedAt: json.generatedAt ?? new Date().toISOString(),
        aiGenerated: Boolean(json.aiGenerated),
      };
      await writeAsyncCache(event.id, prepared);
      return prepared;
    }
  } catch (error) {
    console.warn('[TrafficAI] Failed to fetch summary', error);
  }
  return null;
};

export const fetchNotificationCopy = async (
  event: TrafficEvent,
  clientId: string,
): Promise<NotificationCopy | null> => {
  if (!API_BASE_URL) {
    return null;
  }
  try {
    const response = await fetch(`${API_BASE_URL}/api/traffic/notification-copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: serializeEvent(event), clientId }),
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as NotificationCopy;
  } catch (error) {
    console.warn('[TrafficAI] Failed to fetch notification copy', error);
    return null;
  }
};

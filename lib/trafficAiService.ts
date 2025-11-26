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

const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/+$/, '');
const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY ?? '';
const OPENAI_MODEL = process.env.EXPO_PUBLIC_OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_CHAT_URL = (process.env.EXPO_PUBLIC_OPENAI_API_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const SUMMARY_CACHE_VERSION = 'v2';
const SUMMARY_STORAGE_PREFIX = `@trainar/traffic-ai-summary:${SUMMARY_CACHE_VERSION}`;
const CLIENT_ID_STORAGE_KEY = '@trainar/traffic-ai-client-id';

const memoryCache = new Map<string, TrafficEventAiSummary>();

const buildSummaryKey = (eventId: string) => `${SUMMARY_STORAGE_PREFIX}:${eventId}`;

const serializeEvent = (event: TrafficEvent) => ({
  eventId: event.id,
  title: event.title,
  description: event.description,
  segment: event.segment,
  reasonDescription: event.reasonDescription ?? event.description,
  severity: event.severity,
  impactLabel: event.impactLabel,
  startTime: event.startTime,
  endTime: event.endTime,
  stations: event.stations ?? [],
});

type SerializedEvent = ReturnType<typeof serializeEvent>;
type SummaryFields = Partial<TrafficEventAiSummary> & Record<string, unknown>;

const normalizeText = (text: string | null | undefined) =>
  typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';

const buildSummaryDetails = (event: SerializedEvent) => {
  const details: string[] = [];
  if (event.segment) {
    details.push(`Berörd sträcka: ${event.segment}`);
  }
  if (event.impactLabel) {
    details.push(`Bedömd påverkan: ${event.impactLabel}`);
  }
  if (event.startTime) {
    details.push(`Start: ${event.startTime}`);
  }
  if (event.endTime) {
    details.push(`Slut: ${event.endTime}`);
  }
  if (!details.length) {
    details.push('Följ trafikinformationen för senaste läget.');
  }
  return details.map(detail => (/[.!?]$/.test(detail) ? detail : `${detail}.`));
};

const ensureExtendedSummary = (event: SerializedEvent, summary: string, enforce = false) => {
  const normalizedSummary = normalizeText(summary);
  if (!normalizedSummary || !enforce) {
    return normalizedSummary || summary;
  }
  const summaryComparable = normalizedSummary.toLowerCase();
  const descriptionComparable = normalizeText(event.description || event.reasonDescription)?.toLowerCase();
  const sentenceCount = normalizedSummary.split(/[.!?]+/).filter(Boolean).length;
  const needsExtension =
    sentenceCount < 2 || (summaryComparable && descriptionComparable && summaryComparable === descriptionComparable);
  if (!needsExtension) {
    return normalizedSummary;
  }
  const details = buildSummaryDetails(event);
  const trimmed = normalizedSummary.replace(/[.!?]+\s*$/, '');
  return `${trimmed}. ${details.join(' ')}`.trim();
};

const buildPromptMessages = (event: SerializedEvent) => {
  const stationNames = Array.isArray(event.stations)
    ? event.stations
        .map(station => station?.name || station?.signature)
        .filter(Boolean)
        .join(', ')
    : null;
  return [
    {
      role: 'system',
      content:
        'Du är en svensk trafikinformationsassistent. Svara alltid i JSON enligt schema och var kortfattad men konkret.',
    },
    {
      role: 'user',
      content: `Skapa en JSON med fälten "summary", "recommendation", "notificationTitle" och "notificationBody".

Händelse:
- Titel: ${event.title}
- Beskrivning: ${event.description || event.reasonDescription || 'Okänd'}
- Påverkan: ${event.impactLabel || event.severity || 'Okänd'}
- Sträcka/stationer: ${event.segment || stationNames || 'Okänd plats'}
- Start: ${event.startTime || 'Okänd'}
- Slut: ${event.endTime || 'Okänd'}

Krav:
1. summary = 2-3 meningar som ger ny, konkret information (använd egna formuleringar, kopiera inte texten ovan).
2. recommendation = 1 mening med konkret råd till resenärer.
3. notificationTitle = max 45 tecken.
4. notificationBody = 1-2 meningar som kan skickas i en pushnotis.`,
    },
  ];
};

const parseAiContent = (content: string | null | undefined) => {
  if (!content) {
    return null;
  }
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch ? jsonMatch[0] : content) as Record<string, unknown>;
  } catch (error) {
    console.warn('[TrafficAI] Failed to parse AI content', error);
    return null;
  }
};

const normalizeSummary = (event: SerializedEvent, fields: SummaryFields): TrafficEventAiSummary => {
  const summaryField = typeof fields.summary === 'string' ? fields.summary.trim() : '';
  const recommendationField =
    typeof fields.advice === 'string'
      ? fields.advice.trim()
      : typeof fields.recommendation === 'string'
        ? fields.recommendation.trim()
        : '';
  const rawSummary =
    summaryField ||
    (typeof fields.notificationBody === 'string' && fields.notificationBody.trim()) ||
    event.description ||
    event.segment ||
    event.reasonDescription ||
    'Sammanfattning saknas.';
  const summaryText = ensureExtendedSummary(event, rawSummary, Boolean(fields.aiGenerated));
  const adviceText =
    recommendationField ||
    (event.impactLabel ? `Påverkan: ${event.impactLabel}. Kontrollera din avgång.` : 'Kontrollera din avgång.');
  const notificationTitle =
    typeof fields.notificationTitle === 'string' && fields.notificationTitle.trim()
      ? fields.notificationTitle.trim()
      : event.title || 'Trafikinformation';
  const notificationBody =
    typeof fields.notificationBody === 'string' && fields.notificationBody.trim()
      ? fields.notificationBody.trim()
      : summaryText;
  return {
    summary: summaryText,
    advice: adviceText,
    notificationTitle,
    notificationBody,
    generatedAt:
      typeof fields.generatedAt === 'string' && fields.generatedAt
        ? fields.generatedAt
        : new Date().toISOString(),
    aiGenerated: Boolean(fields.aiGenerated),
  };
};

const requestBackendSummary = async (
  event: SerializedEvent,
  forceRefresh: boolean,
): Promise<SummaryFields | null> => {
  if (!API_BASE_URL) {
    return null;
  }
  try {
    const response = await fetch(`${API_BASE_URL}/api/traffic/event-summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, forceRefresh }),
    });
    if (!response.ok) {
      console.warn('[TrafficAI] Backend responded with', response.status);
      return null;
    }
    return (await response.json()) as SummaryFields;
  } catch (error) {
    console.warn('[TrafficAI] Backend summary request failed', error);
    return null;
  }
};

const requestDirectOpenAiSummary = async (event: SerializedEvent): Promise<SummaryFields | null> => {
  if (!OPENAI_API_KEY) {
    return null;
  }
  try {
    const response = await fetch(`${OPENAI_CHAT_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.4,
        max_tokens: 300,
        messages: buildPromptMessages(event),
        response_format: { type: 'json_object' },
      }),
    });
    if (!response.ok) {
      console.warn('[TrafficAI] Direct OpenAI fetch failed', response.status);
      return null;
    }
    const completion = await response.json();
    const textResponse = completion.choices?.[0]?.message?.content;
    const parsed = parseAiContent(textResponse);
    if (!parsed) {
      return null;
    }
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
      advice:
        typeof parsed.recommendation === 'string'
          ? parsed.recommendation
          : typeof parsed.advice === 'string'
            ? parsed.advice
            : undefined,
      notificationTitle: typeof parsed.notificationTitle === 'string' ? parsed.notificationTitle : undefined,
      notificationBody: typeof parsed.notificationBody === 'string' ? parsed.notificationBody : undefined,
      aiGenerated: true,
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.warn('[TrafficAI] Direct OpenAI request threw', error);
    return null;
  }
};

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
  if (!summary.aiGenerated) {
    try {
      await AsyncStorage.removeItem(buildSummaryKey(eventId));
    } catch (error) {
      console.warn('[TrafficAI] Failed to clear cached summary', error);
    }
    return;
  }
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
  if (!API_BASE_URL && !OPENAI_API_KEY) {
    return null;
  }
  if (!options.force) {
    const cached = await readAsyncCache(event.id);
    if (cached) {
      return cached;
    }
  }

  const serializedEvent = serializeEvent(event);
  let fields: SummaryFields | null = null;
  let source: 'backend' | 'direct-openai' | 'unknown' = 'unknown';

  if (API_BASE_URL) {
    console.log('[TrafficAI] requesting summary', {
      url: `${API_BASE_URL}/api/traffic/event-summary`,
      eventId: event.id,
      force: options.force ?? false,
    });
    fields = await requestBackendSummary(serializedEvent, Boolean(options.force));
    source = 'backend';
  }

  if (!fields && OPENAI_API_KEY) {
    console.log('[TrafficAI] falling back to direct OpenAI', { eventId: event.id });
    fields = await requestDirectOpenAiSummary(serializedEvent);
    source = 'direct-openai';
  }

  if (!fields) {
    return null;
  }

  const prepared = normalizeSummary(serializedEvent, fields);
  await writeAsyncCache(event.id, prepared);
  console.log('[TrafficAI] summary response', {
    eventId: event.id,
    summary: prepared.summary,
    advice: prepared.advice,
    notificationTitle: prepared.notificationTitle,
    aiGenerated: prepared.aiGenerated,
    source,
  });
  return prepared;
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

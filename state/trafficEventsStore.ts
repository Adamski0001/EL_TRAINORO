import { fetchOperativeEvents, fetchRailwayEvents, fetchStationLookup } from '../lib/trafikverket';
import type { EventSectionApiEntry, OperativeEventApiEntry, RailwayEventApiEntry, SelectedSectionApiEntry } from '../lib/trafikverket';
import type { TrafficEvent, TrafficEventSeverity } from '../types/traffic';

const REFRESH_INTERVAL_MS = 150_000;
const DEFAULT_STATE: TrafficEventsStoreState = {
  events: [],
  loading: true,
  error: null,
  lastUpdated: null,
};

export type TrafficEventsStoreState = {
  events: TrafficEvent[];
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
};

let state: TrafficEventsStoreState = DEFAULT_STATE;
const listeners = new Set<() => void>();
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let abortController: AbortController | null = null;

const emit = () => {
  listeners.forEach(listener => listener());
};

const assignState = (patch: Partial<TrafficEventsStoreState>) => {
  state = { ...state, ...patch };
  emit();
};

const severityFromScore = (score: number | null): TrafficEventSeverity => {
  if (score === null) {
    return 'medium';
  }
  if (score >= 4) {
    return 'critical';
  }
  if (score >= 3) {
    return 'high';
  }
  if (score >= 2) {
    return 'medium';
  }
  return 'low';
};

const severityScoreFromImpact = (impactLevel: number | null): number | null => {
  if (impactLevel === null || Number.isNaN(impactLevel)) {
    return null;
  }
  if (impactLevel >= 5) {
    return 4;
  }
  if (impactLevel >= 4) {
    return 3;
  }
  if (impactLevel >= 3) {
    return 3;
  }
  if (impactLevel >= 2) {
    return 2;
  }
  return 1;
};

const impactLabelFromScore = (score: number | null): string | null => {
  if (score === null) {
    return null;
  }
  if (score >= 4) {
    return 'Mycket stor påverkan';
  }
  if (score >= 3) {
    return 'Stor påverkan';
  }
  if (score >= 2) {
    return 'Måttlig påverkan';
  }
  return 'Liten påverkan';
};

const resolveStationName = (signature: string | null, lookup: Record<string, string>): string | null => {
  if (!signature) {
    return null;
  }
  const trimmed = signature.trim();
  if (!trimmed) {
    return null;
  }
  return lookup[trimmed] ?? trimmed;
};

const buildSegmentLabel = (sections: Array<{ from: string | null; to: string | null; via?: string | null }>) => {
  for (const section of sections) {
    if (section.from && section.to) {
      return `${section.from} → ${section.to}`;
    }
    if (section.to) {
      return `Mot ${section.to}`;
    }
    if (section.from) {
      return `Vid ${section.from}`;
    }
  }
  return null;
};

type DraftEvent = {
  id: string;
  title: string | null;
  description: string | null;
  startTime: string | null;
  endTime: string | null;
  updatedAt: string | null;
  severityScore: number;
  impactLabel: string | null;
  sections: Array<{ fromSignature: string | null; toSignature: string | null; viaSignature: string | null }>; 
  source: 'operative' | 'railway' | 'merged';
};

const upsertDraft = (drafts: Map<string, DraftEvent>, id: string, source: DraftEvent['source']) => {
  if (!drafts.has(id)) {
    drafts.set(id, {
      id,
      title: null,
      description: null,
      startTime: null,
      endTime: null,
      updatedAt: null,
      severityScore: 0,
      impactLabel: null,
      sections: [],
      source,
    });
  }
  const draft = drafts.get(id)!;
  if (source !== draft.source && draft.source !== 'merged') {
    draft.source = 'merged';
  }
  return draft;
};

const appendSections = (draft: DraftEvent, sections: SelectedSectionApiEntry[] | EventSectionApiEntry[]) => {
  sections.forEach(section => {
    draft.sections.push({
      fromSignature: section.fromSignature ?? null,
      toSignature: section.toSignature ?? null,
      viaSignature: section.viaSignature ?? null,
    });
  });
};

const normalizeEvents = (
  operativeEvents: OperativeEventApiEntry[],
  railwayEvents: RailwayEventApiEntry[],
  lookup: Record<string, string>,
): TrafficEvent[] => {
  const drafts = new Map<string, DraftEvent>();

  operativeEvents.forEach(event => {
    const id = event.operativeEventId ?? `op-${event.eventTypeCode ?? event.eventTypeDescription ?? 'unknown'}`;
    const draft = upsertDraft(drafts, id, 'operative');
    draft.title = draft.title ?? event.eventTypeDescription ?? event.eventTypeCode;
    const impact = event.trafficImpacts.find(item => item.publicMessageHeader || item.publicMessageDescription);
    if (impact?.publicMessageHeader) {
      draft.title = impact.publicMessageHeader;
    }
    if (impact?.publicMessageDescription) {
      draft.description = impact.publicMessageDescription;
    } else if (event.eventTypeDescription) {
      draft.description = draft.description ?? event.eventTypeDescription;
    }
    draft.startTime = draft.startTime ?? event.startDateTime ?? impact?.startDateTime ?? null;
    draft.endTime = draft.endTime ?? event.endDateTime ?? impact?.endDateTime ?? null;
    const updatedCandidates = [event.modifiedDateTime, impact?.endDateTime, impact?.startDateTime].filter(Boolean) as string[];
    const latestUpdate = updatedCandidates.sort().pop() ?? null;
    draft.updatedAt = latestUpdate ?? draft.updatedAt;
    const impactScores = [severityScoreFromImpact(event.roadDegreeOfImpact)];
    event.trafficImpacts.forEach(entry => {
      impactScores.push(severityScoreFromImpact(entry.operatingLevel));
      entry.selectedSections.forEach(section => {
        impactScores.push(severityScoreFromImpact(section.operatingLevel));
      });
    });
    const bestScore = impactScores.reduce<number | null>((max, score) => {
      if (score === null) {
        return max;
      }
      if (max === null || score > max) {
        return score;
      }
      return max;
    }, null);
    if (bestScore && bestScore > draft.severityScore) {
      draft.severityScore = bestScore;
      draft.impactLabel = impactLabelFromScore(bestScore);
    }
    appendSections(draft, event.eventSections);
    event.trafficImpacts.forEach(entry => {
      appendSections(draft, entry.selectedSections);
    });
  });

  railwayEvents.forEach(event => {
    const id = event.operativeEventId ?? event.eventId ?? `rw-${event.reasonCode ?? 'unknown'}`;
    const draft = upsertDraft(drafts, id, event.operativeEventId ? 'merged' : 'railway');
    draft.startTime = draft.startTime ?? event.startDateTime;
    draft.endTime = draft.endTime ?? event.endDateTime;
    draft.updatedAt = draft.updatedAt ?? event.modifiedDateTime ?? event.startDateTime;
    draft.title = draft.title ?? event.reasonCode ?? 'Trafikhändelse';
    appendSections(draft, event.sections);
  });

  const events: TrafficEvent[] = [];
  drafts.forEach(draft => {
    const sectionNames = draft.sections.map(section => ({
      from: resolveStationName(section.fromSignature, lookup),
      to: resolveStationName(section.toSignature, lookup),
      via: resolveStationName(section.viaSignature, lookup),
    }));
    const segment = buildSegmentLabel(sectionNames);
    const severity = severityFromScore(draft.severityScore || 1);
    const title = draft.title ?? segment ?? 'Trafikhändelse';
    events.push({
      id: draft.id,
      title,
      description: draft.description,
      severity,
      impactLabel: draft.impactLabel ?? impactLabelFromScore(draft.severityScore) ?? null,
      segment,
      startTime: draft.startTime,
      endTime: draft.endTime,
      updatedAt: draft.updatedAt,
      source: draft.source,
    });
  });

  return events.sort((a, b) => {
    const severityOrder: Record<TrafficEventSeverity, number> = { critical: 3, high: 2, medium: 1, low: 0 };
    const severityDiff = severityOrder[b.severity] - severityOrder[a.severity];
    if (severityDiff !== 0) {
      return severityDiff;
    }
    const aTime = a.updatedAt ? Date.parse(a.updatedAt) : 0;
    const bTime = b.updatedAt ? Date.parse(b.updatedAt) : 0;
    return bTime - aTime;
  });
};

const stopPolling = () => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  abortController?.abort();
  abortController = null;
};

const startPolling = () => {
  if (refreshTimer) {
    return;
  }
  void loadEvents();
  refreshTimer = setInterval(() => {
    void loadEvents();
  }, REFRESH_INTERVAL_MS);
};

async function loadEvents(options: { immediate?: boolean } = {}) {
  abortController?.abort();
  const controller = new AbortController();
  abortController = controller;
  const showLoading = options.immediate || state.events.length === 0;
  if (showLoading) {
    assignState({ loading: true });
  }
  try {
    const [lookup, operativeEvents, railwayEvents] = await Promise.all([
      fetchStationLookup(),
      fetchOperativeEvents({ signal: controller.signal }),
      fetchRailwayEvents({ signal: controller.signal }),
    ]);
    const events = normalizeEvents(operativeEvents, railwayEvents, lookup);
    assignState({
      events,
      loading: false,
      error: null,
      lastUpdated: new Date(),
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      return;
    }
    assignState({
      error: error instanceof Error ? error.message : 'Kunde inte läsa trafikhändelser.',
      loading: false,
    });
  }
}

export const trafficEventsStore = {
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
  refetch() {
    return loadEvents({ immediate: true });
  },
  reset() {
    stopPolling();
    state = { ...DEFAULT_STATE };
    emit();
  },
};

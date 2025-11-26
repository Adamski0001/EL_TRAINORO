import { useCallback, useMemo, useRef, useState } from 'react';

import { fetchEventSummary, type TrafficEventAiSummary } from '../lib/trafficAiService';
import type { TrafficEvent } from '../types/traffic';

type SummaryMap = Record<string, TrafficEventAiSummary>;
type LoadingMap = Record<string, boolean>;
type ErrorMap = Record<string, string | null>;

export function useTrafficEventSummaries() {
  const [summaries, setSummaries] = useState<SummaryMap>({});
  const [loadingMap, setLoadingMap] = useState<LoadingMap>({});
  const [errorMap, setErrorMap] = useState<ErrorMap>({});
  const inflightRef = useRef<Set<string>>(new Set());
  const summariesRef = useRef<SummaryMap>({});

  summariesRef.current = summaries;

  const ensureSummary = useCallback(async (event: TrafficEvent | null | undefined) => {
    if (!event?.id) {
      return;
    }
    if (summariesRef.current[event.id] || inflightRef.current.has(event.id)) {
      return;
    }
    inflightRef.current.add(event.id);
    console.log('[TrafficAI] ensure summary start', event.id);
    setLoadingMap(prev => ({ ...prev, [event.id]: true }));
    setErrorMap(prev => ({ ...prev, [event.id]: null }));
    try {
      const result = await fetchEventSummary(event);
      if (result) {
        setSummaries(prev => {
          if (prev[event.id]) {
            return prev;
          }
          console.log('[TrafficAI] summary stored', {
            eventId: event.id,
            mode: result.aiGenerated ? 'ai' : 'fallback',
            summary: result.summary,
          });
          return { ...prev, [event.id]: result };
        });
      } else {
        setErrorMap(prev => ({
          ...prev,
          [event.id]: 'Fick inget svar från AI-tjänsten för den här händelsen.',
        }));
        console.warn('[TrafficAI] Summary request returned empty result', event.id);
      }
    } catch (error) {
      console.warn('[TrafficAI] Summary request failed', error);
      setErrorMap(prev => ({
        ...prev,
        [event.id]: error instanceof Error ? error.message : 'Okänt fel vid hämtning av sammanfattning.',
      }));
    } finally {
      inflightRef.current.delete(event.id);
      console.log('[TrafficAI] ensure summary complete', event.id);
      setLoadingMap(prev => {
        const next = { ...prev };
        delete next[event.id];
        return next;
      });
    }
  }, []);

  const reset = useCallback(() => {
    inflightRef.current.clear();
    setSummaries({});
    setLoadingMap({});
    setErrorMap({});
  }, []);

  return useMemo(
    () => ({
      summaries,
      loadingMap,
      errorMap,
      ensureSummary,
      reset,
    }),
    [summaries, loadingMap, errorMap, ensureSummary, reset],
  );
}

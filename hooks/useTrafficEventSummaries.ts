import { useEffect, useState } from 'react';

import { fetchEventSummary, type TrafficEventAiSummary } from '../lib/trafficAiService';
import type { TrafficEvent } from '../types/traffic';

type SummaryMap = Record<string, TrafficEventAiSummary>;

export function useTrafficEventSummaries(events: TrafficEvent[] | null | undefined) {
  const [summaries, setSummaries] = useState<SummaryMap>({});

  useEffect(() => {
    let cancelled = false;
    if (!events?.length) {
      return () => {
        cancelled = true;
      };
    }
    events.forEach(event => {
      if (!event?.id || summaries[event.id]) {
        return;
      }
      fetchEventSummary(event).then(result => {
        if (!cancelled && result) {
          setSummaries(current => {
            if (current[event.id]) {
              return current;
            }
            return { ...current, [event.id]: result };
          });
        }
      });
    });
    return () => {
      cancelled = true;
    };
  }, [events, summaries]);

  return summaries;
}

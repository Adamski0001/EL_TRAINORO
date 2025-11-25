export type TrafficEventSeverity = 'low' | 'medium' | 'high' | 'critical';

export type TrafficEvent = {
  id: string;
  title: string;
  description: string | null;
  severity: TrafficEventSeverity;
  impactLabel: string | null;
  segment: string | null;
  startTime: string | null;
  endTime: string | null;
  updatedAt: string | null;
  source: 'operative' | 'railway' | 'merged';
};

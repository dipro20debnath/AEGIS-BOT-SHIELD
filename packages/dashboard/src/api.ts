import { useEffect, useState } from 'react';

/** Shapes returned by the server status API (packages/server-node/src/routes.ts). */
export interface StatsSummary {
  startedAt: number;
  uptimeSeconds: number;
  totalRequests: number;
  telemetrySubmissions: number;
  allowed: number;
  monitored: number;
  challenged: number;
  blocked: number;
  topReasons: Array<{ reason: string; count: number }>;
}

export interface StatsEvent {
  timestamp: number;
  path: string;
  verdict: 'allow' | 'monitor' | 'challenge' | 'block';
  score: number;
  reasons: string[];
  ip: string;
  telemetry: boolean;
}

export interface ServerConfig {
  siteKeyConfigured: boolean;
  mode: string;
  thresholds: { block: number; challenge: number };
  requireTokenPaths: string[];
  protectedPaths: string[] | 'all';
  excludedPaths: string[];
  tokenTtl: number;
  mlEnabled: boolean;
}

export interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/** GET a JSON endpoint of the AEGIS server, refreshing every `intervalMs` (0 = once). */
export function useApi<T>(path: string, intervalMs = 5000): ApiState<T> {
  const [state, setState] = useState<ApiState<T>>({ data: null, error: null, loading: true });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(path, { headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as T;
        if (!cancelled) setState({ data, error: null, loading: false });
      } catch (e) {
        if (!cancelled) setState(prev => ({ data: prev.data, error: (e as Error).message, loading: false }));
      }
    };
    void load();
    const timer = intervalMs > 0 ? setInterval(load, intervalMs) : undefined;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [path, intervalMs]);

  return state;
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

export function toCsv(events: StatsEvent[]): string {
  const rows = [['time', 'path', 'verdict', 'score', 'reasons', 'ip_prefix', 'telemetry']];
  for (const e of events) {
    rows.push([new Date(e.timestamp).toISOString(), e.path, e.verdict, String(e.score), e.reasons.join(' '), e.ip, String(e.telemetry)]);
  }
  return rows.map(r => r.map(v => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n');
}

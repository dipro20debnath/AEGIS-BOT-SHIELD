import { useEffect, useRef, useState } from 'react';

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

export type LiveStatus = 'connecting' | 'live' | 'polling';

export interface LiveStats {
  summary: StatsSummary | null;
  /** Most recent first, at most 500 */
  events: StatsEvent[];
  status: LiveStatus;
  error: string | null;
  loading: boolean;
}

const MAX_EVENTS = 500;

type LiveMessage =
  | { type: 'hello'; summary: StatsSummary; events: StatsEvent[] }
  | { type: 'events'; events: StatsEvent[]; dropped: number }
  | { type: 'summary'; summary: StatsSummary };

/**
 * Stats and events pushed over the server's WebSocket feed (/aegis/live,
 * packages/server-node/src/live.ts). While the socket is down it polls the
 * REST endpoints instead and keeps retrying the socket with backoff.
 */
export function useLiveStats(): LiveStats {
  const [summary, setSummary] = useState<StatsSummary | null>(null);
  const [events, setEvents] = useState<StatsEvent[]>([]);
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seeded = useRef(false);

  useEffect(() => {
    let closed = false;
    let ws: WebSocket | null = null;
    let retry = 1000;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;

    const poll = async () => {
      try {
        const [s, e] = await Promise.all([
          fetch('/aegis/stats').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
          fetch('/aegis/events?limit=500').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
        ]);
        if (closed) return;
        setSummary(s as StatsSummary);
        setEvents(e as StatsEvent[]);
        setError(null);
        seeded.current = true;
      } catch (err) {
        if (!closed) setError((err as Error).message);
      } finally {
        if (!closed) setLoading(false);
      }
    };
    const startPolling = () => {
      setStatus('polling');
      if (!pollTimer) { void poll(); pollTimer = setInterval(poll, 5000); }
    };
    const stopPolling = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = undefined; } };

    const connect = () => {
      if (closed) return;
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${scheme}://${window.location.host}/aegis/live`);
      ws.onopen = () => { retry = 1000; stopPolling(); setStatus('live'); setError(null); };
      ws.onmessage = (message) => {
        const data = JSON.parse(String(message.data)) as LiveMessage;
        if (data.type === 'hello') {
          setSummary(data.summary);
          // The greeting carries the last 100 events; keep a longer history fetched earlier
          if (!seeded.current) setEvents(data.events);
          setLoading(false);
          if (!seeded.current) {
            seeded.current = true;
            fetch('/aegis/events?limit=500').then(r => (r.ok ? r.json() : null)).then(e => { if (e && !closed) setEvents(e as StatsEvent[]); }).catch(() => undefined);
          }
        } else if (data.type === 'events') {
          setEvents(prev => [...[...data.events].reverse(), ...prev].slice(0, MAX_EVENTS));
        } else if (data.type === 'summary') {
          setSummary(data.summary);
        }
      };
      ws.onclose = () => {
        if (closed) return;
        startPolling();
        retryTimer = setTimeout(connect, retry);
        retry = Math.min(retry * 2, 30_000);
      };
    };
    connect();
    return () => {
      closed = true;
      stopPolling();
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
    };
  }, []);

  return { summary, events, status, error, loading };
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

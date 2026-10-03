/**
 * In-memory request statistics for the dashboard API (real counts since the
 * process started; nothing is persisted). IPs are stored truncated to /24
 * (IPv4) or /48 (IPv6). Every recorded event is also emitted as 'event'
 * (the WebSocket live feed, live.ts, listens to it).
 */
import { EventEmitter } from 'events';

export interface StatsEvent {
  timestamp: number;
  path: string;
  verdict: string;
  score: number;
  reasons: string[];
  ip: string;
  telemetry: boolean;
}

export function maskIp(ip: string): string {
  const v4 = ip.replace(/^::ffff:/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) return v4.split('.').slice(0, 3).join('.') + '.0/24';
  if (ip.includes(':')) return ip.split(':').slice(0, 3).join(':') + '::/48';
  return 'unknown';
}

export class AegisStats extends EventEmitter {
  readonly startedAt = Date.now();
  totalRequests = 0;
  telemetrySubmissions = 0;
  byVerdict: Record<string, number> = { allow: 0, monitor: 0, challenge: 0, block: 0 };
  byReason: Record<string, number> = {};
  private events: StatsEvent[] = [];

  constructor(private maxEvents = 500) {
    super();
    // Any number of live-feed connections may listen
    this.setMaxListeners(0);
  }

  record(event: Omit<StatsEvent, 'timestamp'>): void {
    this.totalRequests++;
    if (event.telemetry) this.telemetrySubmissions++;
    this.byVerdict[event.verdict] = (this.byVerdict[event.verdict] ?? 0) + 1;
    for (const reason of event.reasons) this.byReason[reason] = (this.byReason[reason] ?? 0) + 1;
    const stored: StatsEvent = { ...event, ip: maskIp(event.ip), timestamp: Date.now() };
    this.events.push(stored);
    if (this.events.length > this.maxEvents) this.events.shift();
    this.emit('event', stored);
  }

  recent(limit = 100): StatsEvent[] {
    return this.events.slice(-limit).reverse();
  }

  summary() {
    return {
      startedAt: this.startedAt,
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      totalRequests: this.totalRequests,
      telemetrySubmissions: this.telemetrySubmissions,
      allowed: this.byVerdict.allow,
      monitored: this.byVerdict.monitor,
      challenged: this.byVerdict.challenge,
      blocked: this.byVerdict.block,
      topReasons: Object.entries(this.byReason).sort((a, b) => b[1] - a[1]).slice(0, 10)
        .map(([reason, count]) => ({ reason, count })),
    };
  }
}

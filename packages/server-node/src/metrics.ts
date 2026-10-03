/**
 * Prometheus metrics of an AegisNode (served by aegisRoutes at /aegis/metrics).
 * Same metric names as the Python server (aegis_shield/metrics.py).
 *
 *   aegis_decisions_total{kind, verdict}          kind = request | telemetry | challenge
 *   aegis_signals_total{signal}                   signals behind decisions (bounded set of names)
 *   aegis_decision_duration_seconds{kind}         time AEGIS spent deciding (histogram)
 *   aegis_ml_errors_total                         ML service unavailable or timed out
 *   aegis_store_errors_total{operation}           shared store (Redis) failures, analysis degraded
 *   aegis_sessions                                in-process session records (0 with a shared store)
 *   aegis_live_clients                            WebSocket live-feed connections
 * plus the prom-client process metrics (CPU, memory, event-loop lag, GC), prefixed aegis_node_.
 *
 * Each AegisNode has its own registry, so several instances (or tests) do not clash.
 */
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export type DecisionKind = 'request' | 'telemetry' | 'challenge';

export class AegisMetrics {
  readonly registry = new Registry();
  readonly decisions: Counter<'kind' | 'verdict'>;
  readonly signals: Counter<'signal'>;
  readonly duration: Histogram<'kind'>;
  readonly mlErrors: Counter;
  readonly storeErrors: Counter<'operation'>;
  readonly sessions: Gauge;
  readonly liveClients: Gauge;

  constructor(options: { processMetrics?: boolean; sessionCount?: () => number } = {}) {
    const registers = [this.registry];
    this.decisions = new Counter({ name: 'aegis_decisions_total', help: 'Decisions by kind and verdict', labelNames: ['kind', 'verdict'], registers });
    this.signals = new Counter({ name: 'aegis_signals_total', help: 'Signals that contributed to decisions', labelNames: ['signal'], registers });
    this.duration = new Histogram({
      name: 'aegis_decision_duration_seconds', help: 'Time spent by AEGIS per decision', labelNames: ['kind'], registers,
      buckets: [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
    });
    this.mlErrors = new Counter({ name: 'aegis_ml_errors_total', help: 'ML service calls that failed or timed out', registers });
    this.storeErrors = new Counter({ name: 'aegis_store_errors_total', help: 'Shared store operations that failed', labelNames: ['operation'], registers });
    const sessionCount = options.sessionCount;
    this.sessions = new Gauge({ name: 'aegis_sessions', help: 'Session records held in this process', registers,
      collect(): void { if (sessionCount) this.set(sessionCount()); } });
    this.liveClients = new Gauge({ name: 'aegis_live_clients', help: 'Connected WebSocket live-feed clients', registers });
    if (options.processMetrics ?? true) collectDefaultMetrics({ register: this.registry, prefix: 'aegis_node_' });
  }

  /** Time an async decision and count its verdict and signals. */
  async observe<T extends { verdict: string; reasons?: string[] }>(kind: DecisionKind, fn: () => Promise<T | null>): Promise<T | null> {
    const stop = this.duration.startTimer({ kind });
    const result = await fn();
    stop();
    if (result) {
      this.decisions.inc({ kind, verdict: result.verdict });
      for (const signal of result.reasons ?? []) this.signals.inc({ signal });
    }
    return result;
  }

  text(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}

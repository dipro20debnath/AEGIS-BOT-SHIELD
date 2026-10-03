"""
Prometheus metrics of the Python middleware, same names as the Node server
(packages/server-node/src/metrics.ts):

  aegis_decisions_total{kind, verdict}       kind = request | telemetry | challenge
  aegis_signals_total{signal}
  aegis_decision_duration_seconds{kind}       histogram
  aegis_ml_errors_total
  aegis_store_errors_total{operation}
  aegis_sessions                              in-process session records (0 with a shared store)
plus prometheus_client's process metrics (CPU, memory, file descriptors) on Linux.

Needs `prometheus_client` (pip install "aegis-server-python[metrics]"); without it
the counters are no-ops and the metrics endpoint answers 501. Each middleware
instance has its own registry.
"""
import time
from contextlib import contextmanager
from typing import Callable, Iterable, Optional

try:
    from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram, generate_latest
    from prometheus_client import CONTENT_TYPE_LATEST, ProcessCollector, PlatformCollector
    AVAILABLE = True
except ImportError:  # pragma: no cover - depends on the environment
    AVAILABLE = False

BUCKETS = (0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0)


class Metrics:
    def __init__(self, session_count: Optional[Callable[[], int]] = None, process_metrics: bool = True):
        self.enabled = AVAILABLE
        if not AVAILABLE:
            return
        self.registry = CollectorRegistry()
        r = self.registry
        self.decisions = Counter("aegis_decisions_total", "Decisions by kind and verdict", ["kind", "verdict"], registry=r)
        self.signals = Counter("aegis_signals_total", "Signals that contributed to decisions", ["signal"], registry=r)
        self.duration = Histogram("aegis_decision_duration_seconds", "Time spent by AEGIS per decision", ["kind"],
                                  buckets=BUCKETS, registry=r)
        self.ml_errors = Counter("aegis_ml_errors_total", "ML scoring calls that failed", registry=r)
        self.store_errors = Counter("aegis_store_errors_total", "Shared store operations that failed", ["operation"],
                                    registry=r)
        sessions = Gauge("aegis_sessions", "Session records held in this process", registry=r)
        if session_count is not None:
            sessions.set_function(session_count)
        if process_metrics:
            ProcessCollector(registry=r)
            PlatformCollector(registry=r)

    def decision(self, kind: str, verdict: str, signals: Iterable[str] = (), seconds: Optional[float] = None) -> None:
        if not self.enabled:
            return
        self.decisions.labels(kind, verdict).inc()
        for signal in signals:
            self.signals.labels(signal).inc()
        if seconds is not None:
            self.duration.labels(kind).observe(seconds)

    def store_error(self, operation: str) -> None:
        if self.enabled:
            self.store_errors.labels(operation).inc()

    def ml_error(self) -> None:
        if self.enabled:
            self.ml_errors.inc()

    @contextmanager
    def timer(self):
        start = time.perf_counter()
        holder = {}
        yield holder
        holder["seconds"] = time.perf_counter() - start

    def render(self):
        """(status, content_type, body) for an HTTP response."""
        if not self.enabled:
            return 501, "text/plain; charset=utf-8", b"prometheus_client is not installed\n"
        return 200, CONTENT_TYPE_LATEST, generate_latest(self.registry)

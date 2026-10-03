"""
Server-side session tracking for the session features of the ML contract.

Sessions are keyed by an opaque random id kept in an HttpOnly cookie
(`aegis_sid`). Only request times, paths and verdicts are kept, for `max_age`
seconds of inactivity: in memory, or in a shared store (aegis_shield.store,
e.g. Redis) when several processes serve the site. With a store, each
session is one JSON value; concurrent requests of one session in different
processes are last-writer-wins, which loses at most a request time.
"""
import json
import logging
import secrets
import threading
import time
from collections import OrderedDict
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional, Set

from .session_patterns import RequestRecord, classify_request

SESSION_COOKIE = "aegis_sid"

logger = logging.getLogger("aegis_shield")


@dataclass
class Session:
    id: str
    created: float
    last_seen: float
    request_times: List[float] = field(default_factory=list)
    paths: Set[str] = field(default_factory=set)
    risk_history: List[float] = field(default_factory=list)
    #: Latest score from SDK telemetry (None: this session never sent telemetry)
    telemetry_score: Optional[float] = None
    #: Last 100 requests with their kind and status (session_patterns.py)
    requests: List[RequestRecord] = field(default_factory=list)

    def to_json(self) -> str:
        data = asdict(self)
        data["paths"] = sorted(self.paths)
        return json.dumps(data, separators=(",", ":"))

    @classmethod
    def from_json(cls, raw: str) -> "Session":
        data: Dict[str, Any] = json.loads(raw)
        data["paths"] = set(data.get("paths", []))
        data["requests"] = [RequestRecord(**r) for r in data.get("requests", [])]
        return cls(**data)


class SessionTracker:
    def __init__(self, max_age: float = 1800, max_sessions: int = 100_000, store=None, on_store_error=None):
        self.max_age = max_age
        self.max_sessions = max(1, max_sessions)
        # Least recently used first: expired sessions and, at the cap, the
        # oldest are dropped from the front in O(1) (no scan or sort, which
        # paused requests for up to 75 ms at 100k sessions).
        self._sessions: "OrderedDict[str, Session]" = OrderedDict()
        self._lock = threading.Lock()
        self.store = store
        self.on_store_error = on_store_error

    def _load(self, session_id: str) -> Optional[Session]:
        # Store unreachable: continue with a fresh session rather than skipping the analysis
        try:
            raw = self.store.get(f"sess:{session_id}")
        except Exception as exc:
            logger.warning("AEGIS session store unavailable: %s", exc)
            if self.on_store_error:
                self.on_store_error("session_get")
            return None
        return Session.from_json(raw) if raw else None

    def save(self, session: Session) -> None:
        """Write a session changed with save=False to the store (no-op in memory)."""
        if self.store is not None:
            try:
                self.store.set(f"sess:{session.id}", session.to_json(), self.max_age)
            except Exception as exc:
                logger.warning("AEGIS session store unavailable: %s", exc)
                if self.on_store_error:
                    self.on_store_error("session_set")

    def get_or_create(self, session_id: Optional[str]) -> Session:
        now = time.time()
        if self.store is not None:
            session = self._load(session_id) if session_id else None
            if session is None:
                # Stored by the first record_* call
                session = Session(id=secrets.token_urlsafe(18), created=now, last_seen=now)
            return session
        with self._lock:
            session = self._sessions.get(session_id) if session_id else None
            if session is not None and now - session.last_seen <= self.max_age:
                self._sessions.move_to_end(session.id)
                return session
            if session is not None:
                del self._sessions[session.id]
            self._evict(now)
            session = Session(id=secrets.token_urlsafe(18), created=now, last_seen=now)
            self._sessions[session.id] = session
            return session

    def get(self, session_id: str) -> Optional[Session]:
        if self.store is not None:
            return self._load(session_id)
        with self._lock:
            return self._sessions.get(session_id)

    def record_request(self, session: Session, path: str, method: str = "GET",
                       headers: Optional[Dict[str, str]] = None, save: bool = True) -> None:
        """Add a request. save=False leaves the store write to a following record_risk or save()."""
        now = time.time()
        has_referer = any(k.lower() == "referer" and v for k, v in (headers or {}).items())
        record = RequestRecord(now, path, classify_request(path, method, headers), has_referer)
        with self._lock:
            session.requests.append(record)
            if len(session.requests) > 100:
                session.requests = session.requests[-100:]
            session.last_seen = now
            session.request_times.append(now)
            if len(session.request_times) > 500:
                session.request_times = session.request_times[-500:]
            if len(session.paths) < 1000:
                session.paths.add(path)
        if save:
            self.save(session)

    def record_response(self, session: Session, status: int) -> None:
        """Attach the response status to the session's latest request (enables 4xx-probing detection)."""
        with self._lock:
            if session.requests and session.requests[-1].status is None:
                session.requests[-1].status = status
        self.save(session)

    def record_risk(self, session: Session, score: float, save: bool = True) -> None:
        with self._lock:
            session.risk_history.append(score)
            if len(session.risk_history) > 100:
                session.risk_history = session.risk_history[-100:]
        if save:
            self.save(session)

    def features(self, session: Session) -> Dict[str, float]:
        """Session features (contracts/features.json, category 'session')."""
        times = session.request_times
        count = len(times)
        gaps = [b - a for a, b in zip(times, times[1:])]
        history = session.risk_history[-10:]
        return {
            "session_duration": (times[-1] - session.created) if times else 0.0,
            "session_request_count": float(count),
            "session_unique_paths": float(len(session.paths)),
            "session_avg_time_between_requests": sum(gaps) / len(gaps) if gaps else 0.0,
            "session_reputation": (sum(history) / len(history) / 100.0) if history else 0.0,
        }

    def _evict(self, now: float) -> None:
        """Make room for one session: drop a few expired ones, then the least recently used beyond the cap."""
        for _ in range(8):
            if not self._sessions:
                break
            oldest = next(iter(self._sessions.values()))
            if now - oldest.last_seen <= self.max_age:
                break
            self._sessions.popitem(last=False)
        while len(self._sessions) >= self.max_sessions:
            self._sessions.popitem(last=False)

    def __len__(self) -> int:
        return len(self._sessions)

"""
Server-side session tracking for the session features of the ML contract.

Sessions are keyed by an opaque random id kept in an HttpOnly cookie
(`aegis_sid`). Only request times, paths and verdicts are kept, in memory,
for `max_age` seconds of inactivity.
"""
import secrets
import threading
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set

SESSION_COOKIE = "aegis_sid"


@dataclass
class Session:
    id: str
    created: float
    last_seen: float
    request_times: List[float] = field(default_factory=list)
    paths: Set[str] = field(default_factory=set)
    risk_history: List[float] = field(default_factory=list)


class SessionTracker:
    def __init__(self, max_age: float = 1800, max_sessions: int = 100_000):
        self.max_age = max_age
        self.max_sessions = max_sessions
        self._sessions: Dict[str, Session] = {}
        self._lock = threading.Lock()

    def get_or_create(self, session_id: Optional[str]) -> Session:
        now = time.time()
        with self._lock:
            session = self._sessions.get(session_id) if session_id else None
            if session is None or now - session.last_seen > self.max_age:
                if len(self._sessions) >= self.max_sessions:
                    self._evict(now)
                session = Session(id=secrets.token_urlsafe(18), created=now, last_seen=now)
                self._sessions[session.id] = session
            return session

    def record_request(self, session: Session, path: str) -> None:
        now = time.time()
        with self._lock:
            session.last_seen = now
            session.request_times.append(now)
            if len(session.request_times) > 500:
                session.request_times = session.request_times[-500:]
            if len(session.paths) < 1000:
                session.paths.add(path)

    def record_risk(self, session: Session, score: float) -> None:
        with self._lock:
            session.risk_history.append(score)
            if len(session.risk_history) > 100:
                session.risk_history = session.risk_history[-100:]

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
        expired = [sid for sid, s in self._sessions.items() if now - s.last_seen > self.max_age]
        for sid in expired:
            del self._sessions[sid]
        if len(self._sessions) >= self.max_sessions:
            oldest = sorted(self._sessions.values(), key=lambda s: s.last_seen)[: self.max_sessions // 10 or 1]
            for s in oldest:
                del self._sessions[s.id]

    def __len__(self) -> int:
        return len(self._sessions)

"""
Shared state for running several AEGIS server processes (gunicorn/uvicorn
workers, several hosts): replay nonces, rate-limit windows and session records.

MemoryStore (the default) keeps everything in the process, which is correct
for one process. With several, each would see only its own share of a
client's requests: a replayed challenge solution or signed request could be
accepted once per process, and a rate limit of N would be N per process.
RedisStore keeps that state in Redis, where all processes see it.

Same key layout and semantics as the Node store (packages/core/src/store/Store.ts),
so a Python and a Node server can share one Redis.
"""
import itertools
import os
import threading
import time
from collections import OrderedDict
from typing import Any, Callable, List, Optional, Protocol, Tuple

#: Hits kept per window key; beyond this the count saturates instead of growing
MAX_HITS_PER_KEY = 10_000


class Store(Protocol):
    def claim_once(self, key: str, ttl_seconds: float) -> bool:
        """True the first time key is claimed within ttl_seconds, False on every repeat."""

    def hit(self, key: str, window_seconds: float) -> int:
        """Record a hit and return the hits in the last window_seconds, this one included."""

    def get(self, key: str) -> Optional[str]: ...

    def set(self, key: str, value: str, ttl_seconds: float) -> None: ...

    def close(self) -> None: ...


class MemoryStore:
    """In-process store (thread-safe).

    Each kind of key (single-use claims, rate windows, values) is kept least
    recently used first and capped at `max_keys`: a client rotating source IPs
    would otherwise grow the rate windows for an hour. Every write drops a few
    expired keys from the front and, at the cap, the least recently used one,
    all O(1) (a periodic full rebuild paused requests for up to 56 ms).
    """

    def __init__(self, max_keys: int = 100_000) -> None:
        self.max_keys = max(1, max_keys)
        self._once: "OrderedDict[str, float]" = OrderedDict()
        self._windows: "OrderedDict[str, List[float]]" = OrderedDict()
        self._values: "OrderedDict[str, Tuple[str, float]]" = OrderedDict()
        self._lock = threading.Lock()

    def claim_once(self, key: str, ttl_seconds: float) -> bool:
        now = time.time()
        with self._lock:
            expires = self._once.pop(key, None)
            if expires is not None and expires > now:
                self._once[key] = expires
                return False
            self._make_room(self._once, lambda v: v <= now)
            self._once[key] = now + ttl_seconds
            return True

    def hit(self, key: str, window_seconds: float) -> int:
        now = time.time()
        with self._lock:
            previous = self._windows.pop(key, None)
            self._make_room(self._windows, lambda v: not v or v[-1] <= now - 3600)
            hits = [t for t in previous or [] if t > now - window_seconds]
            hits.append(now)
            self._windows[key] = hits[-MAX_HITS_PER_KEY:]
            return len(self._windows[key])

    def get(self, key: str) -> Optional[str]:
        with self._lock:
            entry = self._values.get(key)
            if entry is None:
                return None
            if entry[1] <= time.time():
                del self._values[key]
                return None
            return entry[0]

    def set(self, key: str, value: str, ttl_seconds: float) -> None:
        now = time.time()
        with self._lock:
            self._values.pop(key, None)
            self._make_room(self._values, lambda v: v[1] <= now)
            self._values[key] = (value, now + ttl_seconds)

    def close(self) -> None:
        pass

    def _make_room(self, entries: "OrderedDict[str, Any]", expired: Callable[[Any], bool]) -> None:
        """Before an insert: drop up to 8 expired entries from the front, then the oldest beyond the cap."""
        for _ in range(8):
            if not entries or not expired(next(iter(entries.values()))):
                break
            entries.popitem(last=False)
        while len(entries) >= self.max_keys:
            entries.popitem(last=False)


# Sliding-window log in a sorted set, scored by the Redis server's clock (ms)
_HIT_SCRIPT = """
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local window = tonumber(ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
redis.call('ZADD', KEYS[1], now, ARGV[2])
local count = redis.call('ZCARD', KEYS[1])
local cap = tonumber(ARGV[3])
if count > cap then
  redis.call('ZREMRANGEBYRANK', KEYS[1], 0, count - cap - 1)
  count = cap
end
redis.call('PEXPIRE', KEYS[1], window)
return count"""


class RedisStore:
    """Store in Redis (needs the `redis` package: pip install aegis-server-python[redis])."""

    def __init__(self, client, prefix: str = "aegis:") -> None:
        self.client = client
        self.prefix = prefix
        self._script = client.register_script(_HIT_SCRIPT)
        self._instance = os.urandom(4).hex()
        self._seq = itertools.count()

    def claim_once(self, key: str, ttl_seconds: float) -> bool:
        return bool(self.client.set(f"{self.prefix}once:{key}", "1", px=max(1, int(ttl_seconds * 1000)), nx=True))

    def hit(self, key: str, window_seconds: float) -> int:
        member = f"{self._instance}:{next(self._seq)}"
        return int(self._script(keys=[f"{self.prefix}win:{key}"],
                                args=[max(1, int(window_seconds * 1000)), member, MAX_HITS_PER_KEY]))

    def get(self, key: str) -> Optional[str]:
        value = self.client.get(f"{self.prefix}kv:{key}")
        return value.decode() if isinstance(value, bytes) else value

    def set(self, key: str, value: str, ttl_seconds: float) -> None:
        self.client.set(f"{self.prefix}kv:{key}", value, px=max(1, int(ttl_seconds * 1000)))

    def close(self) -> None:
        self.client.close()


def create_redis_store(url: str, prefix: str = "aegis:") -> RedisStore:
    """Connect to Redis (e.g. redis://localhost:6379/0). Raises if it cannot be reached,
    so a misconfigured deployment fails at startup instead of running with per-process state."""
    try:
        import redis
    except ImportError as exc:  # pragma: no cover - depends on the environment
        raise RuntimeError("AEGIS: the redis package is required for AEGIS_REDIS_URL "
                           "(pip install 'aegis-server-python[redis]')") from exc
    client = redis.Redis.from_url(url, socket_connect_timeout=2, socket_timeout=2)
    try:
        client.ping()
    except redis.RedisError as exc:
        client.close()
        safe = url.split("@")[-1] if "@" in url else url
        raise RuntimeError(f"AEGIS: cannot connect to Redis at {safe}: {exc}") from exc
    return RedisStore(client, prefix)

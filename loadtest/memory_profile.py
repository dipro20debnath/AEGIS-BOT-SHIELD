"""Memory per distinct client in the Python server (in-process state).

    python loadtest/memory_profile.py [clients=20000] [--latency] [--redis=redis://127.0.0.1:6379/5]

Counterpart of memory-profile.cjs: one page request per simulated client (new
IP, no cookie) through AegisMiddlewareBase.evaluate with rate limiting on;
reports traced memory growth and the size of the per-client containers.
With --latency, memory is not traced (tracemalloc slows every allocation) and
the per-request latency distribution is reported instead, to find pauses.
With --redis, state lives in Redis (the database is flushed first).
"""
import gc
import sys
import time
import tracemalloc

sys.path.insert(0, "packages/server-python")
from aegis_shield.middleware import AegisMiddlewareBase  # noqa: E402

ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
N = int(ARGS[0]) if ARGS else 20000
LATENCY = "--latency" in sys.argv
REDIS = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--redis=")), None)
HEADERS = {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    "accept": "text/html", "accept-language": "en-US", "sec-ch-ua": '"Chromium";v="141"', "sec-fetch-dest": "document",
}


def ip(i: int) -> str:
    return f"10.{(i >> 16) & 255}.{(i >> 8) & 255}.{i & 255}"


def main() -> None:
    if REDIS:
        import redis
        redis.Redis.from_url(REDIS).flushdb()
    aegis = AegisMiddlewareBase("s", "profile-secret-0123456789abcdef", mode="monitor", rate_limit=100, redis_url=REDIS)
    aegis.evaluate("GET", "/", "10.255.255.255", HEADERS, {})
    gc.collect()
    if LATENCY:
        times = []
        for i in range(N):
            t = time.perf_counter()
            aegis.evaluate("GET", "/", ip(i), HEADERS, {})
            times.append((time.perf_counter() - t) * 1000)
        times.sort()
        print({"clients": N, "p50Ms": round(times[N // 2], 3), "p99Ms": round(times[int(N * 0.99)], 3),
               "p999Ms": round(times[int(N * 0.999)], 3), "maxMs": round(times[-1], 1),
               "over10Ms": sum(t > 10 for t in times)})
        return
    tracemalloc.start()
    before = tracemalloc.get_traced_memory()[0]
    t0 = time.perf_counter()
    for i in range(N):
        aegis.evaluate("GET", "/", ip(i), HEADERS, {})
    elapsed = time.perf_counter() - t0
    gc.collect()
    after = tracemalloc.get_traced_memory()[0]
    store = aegis._limit_store
    sizes = {"sessions": len(aegis.sessions)} if REDIS else {
        "sessions": len(aegis.sessions),
        "limit_store.windows": len(store._windows),
        "limit_store.values": len(store._values),
        "limit_store.once": len(store._once),
    }
    print({"clients": N, "growthMb": round((after - before) / 2**20, 1), "bytesPerClient": round((after - before) / N),
           "msPerRequest": round(elapsed / N * 1000, 3), "sizes": sizes})


if __name__ == "__main__":
    main()

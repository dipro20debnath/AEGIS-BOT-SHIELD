# Phase F: memory and latency profile of in-process state

Measured 2026-10-03 on the development container (Node 22, CPython 3.11).
Each simulated client sends one page request from a new IP with no cookie, the
worst case for per-client state (an attacker rotating source addresses).
Scripts: `loadtest/memory-profile.cjs` (Node, `AegisNode.evaluate`, rate
limiting on) and `loadtest/memory_profile.py` (Python,
`AegisMiddlewareBase.evaluate`, `rate_limit=100`).

## What was wrong

**Node.** Seven maps grow by one entry per client: token-bucket and
sliding-window limiter keys, IP velocity counters, engine sessions and their
request times, bot-behaviour histories, `AegisNode` session records.
- The limiters and IP counters had only time-based cleanup. Their keys stay
  fresh while an attacker keeps rotating, so they grew without bound.
- `IPAnalyzer.cleanup()` was never scheduled.
- The engine `SessionManager` scanned all sessions on every new client once
  it was full.
- `SessionRecords` cleared **all** sessions at 100k, logging out every user at once.
- In-memory session records never expired.

Measured: 2.9 KB per client, 54.7 MB per 20k clients, linear (the Phase D
observation of ~720 MB RSS after ~100k clients).

**First fix attempt, rejected.** I tried evicting one key at a time with
`map.keys().next()`. Memory was bounded, but at 400k clients the mean
request time went from 0.09 to 0.52 ms. A microbenchmark showed why: V8's
iterator skips the deleted entries at the front of the hash table, so each
eviction cost 24–100 µs. That is quadratic overall.

**Python.**
- Sessions were capped, but each eviction sorted all 100k sessions (pauses up to 75 ms).
- The in-memory rate-limit store had no cap, only an hourly cleanup.
- That cleanup rebuilt every dict every 10,000 operations (pauses up to 56 ms).
- Per-request latency at 300k clients: max **526 ms**; 63 requests over 10 ms.

## Fix

- **Node:** `BoundedMap` (`packages/core/src/utils/bounded.ts`) is a two-generation LRU map.
  - Every operation is O(1).
  - Default bound: 100,000 keys per map (bot behaviour: 50,000).
  - Every key used within the last `max/2` insertions is kept, so a client that
    keeps sending requests keeps its rate-limit state while others rotate.
  - Used by both limiters, the IP counters, the engine sessions, the bot-behaviour
    histories and `SessionRecords`.
  - `SessionRecords` now also expires in-memory records after `sessionTtl` of inactivity.
- **Python:** `SessionTracker` and `MemoryStore` use `OrderedDict`s, least recently used first.
  - Each insert drops up to 8 expired entries from the front and, at the cap
    (`max_keys=100_000`), the least recently used one.
  - No scan, sort or rebuild.

Tests: `packages/core/tests/bounded.test.ts`,
`packages/server-node/tests/sessionRecords.test.ts`, and
`test_memory_store_is_bounded_under_ip_rotation` in the Python tests.

## Results

### Node (`node --expose-gc loadtest/memory-profile.cjs N`)

| Clients | Heap growth | Mean ms/request | p99 ms | Max ms | Requests > 10 ms |
|---:|---:|---:|---:|---:|---:|
| 20,000 | 54.7 MB | 0.088 | 0.25 | 8.0 | 0 |
| 100,000 | 127 MB | 0.083 | 0.21 | 16.7 | 5 |
| 400,000 | 127 MB | 0.084 | 0.20 | 20.0 | 14 |
| *400,000, per-key eviction (rejected)* | *271 MB* | *0.516* | – | – | – |

Below the bound, memory is the same as before the fix: 2.9 KB per client. After
that it stays between half and all of the bound, about **127–250 MB** for all
maps. The remaining tail is V8 garbage collection.

### Python (`python loadtest/memory_profile.py N [--latency]`)

| Clients | Variant | p50 ms | p99 ms | p99.9 ms | Max ms | Requests > 10 ms |
|---:|---|---:|---:|---:|---:|---:|
| 300,000 | before | 0.039 | 0.117 | 0.659 | 525.7 | 63 |
| 300,000 | after | 0.043 | 0.108 | 0.296 | 105.6 | 9 |
| 100,000 | after, in-process | 0.042 | 0.123 | 0.472 | 119.5 | 9 |
| 100,000 | after, Redis store | 0.193 | 0.435 | 1.442 | 13.4 | 2 |

Memory (tracemalloc): about 1 KB per client up to the bounds. At 200k clients
the total was 92 MB, with 90k sessions and 50k rate windows.

**What causes the remaining Python pauses.** With gc callbacks attached,
everything above 10 ms after the fix lines up with CPython's full (gen-2)
collections: 7 collections in 300k requests, up to 106 ms. That cost scales
with the number of live session objects. Keeping state in Redis removes it:
max 13 ms, at the price of a Redis round trip on every request (p50 0.04 →
0.19 ms). This probably also explains the high FastAPI p99 seen in Phase D
(THESIS_NOTES §2.11, finding 5), but that was not re-measured over HTTP.

## Limits

- Single process, synthetic clients, no HTTP layer. The numbers isolate the
  AEGIS state, not a deployment.
- The bound trades memory for state. Under a flood of more than ~50k new IPs
  between two requests of the same client, that client's rate-limit window
  restarts. Use Redis for exact limits under such load.
- `--max-old-space-size` and container memory limits should leave room for
  ~250 MB of AEGIS state per Node process at the default bounds.

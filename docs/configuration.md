# Configuration reference

Every option of every component, with its default and what it does. Options
that exist in a type but are **not read by the code yet** are listed as
*reserved*, so you do not tune something that has no effect.

- [Browser SDK](#browser-sdk-aegisjs-sdk)
- [Python server (`aegis_shield`)](#python-server-aegis_shield)
- [Node server (`AegisNode`)](#node-server-aegisnode)
- [Detection engine (`engine` option, `@aegis/core`)](#detection-engine-engine-option-aegiscore)
- [Shared state (Redis)](#shared-state-redis)
- [Status API, GraphQL, live feed (Node)](#status-api-graphql-live-feed-node)
- [Edge worker (Cloudflare)](#edge-worker-cloudflare)
- [ML service and training](#ml-service-and-training)
- [Dashboard](#dashboard)
- [Docker Compose](#docker-compose)

The secret (`secret_key` / `secretKey` / `AEGIS_SECRET_KEY`) must be at least
16 characters; use 32+ random bytes. Every origin instance and the edge worker
need the same value.

---

## Browser SDK (`@aegis/js-sdk`)

Script tag (`dist/aegis.min.js`, global `Aegis`):

```html
<script src="/sdk/aegis.min.js" data-site-key="my-site"></script>
```

| Attribute | Effect |
|---|---|
| `data-site-key` | Starts a client automatically (`Aegis.client`). Without it, create one with `new Aegis.AegisClient({...})`. |
| `data-endpoint` | Server base URL (default: the page's origin) |
| `data-beacon="true"` | `beaconOnExit` |
| `data-debug="true"` | `debug` |

`new AegisClient(options)`:

| Option | Default | Effect |
|---|---|---|
| `siteKey` | required | Must equal the server's site key, or telemetry is refused (403) |
| `endpoint` | page origin | Base URL of the AEGIS server |
| `telemetryPath` | `/aegis/telemetry` | |
| `challengePath` | `/aegis/challenge` | |
| `autoStart` | `true` | Start collectors and send the first telemetry on construction |
| `autoIntercept` | `true` | Add `X-Aegis-Token` to this site's `fetch`/XHR requests |
| `allowedOrigins` | `[]` | Extra origins whose requests also get the token (never third parties you do not control) |
| `interceptHeaders` | `[]` | Extra headers to add to intercepted requests |
| `collectMouse`, `collectKeyboard`, `collectScroll`, `collectTouch` | `true` | Behaviour collectors |
| `fingerprint` | `true` | WebGL/canvas/plugin signals and a SHA-256 device hash |
| `detectHeadless` | `true` | Headless-browser checks |
| `detectAntiDetect` | `true` | Anti-detect consistency checks (includes a WebGPU adapter probe) |
| `autoChallenge` | `true` | On a 403 `challenge` response to `fetch`, solve the proof of work and retry once |
| `beaconOnExit` | `false` | Send a final report with `sendBeacon` when the page is hidden |
| `streamId` | random per page | Id of this page view's telemetry stream; set it to join telemetry with other per-page data (the study site does, with its raw events) |
| `debug` | `false` | Log events to the console |

The proof-of-work solver uses WebAssembly when the page's CSP allows
`'wasm-unsafe-eval'`, otherwise a slower JavaScript implementation.

---

## Python server (`aegis_shield`)

Keyword arguments of `AegisFastAPIMiddleware`, `AegisFlaskMiddleware`,
`AegisDjangoMiddleware` (Django: `settings.AEGIS = {...}`) and
`AegisMiddlewareBase`. Validated by `AegisConfig` (pydantic).

| Option | Default | Effect |
|---|---|---|
| `site_key` | required | Site identifier the SDK sends |
| `secret_key` | required | Signs and encrypts tokens and challenges (≥ 16 characters) |
| `mode` | `"enforce"` | `"monitor"`: score and log, never deny |
| `block_threshold` | `80` | Score ≥ this → `block` |
| `challenge_threshold` | `50` | Score ≥ this → `challenge` |
| `protected_paths` | `None` (all) | Only analyse these path prefixes |
| `excluded_paths` | `["/health", "/favicon.ico"]` | Never analysed |
| `require_token_paths` | `[]` | Prefixes that need a token backed by telemetry |
| `fail_open` | `True` | On an internal error, allow the request (`False`: challenge it) |
| `telemetry_path` | `"/aegis/telemetry"` | |
| `challenge_path` | `"/aegis/challenge"` | |
| `token_ttl` | `300` | Token lifetime, seconds |
| `ml_model_path` | `None` | Trained `BotClassifier` pickle, loaded in-process |
| `ml_url` | `None` | ML service base URL (`POST {ml_url}/predict`, 0.5 s timeout) |
| `trusted_proxies` | `[]` | IPs/CIDRs whose `X-Forwarded-For` is trusted |
| `secure_cookies` | `False` | Add `Secure` to the `aegis_sid` cookie; set it when the site is served over HTTPS |
| `verify_search_engines` | `False` | Confirm Googlebot/Bingbot claims by reverse DNS (blocking lookups) |
| `max_telemetry_bytes` | `65536` | Larger bodies get 413 |
| `input_validation` | `True` | XSS/SQLi/CRLF/path-traversal/prototype-pollution checks on path and query |
| `session_patterns` | `True` | Timer-regular paging, ID enumeration, 4xx probing per session |
| `pow_n`, `pow_r`, `pow_bits` | `4096`, `8`, `4` | scrypt cost and difficulty (memory per attempt = 128·r·n bytes; ≈ 2^bits attempts) |
| `live_feeds` | `False` | Download the Tor exit list and threat feeds (network access) |
| `feeds` | all four | Subset of `tor`, `firehol_level1`, `spamhaus_drop`, `abuseipdb` |
| `feed_cache_dir` | `None` | On-disk copies of the lists |
| `abuseipdb_key` | `None` | AbuseIPDB key (or env `ABUSEIPDB_API_KEY`) |
| `redis_url` | `None` | Shared state in Redis ([below](#shared-state-redis)) |
| `rate_limit` | `0` (off) | Requests per client IP per `rate_limit_window` before `rate_limit.exceeded` (score 100); telemetry gets 429 |
| `rate_limit_window` | `60` | Seconds |
| `endpoint_limits` | `{}` | Per-prefix limits, e.g. `{"/api/login": [5, 60]}` (5 per 60 s per IP) |
| `health_path` | `"/aegis/health"` | Liveness endpoint answered by the middleware (`None` disables) |
| `ready_path` | `"/aegis/ready"` | Readiness: 503 while the shared store is unreachable (`None` disables) |
| `metrics_path` | `None` | Prometheus metrics, e.g. `"/aegis/metrics"`; needs the `[metrics]` extra. Off by default: protect it |
| `logging_enabled` | `True` | *Reserved:* not read yet |

Constructor-only arguments (not in `AegisConfig`):

| Argument | Effect |
|---|---|
| `store` | A `Store` object (e.g. `create_redis_store(url)`); overrides `redis_url` |
| `scorer` | A custom `MLScorer` (overrides `ml_model_path`/`ml_url`) |
| `reputation` | A custom `IPReputation` (live lists) |
| `on_record` | Callback receiving each scored telemetry record (for research logging; you are responsible for consent and retention) |

Environment variables read by `get_config()`:

| Variable | Option |
|---|---|
| `AEGIS_SITE_KEY`, `AEGIS_SECRET_KEY` | `site_key`, `secret_key` |
| `AEGIS_MODE` | `mode` |
| `AEGIS_BLOCK_THRESHOLD`, `AEGIS_CHALLENGE_THRESHOLD` | thresholds |
| `AEGIS_FAIL_OPEN` | `fail_open` (`true`/`false`) |
| `AEGIS_ML_MODEL_PATH`, `AEGIS_ML_URL` | `ml_model_path`, `ml_url` |
| `AEGIS_TRUSTED_PROXIES` | `trusted_proxies` (comma-separated) |
| `AEGIS_SECURE_COOKIES` | `secure_cookies` (`true`/`false`) |
| `AEGIS_REDIS_URL` | `redis_url` |
| `AEGIS_RATE_LIMIT` | `rate_limit` |
| `AEGIS_METRICS_PATH` | `metrics_path` |
| `ABUSEIPDB_API_KEY` | AbuseIPDB key when live feeds are on |

---

## Node server (`AegisNode`)

`new AegisNode(options)`, `aegisExpress(options, shared?)`,
`aegisFastify` (plugin options), `aegisGeneric(options)` for plain `http`.

| Option | Default | Effect |
|---|---|---|
| `siteKey`, `secretKey` | required | As in Python |
| `mode` | `'enforce'` | `'monitor'` never denies |
| `thresholds` | `{ block: 80, challenge: 50 }` | |
| `protectedPaths` | all | Only analyse these prefixes |
| `excludedPaths` | `['/health', '/favicon.ico']` | Never analysed |
| `requireTokenPaths` | `[]` | Prefixes that need a token backed by telemetry |
| `telemetryPath`, `challengePath` | `/aegis/telemetry`, `/aegis/challenge` | |
| `tokenTtl` | `300` | Seconds |
| `mlUrl` | none | ML service base URL |
| `mlTimeoutMs` | `500` | |
| `maxTelemetryBytes` | `65536` | |
| `pow` | `{ n: 4096, r: 8, bits: 4, ttlSeconds: 120 }` | Proof-of-work cost |
| `store` | in-process | Shared state, e.g. `await createRedisStore(url)` |
| `sessionTtl` | `1800` | Session record lifetime after the last request, seconds |
| `secureCookies` | `false` | Add `Secure` to the `aegis_sid` cookie; set it when the site is served over HTTPS |
| `engine` | defaults | Extra detection-engine configuration ([below](#detection-engine-engine-option-aegiscore)) |
| `processMetrics` | `true` | Include process metrics (CPU, memory, event loop, GC) in `/aegis/metrics` |

Express adapter extras: `onDeny(req, res, decision)` (custom denial
response), `onDecision(req, decision)` (called for every analysed request).
The decision is available as `req.aegis` in your handlers.

There is no `get_config()` equivalent in Node; the examples read
`AEGIS_SITE_KEY`, `AEGIS_SECRET_KEY`, `AEGIS_ML_URL`, `AEGIS_REDIS_URL` and
`PORT` themselves (`examples/express-integration/server.js`).

---

## Detection engine (`engine` option, `@aegis/core`)

Passed through `AegisNode({ engine: {...} })` (deep-merged with the
defaults). The engine always runs in monitor mode inside `AegisNode`; the
verdict comes from `AegisNode.thresholds`.

**Effective options**

| Option | Default | Effect |
|---|---|---|
| `rateLimiting.enabled` | `true` | Per-IP token bucket + sliding window + endpoint limits |
| `rateLimiting.maxRequests`, `windowMs` | `100`, `60000` | Sliding window per IP |
| `rateLimiting.perIpCapacity`, `perIpRefillRate` | `50`, `5`/s | Token bucket per IP (in-process only; with a shared store only the windows are enforced) |
| `rateLimiting.endpointLimits` | `/login` 5/min, `/register` 3/min, `/api/checkout` 10/min | Exact path match |
| `ipIntelligence.enabled` | `true` | Datacenter/VPN/Tor/reputation signals |
| `ipIntelligence.blocklist`, `allowlist` | `[]` | IPs always blocked / never analysed for IP signals |
| `ipIntelligence.abuseIpDbKey` | none | AbuseIPDB lookups (also env `ABUSEIPDB_API_KEY`) |
| `ipIntelligence.externalGeoLookup` | `false` | Geo/ASN from an external API (sends client IPs to a third party) |
| `ipIntelligence.liveFeeds` | off | `{ tor, threatFeeds, cacheDir }`: downloaded lists |
| `behavioral.enabled` | `true` | Rule checks on SDK behaviour summaries |
| `challenges.defaultType` | `'pow'` | Label on challenge decisions |
| `modules.*` | all `true` | Switch modules off: `rateLimiter`, `ipIntelligence`, `tlsFingerprint`, `headerAnalysis`, `http2Fingerprint`, `sessionTracking`, `honeypot`, `threatIntel`, `behavioral`, `inputValidation`, `sessionBehavior` |

**Reserved (in the type, not read yet):** `redisUrl` (use `store`),
`behavioral.minSignals`, `behavioral.weights`, `challenges.enabled`,
`challenges.powDifficulty`, `challenges.timeoutMs`, `challenges.gracePeriodMs`,
`challenges.wasmEnabled`, `challenges.patEnabled`, `logging.*`,
`rateLimiting.adaptive`, `ipIntelligence.blockVPN`, `blockTor`,
`blockDatacenter`, `detectResidentialProxy` (their signals are always
scored), `modules.challenges`, `thresholds`/`mode` (AegisNode decides).

---

## Shared state (Redis)

| | Python | Node |
|---|---|---|
| Enable | `redis_url="redis://host:6379/0"` or `AEGIS_REDIS_URL`; or `store=create_redis_store(url)` | `store: await createRedisStore(url)` |
| Install | `pip install "aegis-server-python[redis]"` | included (`ioredis`) |
| Key prefix | `aegis:` (second argument of `create_redis_store`/`createRedisStore`) | same |

Keys: `aegis:once:*` (replay, TTL), `aegis:win:*` (rate-limit windows),
`aegis:kv:sess:*` (sessions, TTL `sessionTtl`/30 min). Use one database or
prefix per site. Startup fails if Redis is unreachable; see the
[whitepaper](security-whitepaper.md#46-availability-and-failure-behaviour) for
outage behaviour.

---

## Status API, GraphQL, live feed (Node)

| Function | Options |
|---|---|
| `aegisRoutes(aegis)` | Mounts `/aegis/health`, `ready`, `metrics`, `stats`, `events`, `config`, `verify`, `graphql`, `openapi.json`, `docs`. No options; put it behind authentication (keep `health`/`ready` reachable for probes). |
| `aegisGraphQL(aegis, { introspection })` | `introspection` (default `true`). Fixed limits: 8 KB documents, 10 root fields, `limit` ≤ 500. |
| `attachLiveFeed(server, aegis, options)` | `path` (`/aegis/live`), `authorize` (`(req) => boolean`), `allowedOrigins`, `flushMs` (250), `maxBatch` (200), `maxClients` (100), `heartbeatMs` (30000) |

---

## Edge worker (Cloudflare)

`packages/edge-cloudflare/wrangler.toml` `[vars]`, secrets with
`wrangler secret put`:

| Variable | Default | Effect |
|---|---|---|
| `AEGIS_SECRET_KEY` (secret) | required | Same as the origin |
| `AEGIS_REQUIRE_TOKEN_PATHS` | none | Comma-separated prefixes that need a valid token at the edge |
| `AEGIS_EXCLUDED_PATHS` | none | Passed through untouched |
| `AEGIS_BLOCK_THRESHOLD` | `80` | Tokens with score ≥ this are refused |
| `AEGIS_TOKEN_TTL` | `300` | Maximum token age |
| `AEGIS_MODE` | `enforce` | `monitor` only annotates `X-Aegis-Edge` |
| `AEGIS_ORIGIN` | none | Origin base URL; unset = route mode on your zone |
| `AEGIS_RATE_LIMIT` | `120` | Per-isolate fallback limit per IP per minute (0 = off), used without the binding |
| `AEGIS_TELEMETRY_PATH`, `AEGIS_CHALLENGE_PATH` | `/aegis/telemetry`, `/aegis/challenge` | Passed through to the origin |
| `AEGIS_RATE_LIMITER` (binding) | `limit = 120, period = 60` | Workers Rate Limiting binding (`[[ratelimits]]`) |

---

## ML service and training

| Variable | Default | Effect |
|---|---|---|
| `MODEL_PATH` | `./models/bot_classifier.pkl` | Model loaded by `aegis_ml.server` |
| `MODEL_OUTPUT_DIR` | `./models` | Where `POST /train` writes models (no authentication: keep the service internal) |

Training and experiments: see [ML_MODEL_GUIDE.md](ML_MODEL_GUIDE.md).

---

## Dashboard

| Variable | Default | Effect |
|---|---|---|
| `AEGIS_API` | `http://localhost:3000` | Node server the Vite dev server proxies `/aegis` (HTTP and WebSocket) to |

In Docker, nginx proxies `/aegis/` and the `/aegis/live` WebSocket to `api-node`.

---

## Docker Compose

`.env` (copy `.env.example`): `AEGIS_SITE_KEY`, `AEGIS_SECRET_KEY` (required),
`AEGIS_MODE`. Compose sets `AEGIS_REDIS_URL` per service (`/0` Node, `/1`
Python) and `AEGIS_ML_URL` for the Node API.

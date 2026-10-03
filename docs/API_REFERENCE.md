# API reference

- [HTTP API](#http-api)
- [Browser SDK](#browser-sdk-aegisjs-sdk)
- [Node server](#node-server-aegisserver-node)
- [Core library](#core-library-aegiscore)
- [Python server](#python-server-aegis_shield)
- [ML engine](#ml-engine-aegis_ml)

Options of every constructor are in [configuration.md](configuration.md).

---

## HTTP API

The machine-readable contract is [`contracts/openapi.json`](../contracts/openapi.json)
(OpenAPI 3.1). Both servers are tested against it. A running Node server
serves it at `/aegis/openapi.json`, with Swagger UI at `/aegis/docs`. In
FastAPI, `add_aegis_openapi(app)` adds the middleware endpoints to `/docs`.

| Method and path | Answered by | Purpose |
|---|---|---|
| `POST /aegis/telemetry` | both servers | SDK telemetry → `{token, expiresIn, verdict, score}` + session cookie. Errors: 400, 403 (site key), 413, 429 (Python rate limit), 500 |
| `GET /aegis/challenge` | both servers | `{challenge, seed, n, r, bits, expiresAt}` |
| `POST /aegis/challenge` | both servers | `{challenge, nonce}` → `{token, expiresIn, verdict}`; 403 `{error, reason}`; 503 if the shared store is down |
| any protected path | both servers | denied: `403 {aegis: "block"|"challenge", telemetry?, challenge?}`, header `X-Aegis-Action` |
| `GET /aegis/health` | both servers (Python: `health_path`) | liveness `{status: "ok"}` |
| `GET /aegis/ready` | both servers (Python: `ready_path`) | readiness: 200, or 503 while the shared store is unreachable |
| `GET /aegis/metrics` | Node `aegisRoutes`; Python with `metrics_path` | Prometheus text format (metric list in the README, Monitoring) |
| `GET /aegis/stats`, `events?limit=`, `config` | Node `aegisRoutes` | status API |
| `POST /aegis/verify` | Node `aegisRoutes` | `{token}` → 200 `{valid, score, verdict}` / 401 `{valid: false}` |
| `GET, POST /aegis/graphql` | Node `aegisRoutes` | read-only GraphQL |
| `GET /aegis/openapi.json`, `/aegis/docs` | Node `aegisRoutes` | this API's documentation |
| `WS /aegis/live` | Node `attachLiveFeed` | live decisions (below) |

**GraphQL schema** (read-only):

```graphql
type Query {
  health: Health!
  stats: Stats!                     # counters since process start
  events(limit: Int = 100, verdict: Verdict, pathPrefix: String, minScore: Float, signal: String): [Event!]!
  threats(limit: Int = 10): [ReasonCount!]!   # signals behind denied requests
  config: Config!
}
enum Verdict { allow monitor challenge block }
type Event { timestamp: Float! path: String! verdict: Verdict! score: Float! reasons: [String!]! ipPrefix: String! telemetry: Boolean! }
```

**Live feed messages** (JSON, server → client): `{type: "hello", summary,
events}` on connect; `{type: "events", events, dropped}` every 250 ms while
there is traffic; `{type: "summary", summary}` at most every 2 s.

---

## Browser SDK (`@aegis/js-sdk`)

Script-tag build: global `Aegis` (`Aegis.AegisClient`, `Aegis.client` when
started from `data-site-key`).

### `AegisClient`

| Member | Description |
|---|---|
| `new AegisClient(config)` | Starts automatically unless `autoStart: false` |
| `start(): Promise<void>` | Start collectors, run headless/anti-detect checks, send the first telemetry; emits `ready` |
| `stop(): void` | Stop collectors and interception; emits `stopped` |
| `collect(): TelemetryPayload` | The payload that would be sent now |
| `submit(): Promise<TelemetryResponse>` | Send telemetry now; emits `token` |
| `getToken(): Promise<string>` | A valid token (sends telemetry when there is none or it expired) |
| `solveChallenge(challenge): Promise<ChallengeResponse>` | Solve a challenge object yourself |
| `getAntiDetectResult()` | Result of the anti-detect checks, or `null` |
| `reset(): void` | Forget the token and collected data |
| `on(event, handler)`, `off(event, handler)` | Events: `ready`, `token` (`TelemetryResponse`), `challenge` (solution), `error`, `stopped` |

`TelemetryResponse`: `{ token, expiresIn, verdict, score }`.

Lower-level exports (for custom integrations and tests): `buildTelemetry`,
`MouseCollector`, `KeyboardCollector`, `ScrollCollector`, `TouchCollector`,
`HeadlessDetector`, `AntiDetectDetector`, `evaluateAntiDetect`,
`DeviceFingerprinter`, `WebGPUFingerprinter`, `solveMemoryHard`, `scrypt`,
`TokenManager`, `RequestInterceptor`.

---

## Node server (`@aegis/server-node`)

### `AegisNode`

Framework-independent logic used by every adapter.

| Member | Description |
|---|---|
| `new AegisNode(options)` | Throws if `secretKey` is shorter than 16 characters |
| `evaluate(req: RequestInfo)` | → `{ decision: AegisDecision, headers }` for a protected request |
| `handleEndpoint(req)` | Answers `/aegis/telemetry` and `/aegis/challenge` → `HandlerResponse {status, body, headers}` |
| `handleTelemetry(req)`, `handleChallenge(req)` | The two endpoints individually |
| `isAegisEndpoint(method, path)`, `shouldProtect(path)` | Routing helpers |
| `denial(decision)` | The 403 response for a denied decision |
| `recordResponse(decision, status)` | Report the status you sent (feeds the 4xx-probing check) |
| `decide(score)` | Verdict for a score under the configured thresholds and mode |
| `stats` | `AegisStats`: `summary()`, `recent(limit)`, emits `event` |
| `sessions` | `SessionRecords`: `get(id)` |
| `shutdown()` | Stop timers and the engine |

`RequestInfo`: `{ method, path, ip, headers, cookies?, query?, body? }`.
`AegisDecision`: `{ verdict, score, reasons[], claims, signals[] }`.

### Adapters and helpers

| Export | Description |
|---|---|
| `aegisExpress(options, shared?)` | Express middleware; `req.aegis` = decision; `.aegis` = the `AegisNode` |
| `aegisFastify` (from `dist/middleware/fastify`) | Fastify plugin; `request.aegis` |
| `aegisGeneric(options, shared?)` | `(req, res, next)` middleware for `http`/Connect |
| `aegisRoutes(aegis)` | Express router: status API, GraphQL, OpenAPI, Swagger UI |
| `aegisGraphQL(aegis, options)`, `buildSchema(aegis)` | GraphQL handler and schema |
| `attachLiveFeed(server, aegis, options)` | WebSocket feed → `{ wss, clientCount(), close() }` |
| `openapiSpec`, `serveOpenapi`, `serveSwaggerUi`, `swaggerUiHtml(url)` | OpenAPI document and UI |
| `aegisRequireSignature(secret, maxSkewSeconds?, store?)` | Express middleware rejecting unsigned/replayed server-to-server calls |
| `aegisSecurityHeaders(options)` | Express middleware setting security headers |
| `MemoryStore`, `RedisStore`, `createRedisStore(url, prefix?)` | Shared state (re-exported from core) |
| `noisyOr(scores)`, `userAgentHash(ua)`, `parseCookies(header)`, `maskIp(ip)` | Utilities |

---

## Core library (`@aegis/core`)

| Export | Description |
|---|---|
| `DetectionEngine` | `init()`, `analyze(request: AegisRequest) → AegisResult` (`riskScore`, `signals`, `verdict`, `threats` (OAT labels), `sessionToken`), `recordResponse()`, `on(event)`, `shutdown()` |
| `RiskScorer` | Category means + noisy-OR fusion |
| `classifyThreats(signals, path)` | OWASP OAT labels for a set of signals |
| `generateToken(claims, secret)`, `verifyToken(token, secret, maxAgeSeconds)` | Token format shared with Python and the edge |
| `hmacSign`, `hmacVerify`, `aesEncrypt`, `aesDecrypt`, `sha256`, `NonceCache` | Crypto helpers |
| `MemoryHardChallenger` | `issue()`, `verify(challenge, nonce)`; options `{n, r, bits, ttlSeconds, store}` |
| `AntiTamper`, `signRequest`, `parseSignatureHeader` | Signed requests; `verify()` (in-process nonces), `verifyAsync()` (shared store) |
| `InputValidator` | `analyze({path, query, body, headers}) → {findings, signals}` |
| `securityHeaders(options)`, `DEFAULT_CSP` | Header values |
| `AegisStore`, `MemoryStore`, `RedisStore`, `createRedisStore` | `claimOnce`, `hit`, `get`, `set`, `close` |
| `IPAnalyzer`, `TorExitNodeChecker`, `ThreatFeedSync`, `ThreatDatabase` | IP intelligence and live lists |
| `SlidingWindowLimiter`, `TokenBucketLimiter` | Rate limiters |
| `SessionManager`, `BotBehaviorAnalyzer`, `HoneypotDetector` | Sessions, request-sequence patterns, honeypots |
| `HeaderAnalyzer`, `TLSFingerprinter`, `HTTP2Fingerprinter` | Protocol fingerprints |
| `QUICFingerprinter`, `QuicInitialAssembler`, `fingerprintQuicDatagrams`, `readPcapUdp` | Offline QUIC/HTTP3 fingerprints (JA4 `q`, transport parameters) |

---

## Python server (`aegis_shield`)

| Export | Description |
|---|---|
| `AegisFastAPIMiddleware(app, site_key, secret_key, **options)` | ASGI middleware; decision in `request.state.aegis` |
| `AegisFlaskMiddleware(app=None, **options)` | `init_app(app)`; decision in `g.aegis` |
| `AegisDjangoMiddleware` | Configured by `settings.AEGIS`; decision in `request.aegis` |
| `AegisMiddlewareBase(site_key, secret_key, *, scorer, on_record, reputation, store, **options)` | Framework-independent logic: `evaluate(method, path, remote_addr, headers, cookies, query) → (AegisResult, headers)`, `handle_endpoint(...)`, `handle_telemetry(...)`, `handle_challenge(...)`, `denial(result)`, `record_response(result, status)` |
| `AegisResult` | `action`, `score`, `reason`, `payload` (claims), `is_bot`, `session_id`, `error` |
| `AegisConfig` | Validated options (pydantic) |
| `get_config()` | Options from `AEGIS_*` environment variables |
| `TokenVerifier(secret, max_token_age=300, single_use=False, store=None)`, `generate_token(claims, secret)` | Tokens |
| `AntiTamper(secret, max_skew_seconds=300, store=None)`, `sign_request(...)`, `SIGNATURE_HEADER` | Signed requests |
| `InputValidator` | `analyze(path, query, body, headers) → (findings, signals)` |
| `security_headers(...)`, `SecurityHeadersMiddleware` | Security headers (dict / ASGI middleware) |
| `MemoryStore`, `RedisStore`, `create_redis_store(url, prefix="aegis:")`, `Store` | Shared state |
| `openapi_spec()`, `add_aegis_openapi(app)` | OpenAPI document; merge into FastAPI's `/docs` |
| `MLScorer`, `make_scorer(model_path, ml_url)` | ML scoring (custom scorers subclass `MLScorer.score(features)`) |
| `RequestAnalyzer`, `noisy_or` | Request signals and fusion |

---

## ML engine (`aegis_ml`)

| Export | Description |
|---|---|
| `aegis_ml.inference.InferenceEngine(model_path)` | `predict(client_id, data) → (probability, is_bot)`, `explain(data, top_k=5)`, `get_metrics()`, `is_loaded` |
| `aegis_ml.models.classifier.BotClassifier` | `train(X, y)`, `predict_proba(X)`, `tune_threshold(...)`, `save(path)`, `load(path)` |
| `aegis_ml.features.extractor.FeatureExtractor` | `extract(record)`, `extract_batch(records)` → 50-feature vectors |
| `aegis_ml.training.training.TrainingPipeline(output_dir)` | `train(records, labels, max_fpr=0.02)`, group ablation, reports, plots |
| `aegis_ml.training.synthetic_generator.SyntheticDataGenerator` | Synthetic humans and five bot types |
| `aegis_ml.evaluation` | `compare.compare_models`, `compare.leave_one_type_out`, `stats.metric_with_ci` (bootstrap CIs), `explain.ShapExplainer`, `plots` |
| `aegis_ml.trajectories`, `aegis_ml.models.sequence_models` | Raw mouse-trajectory simulator, 1D-CNN/conv-LSTM (research) |
| `aegis_ml.server:app` | FastAPI service: `POST /predict`, `POST /train`, `GET /health`, `GET /metrics` |

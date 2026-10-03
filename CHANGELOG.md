# Changelog

All notable changes. Versions follow [Semantic Versioning](https://semver.org/);
nothing has been published to npm or PyPI yet (see [docs/RELEASING.md](docs/RELEASING.md)).

## [1.0.0] — prepared, not yet tagged

The first complete version: everything below, Phases A–F. The tag and the GitHub
release are made by the maintainer after this is merged; publishing to npm/PyPI
is a separate step ([docs/RELEASING.md](docs/RELEASING.md)).

### Phase F: production readiness
- **Self pen-test.** `bots/` has seven bot clients (python-requests in three
  modes, Scrapy, Selenium, Puppeteer-stealth, Playwright stealth and human-like) and
  a runner that reports pass rates and signals per server.
  - The results are in `docs/thesis/results/phase_f/`.
  - Fixed from the findings:
    - Telemetry claiming more interaction time than the session has existed is
      flagged (`telemetry.impossible_timing`). This stopped header-forging bots.
    - The Node header check no longer flags `Accept: */*` on fetch/XHR requests.
      That was a false positive on real browsers.
  - Still passing, documented: a forger that waits, Puppeteer-stealth (score just
    under the challenge threshold), and human-like Playwright (only after the
    proof of work).
- **Memory bounds.**
  - Per-client in-process state no longer grows without limit when clients rotate IPs.
  - Node: rate-limit buckets and windows, IP counters, sessions and bot-behaviour
    histories use an O(1) least-recently-used map (`BoundedMap`, default 100,000 keys).
  - In-memory session records expire after `sessionTtl` instead of being cleared all at once at 100k.
  - Python: sessions and the in-memory store use O(1) LRU eviction instead of
    sorts and full rebuilds. The longest pause at 300k clients fell from 526 to 106 ms.
- **Monitoring.**
  - Prometheus metrics at `/aegis/metrics` in both servers, with the same names:
    decisions, signals, decision latency, ML errors, store errors, sessions,
    live-feed clients, process metrics.
  - `/aegis/ready` (503 while Redis is unreachable) next to `/aegis/health`.
  - Python options: `health_path`, `ready_path`, `metrics_path` (`AEGIS_METRICS_PATH`);
    extra `aegis-server-python[metrics]`.
- **Kubernetes.**
  - Helm chart `deploy/helm/aegis` with probes, Secret, HPA, PDBs, NetworkPolicies,
    Prometheus annotations or a ServiceMonitor, Ingress, non-root read-only pods,
    and a `helm test` smoke test.
  - Plain manifests rendered from it; tested on kind; CI lints and renders the chart.
- The dashboard image now runs unprivileged nginx on port 8080 (compose maps 8080:8080).

### Phase E: documentation and release readiness
- OpenAPI 3.1 contract for every AEGIS endpoint (`contracts/openapi.json`), served by
  the Node status API with Swagger UI (`/aegis/docs`) and merged into FastAPI's
  `/docs` (`add_aegis_openapi`); contract tests validate real responses of both servers
  and the SDK's telemetry payload.
- **Security:** tokens are now bound to the `aegis_sid` session as well as the user
  agent (`token_session_mismatch`), in both servers and the edge worker.
- Rewritten security whitepaper (threat model, OWASP OAT mapping: 6 of 21 labelled),
  getting started, configuration reference (reserved options marked), integration guide,
  API reference, architecture, ML guide; tests keep the OAT table, option lists and
  links in sync with the code.
- npm and PyPI metadata, per-package READMEs and licences, `npm run release:check`.

### Phase D: performance and integration (#9)
- Shared state in Redis for several instances (replay nonces, rate limits, sessions),
  Node and Python; Redis outages degrade without bypassing analysis.
- WebSocket live feed and live dashboard; read-only GraphQL API.
- Cloudflare Worker edge adapter.
- Load tests: ≈0.2 ms server time per request for the rule pipeline.

### Phase C: enhanced ML (#8)
- Model comparison with bootstrap CIs, leave-one-bot-type-out, SHAP explanations,
  mouse-trajectory simulator with 1D-CNN/conv-LSTM, publication figures.

### Phase B: security and advanced detection (#1–#7)
- Input-pattern checks, security headers, request signing; Tor and threat feeds,
  session patterns; anti-detect checks, WebGPU, memory-hard WASM proof of work;
  QUIC (HTTP/3) Initial-packet fingerprinting; Docker for all services.

### Phase A: working foundations (#1)
- Core, SDK, both servers and dashboard compile and are tested; end-to-end flow
  browser → SDK → server → ML → token; IRB drafts; CI.

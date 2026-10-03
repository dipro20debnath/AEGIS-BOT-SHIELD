# Changelog

All notable changes. Versions follow [Semantic Versioning](https://semver.org/);
nothing has been published to npm or PyPI yet (see [docs/RELEASING.md](docs/RELEASING.md)).

## [Unreleased] — planned as 1.0.0

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

# AEGIS BOT SHIELD — Project Plan and Handoff

> Status of the cloud session as of 2026-10-03, so work can continue in a local
> IDE. Thesis details (decisions, measurements, limitations) live in
> `docs/thesis/THESIS_NOTES.md`; this file is the plan and the to-do list.

## Status

| Phase | Item | Status |
|---|---|---|
| A | A1–A7: foundations (core, SDK, both servers, dashboard, IRB drafts, CI, e2e) | Done (PR #1, merged) |
| B | B1 InputValidator, SecurityHeaders, AntiTamper | Done (PR #1, merged) |
| B | B2 Tor list, threat feeds, session patterns | Done (PR #2) |
| B | B3 Anti-detect checks, WebGPU, memory-hard WASM challenge | Done (PR #2) |
| B | B4 QUICFingerprinter (Initial-packet parser, real Chromium/aioquic fixtures, pcap CLI) | Done |
| B | B5 Docker for all services + docker-compose, Checkpoint B | **Next** |
| C | SHAP, model comparison, LSTM/CNN on trajectories, publication plots | To do (Oct 16–19) |
| — | **IRB final + submit (supervisor signature)** | **Oct 20–21 (student)** |
| D | Redis, WebSocket, GraphQL, Cloudflare Worker edge, load tests | To do |
| E | OpenAPI, whitepaper, docs | To do |
| F | Self pen-test bots, profiling, Prometheus, K8s/Helm, v1.0.0 | To do |
| G | Data-collection website | To do |

Tests at handoff: core 123, js-sdk 45, server-node 23, server-python 77,
ml-engine 31, e2e 5; lint 0 errors; npm audit 0 vulnerabilities; CI green.

## Working rules
- Commit as `dipro20debnath <dipro20debnath@users.noreply.github.com>`, no co-author lines.
- Branch `claude/keen-cerf-o4qpig`; after a PR is merged, start the next work from the new `main`.
- Every phase: `npm run build && npm test && npm run lint`,
  `python -m pytest packages/ml-engine/tests packages/server-python/tests`, `npm run test:e2e`,
  then update `THESIS_NOTES.md`.
- State limitations honestly; do not claim novelty without a literature check.
- Windows: run pytest with `--basetemp=.pytest_tmp`.

## Original plan (approved 2026-10-02)

# AEGIS BOT SHIELD — Project Completion Plan (Guide Day 10–30), then Website

## Context
আপনি চান website বানানোর আগে guide-এর Day 10–30 সহ পুরো project শেষ হোক। ২ অক্টোবরের audit (`docs/thesis/THESIS_NOTES.md` §0.0) বলছে এখন শুধু ML engine কাজ করে:
- core (TS) ৭৪টা error, js-sdk ৩টা, server-node ১৫টা, dashboard build হয় না
- core-এর test কখনো চলেনি; server-python-এর test নকল class test করে
- `AegisClient` collectors/fingerprinters ব্যবহারই করে না, token-এর signature fake (`SIG123`)
- কোনো server ML engine call করে না; dashboard-এর সব সংখ্যা hardcoded

ভাঙা ভিতের উপর নতুন feature বসানো অর্থহীন, তাই **Phase A (ভিত ঠিক করা) সবার আগে**। তারপর guide-এর ক্রমে Day 10–30, শেষে website।

**Timeline-এর সৎ হিসাব:** মোট আনুমানিক **২৫–৩০ কাজের দিন** (প্রতিদিন session ধরে)। Project শেষ হবে ~৩১ অক্টোবর থেকে ৫ নভেম্বর, website ~১০ নভেম্বর।
**IRB তবু ২১ অক্টোবরেই জমা দেওয়া যাবে।** IRB-তে website-এর code লাগে না, লাগে protocol, consent form আর data dictionary (কী data, কীভাবে)। এগুলো Phase A-তেই বানিয়ে দেব (A6)। Approval আসবে ~৪–১১ নভেম্বর, তখন website-ও তৈরি থাকবে। Human data collection ~১১–২৫ নভেম্বর আগের মতোই চলবে।
ঝুঁকি: Phase-গুলো ২০% বেশি সময় নিলে website ~১৫ নভেম্বরে গড়াবে, আর data collection-এর জন্য মাত্র ~১০ দিন থাকবে। সেজন্য প্রতিটা Phase-এর শেষে checkpoint রাখা আছে (নিচে)।

Commit নিয়ম: author `dipro20debnath <dipro20debnath@users.noreply.github.com>`, কোনো Claude co-author line থাকবে না, branch `claude/keen-cerf-o4qpig`। প্রতিটা Phase-এর পর `THESIS_NOTES.md` আপডেট হবে।

---

## Phase A — ভিত ঠিক করা ও end-to-end জোড়া (৩–৯ অক্টোবর, ~৫–৬ দিন)

**A1. core (TS) compile ও আসল test**
- `src/types/index.ts`-কে source of truth ধরে ৮টা module ঠিক করা হবে। Errors মূলত type drift: `DetectionEngine` (৩০), `GeoIPResolver` (১২, `unknown` narrowing), `HeaderAnalyzer` (১১, category union), `SessionManager` (১০, `ip`/`verdict`/`lastActive` field), `ResidentialProxyDetector`, `AdaptiveRateLimiter`, `HTTP2Fingerprinter`, `IPAnalyzer`।
- `jest`, `ts-jest`, `@types/jest` devDependencies-এ যোগ হবে। `jest.config.js`-এ `.js` extension-এর জন্য `moduleNameMapper` লাগবে (`src/index.ts` NodeNext-এর `.js` import ব্যবহার করে)।
- `tests/*.test.ts` আবার লেখা হবে আসল path (`src/modules/...`) আর আসল API-এর বিরুদ্ধে, যেমন `RiskScorer`-এর আসল method, `utils/crypto.ts`-এর exported function। নকল API-র test বাদ যাবে।

**A2. js-sdk**
- ৩টা error ঠিক করা: `HeadlessDetector.ts:76` (function না call করে check করা হচ্ছে), `RequestInterceptor` `this` type।
- `network/` আর `transport/` duplicate মিলিয়ে একটা রাখা হবে।
- `AegisClient` collectors (Mouse/Keyboard/Scroll/Touch) আর fingerprinters চালু করবে, আর একটা `TelemetryPayload` বানাবে যা **ML extractor-এর snake_case key-এর সাথে মেলে**। Mapping: `avgVelocity` → `mouse_avg_velocity`; `momentumScrolls / eventCount` → `scroll_momentum_ratio`; `multiTouchCount / eventCount` → `touch_multi_touch_ratio`; HeadlessDetector → `is_headless` / `headless_confidence`; WebGL/Canvas → `has_webgl` / `has_canvas`।
- Payload server-এর `/aegis/telemetry` endpoint-এ যাবে।
- `SIG123` fake token বাদ যাবে। **Token থাকবে server-signed:** client telemetry পাঠাবে, server HMAC token দেবে (`AEGIS.v1.{payload}.{sig}`, যে format `server-python/aegis_shield/verifier.py` আগেই verify করে)। Client-এ কোনো secret থাকবে না।
- Browser bundle হবে `esbuild` দিয়ে (`dist/aegis.min.js`, IIFE)।
- Unit test হবে vitest + jsdom দিয়ে (collector math, payload mapping)।

**A3. Server Python = reference server (ML-এর সাথে একই ভাষা)**
- নতুন endpoint দুটো: `POST /aegis/telemetry` → feature dict → ML `InferenceEngine.predict` → `RequestAnalyzer` signal-এর সাথে মিলিয়ে risk score → signed token; আর `GET /aegis/verify`।
- ML engine in-process (import) অথবা HTTP `/predict`, দুভাবেই চলবে। Config দিয়ে বেছে নেওয়া যাবে।
- Session/network feature (`session_*`, `is_vpn` …) server-side থেকে পূরণ হবে।
- `tests/test_middleware.py`-এর নকল class বাদ দিয়ে `aegis_shield`-এর আসল test লেখা হবে (verifier round-trip, replay nonce, middleware allow/challenge/block)।

**A4. Server Node**
- `@aegis/core` workspace dependency যোগ হবে। `fastify` আর `fastify-plugin` যোগ হবে, অথবা fastify middleware optional peer করা হবে।
- `VerificationResult`-এর `valid` field ঠিক করা।
- Duplicate `src/TokenVerifier.ts` + `src/verifier/`, আর `routes.ts` + `api/routes.ts` মিলিয়ে একটা করা।
- Python-এর মতো একই token format verify করবে। Cross-language test থাকবে: Python sign → Node verify।
- Jest test।

**A5. Dashboard**
- CRA (`react-scripts`, deprecated) বাদ দিয়ে **Vite**, সাথে `index.html`।
- সব hardcoded array সরানো হবে। Data আসবে নতুন API থেকে:
  - ML Performance → `docs/thesis/results/*/results.json`-এর আসল সংখ্যা
  - Overview/Logs → server-এর request log
- "Epoch" চার্ট বাদ যাবে (tree model-এ epoch নেই)।

**A6. IRB packet (code না, কিন্তু ২১ অক্টোবরের জন্য জরুরি)**
`docs/thesis/irb/`-এ থাকবে:
- data dictionary (৫০টা feature-এর প্রতিটা কী, raw key content নেওয়া হয় না)
- protocol draft
- consent form (English + বাংলা)
- data retention ও anonymisation plan

**A7. CI**
`.github/workflows/ci.yml`:
- `pip install -e packages/ml-engine[dev]` → extra নেই, তাই `[test]` বা সরাসরি pytest।
- js-sdk আর server-node-এর build ও test যোগ।

**Checkpoint A (৯ অক্টোবর):** `npm run build` আর `npm test` সব workspace-এ সবুজ। pytest সবুজ। একটা end-to-end test পাস করবে: Playwright Chromium-এ `examples/html-basic` → SDK → Python server → ML → token → protected route।

---

## Phase B — Day 10–12: Security ও Advanced Detection (১০–১৫ অক্টোবর, ~৫–৬ দিন)

| Feature | কোথায় | বাস্তব সীমা |
|---------|--------|-------------|
| InputValidator (XSS, SQLi, CRLF, prototype pollution) | `core/src/security/InputValidator.ts` | Pattern-based detection, WAF-এর বিকল্প না |
| SecurityHeaders (CSP, HSTS, X-Frame-Options) | `core/src/security/SecurityHeaders.ts` + Express/FastAPI middleware | — |
| AntiTamper (request signing, replay detection) | `core/src/security/AntiTamper.ts` | `utils/crypto.ts` HMAC আর nonce logic পুনর্ব্যবহার |
| TorExitNodeChecker | `core/src/modules/ip-intelligence/` | Tor project-এর exit list fetch + cache; test-এ offline fixture |
| ThreatFeedSync (FireHOL, Spamhaus DROP, AbuseIPDB) | `core/src/modules/threat-intel/` | AbuseIPDB-তে API key লাগে (env var); না থাকলে skip |
| BotBehaviorAnalyzer (server-side session pattern) | `core/src/modules/` | `SessionManager`-এর data ব্যবহার করবে |
| AntiDetectDetector (Multilogin/GoLogin/Dolphin) | js-sdk `detection/` | Fingerprint inconsistency heuristic। নিশ্চিত detection দাবি করা যাবে না |
| WebGPUFingerprinter | js-sdk `fingerprint/` | `navigator.gpu` adapter info; headless Chromium-এ প্রায়ই নেই, তাই test-এ feature-detect |
| WASMChallenge (memory-hard PoW) | js-sdk `challenges/` + server verify | Argon2-ধাঁচের memory-hard function WASM-এ; existing `ProofOfWork.ts` interface পুনর্ব্যবহার |
| QUICFingerprinter | `core/src/modules/fingerprint/` | Node raw UDP/QUIC handshake দেখে না। তাই QUIC Initial packet **parser** (pcap/bytes input) + test fixture। Live capture reverse proxy (Caddy/nginx log) ছাড়া সম্ভব না, thesis-এ এভাবেই লিখতে হবে |
| Docker (সব service) | `Dockerfile`s + `docker-compose.yml` | এখনকার Dockerfile শুধু core চালায় |

**Checkpoint B (১৫ অক্টোবর):** প্রতিটা feature-এর unit test সবুজ; docker compose up-এ সব service চালু।

---

## Phase C — Day 13–15: Enhanced ML (১৬–১৯ অক্টোবর, ~৩–৪ দিন)
- **SHAP:** `aegis_ml/explain/` (shap dependency আগেই আছে) — global summary plot + per-request explanation।
- **Model comparison:** XGBoost vs RF vs LR vs Ensemble একই CV split-এ; `TrainingPipeline`-এ যোগ (`_out_of_fold_probs` আর `run_group_ablation`-এর pattern পুনর্ব্যবহার)।
- **Deep model:** mouse trajectory sequence-এর উপর 1D-CNN/LSTM (torch আগেই dependency)। এর জন্য synthetic generator-এ raw trajectory sample লাগবে; `MouseAnalysis.samples` ফরম্যাট মেনে।
- **Publication plots:** ROC/PR একসাথে, CI band, ৩০০ dpi PDF; `scripts/thesis_experiment.py`-তে।
- **২০–২১ অক্টোবর:** IRB packet চূড়ান্ত, supervisor-এর সই → **২১ অক্টোবর IRB জমা।**

---

## Phase D — Day 16–20: Performance ও Integration (২২–২৭ অক্টোবর, ~৫ দিন)
- **Redis:** rate limiter, nonce store আর session-এর জন্য optional backend (in-memory default থাকবে); docker compose-এ redis।
- **WebSocket:** server → dashboard live threat feed।
- **GraphQL:** read-only API (stats, logs, threats), REST-এর পাশাপাশি।
- **Edge:** Cloudflare Worker adapter — শুধু token verify + rate limit (ML edge-এ না); `wrangler dev`-এ local test। Deploy করতে আপনার account লাগবে।
- **Load testing:** k6 বা autocannon script; req/s আর p50/p95/p99 thesis-এর জন্য রেকর্ড।

## Phase E — Day 21–25: Documentation (২৮–২৯ অক্টোবর, ~২ দিন)
- OpenAPI spec (FastAPI auto + Node routes), Swagger UI
- Security whitepaper (threat model, OWASP OAT mapping) — এখনকার `docs/security-whitepaper.md` stub পূর্ণ করা
- `getting-started.md`, `configuration.md` stub পূর্ণ করা
- npm/PyPI publish config (publish করবেন না, শুধু প্রস্তুত)

## Phase F — Day 26–30: Production Readiness (৩০ অক্টোবর – ৪ নভেম্বর, ~৪–৫ দিন)
- **Self pen-test:** Phase-এর ৫টা bot (requests, Selenium, Puppeteer-stealth, Playwright, Scrapy) নিজের local stack-এর বিরুদ্ধে। এগুলোই নভেম্বরের bot data collection script হিসেবে কাজে লাগবে।
- **Performance profiling:** Node + Python memory/CPU
- **Prometheus metrics:** `/metrics`, health endpoint
- **Kubernetes:** manifest + Helm chart, `kind` cluster-এ local test
- **v1.0.0:** CHANGELOG, tag, GitHub release (আপনার অনুমতি নিয়ে)

**Checkpoint F (~৪ নভেম্বর):** সব CI সবুজ; e2e + load test result `THESIS_NOTES.md`-এ।

## Phase G — Data collection website (৫–১০ নভেম্বর, ~৪–৫ দিন)
- Consent page (বাংলা/English) → task flow (login, search, product, checkout) → AEGIS SDK → Python logging endpoint
- Anonymous participant ID; raw key content নয়, শুধু timing; dataset export (CSV/Parquet)
- VPS-এ deploy: DigitalOcean বা university server — **আপনার করতে হবে**

---

## যা ব্যবহার হবে (নতুন করে লেখা হবে না)
- Token format আর HMAC verify: `packages/server-python/aegis_shield/verifier.py`
- Crypto: `packages/core/src/utils/crypto.ts`
- ML inference: `packages/ml-engine/aegis_ml/inference/inference.py` (`InferenceEngine.predict`)
- Feature contract: `packages/ml-engine/aegis_ml/features/extractor.py` (`FEATURE_CATEGORIES`)
- Collectors: `packages/js-sdk/src/collectors/*` (math রেখে শুধু wiring)
- PoW interface: `packages/js-sdk/src/challenges/ProofOfWork.ts`
- CV/OOF pattern: `packages/ml-engine/aegis_ml/training/training.py`

## Verification (প্রতিটা Phase-এ)
1. `npm run build && npm test` (সব workspace), `python -m pytest packages/ml-engine/tests packages/server-python/tests`
2. Playwright e2e (Chromium আগে থেকেই আছে): browser → SDK → server → ML → verdict। Selenium/Puppeteer bot চালালে block বা challenge হওয়া উচিত।
3. Dashboard-এ আসল data দেখায় কিনা: server-এ request পাঠিয়ে Overview-এর count বাড়ে কিনা।
4. CI-এ push করার পর সবুজ।
5. `THESIS_NOTES.md`-এ সংখ্যা ও সিদ্ধান্ত লেখা।

## আপনার নিজের করতে হবে (আমি পারব না)
- ২১ অক্টোবর IRB জমা + supervisor-এর সই
- AbuseIPDB API key (ঐচ্ছিক), Cloudflare account (edge deploy-এর জন্য), VPS
- v1.0.0 release আর npm/PyPI publish-এর অনুমতি

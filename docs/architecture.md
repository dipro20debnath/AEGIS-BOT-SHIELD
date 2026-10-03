# Architecture

How AEGIS BOT SHIELD is built and how a request is scored. Implementation
decisions and their measured effects are recorded in
[`docs/thesis/THESIS_NOTES.md`](thesis/THESIS_NOTES.md).

## Components

```
┌──────────────────────────── browser ────────────────────────────┐
│ @aegis/js-sdk  collectors (mouse, keyboard, scroll, touch)      │
│                headless + anti-detect checks, device signals   │
│                proof-of-work solver (scrypt in WebAssembly)    │
│                token handling (fetch/XHR interception)         │
└───────────────┬──────────────────────────────────▲─────────────┘
                │ telemetry, PoW, X-Aegis-Token    │ token, 403 challenge/block
┌───────────────▼──── edge (optional) ─────────────┴─────────────┐
│ @aegis/edge-cloudflare  token check, rate limit per IP          │
└───────────────┬────────────────────────────────────────────────┘
┌───────────────▼──────────────── origin ─────────────────────────┐
│ Python: aegis_shield (FastAPI/Flask/Django)   Node: @aegis/server-node (Express/Fastify/http)
│   request analyzer, input checks, sessions      AegisNode + @aegis/core DetectionEngine
│   telemetry service, PoW, tokens                status API: REST, GraphQL, WebSocket, OpenAPI
│   ML model in-process (optional)                ML via HTTP (optional)
└──────┬───────────────────────────┬──────────────────────────────┘
       │ features                  │ nonces, rate windows, sessions
┌──────▼───────────┐       ┌───────▼──────┐        ┌───────────────────────┐
│ aegis_ml service │       │ Redis        │        │ dashboard (React/Vite) │
│ POST /predict    │       │ (optional)   │        │ ← REST + WebSocket     │
└──────────────────┘       └──────────────┘        └───────────────────────┘
```

| Package | Language | Role |
|---|---|---|
| `packages/js-sdk` | TypeScript | Browser SDK, built to `dist/aegis.min.js` (IIFE, global `Aegis`) |
| `packages/server-python` | Python | `aegis_shield`: reference server middleware |
| `packages/core` | TypeScript | `@aegis/core`: rule engine, crypto, PoW, input checks, store, QUIC parser |
| `packages/server-node` | TypeScript | `@aegis/server-node`: Node middleware and status API |
| `packages/edge-cloudflare` | TypeScript | Cloudflare Worker |
| `packages/ml-engine` | Python | `aegis_ml`: features, models, training, evaluation, inference service |
| `packages/dashboard` | TypeScript/React | Operator dashboard |
| `contracts/` | JSON | `features.json` (50 ML features), `openapi.json` (HTTP API) — shared by all packages and enforced by tests |

The two servers implement the same protocol (token format, endpoints,
challenge, decisions) and are tested against each other (tokens issued by
one verify in the other and in the edge worker).

## Request flow

```
browser                     server middleware                         app
  │ GET /page                    │                                      │
  │─────────────────────────────▶│ request signals → score → allow ────▶│
  │◀──────────────────────────────────────────────────────────────── page + SDK
  │ POST /aegis/telemetry        │
  │─────────────────────────────▶│ features + request signals (+ ML) → score
  │◀─────────────────────────────│ {token, verdict, score} + Set-Cookie aegis_sid
  │ POST /api/login              │
  │   X-Aegis-Token, cookie      │ verify token (signature, expiry, UA, session)
  │─────────────────────────────▶│ fuse token score + request signals → decide
  │                              ├── allow ───────────────────────────▶│
  │◀── 403 challenge ────────────┤
  │ GET/POST /aegis/challenge    │ scrypt proof of work → token (pow=1)
  │ retry with new token ───────▶│ challenge → allow (never block → allow)
```

## Signals

| Category | Examples | Where computed |
|---|---|---|
| network | datacenter/VPN/Tor IP, rate limits, residential-proxy heuristics | server (core `IPAnalyzer`, rate limiters; Python `ip_intel`, feeds) |
| protocol | missing client hints, generic `Accept`, header order, TLS/HTTP2 fingerprints (Node, when available), QUIC (offline) | server |
| behavioral | straight mouse paths, no tremor, uniform typing, programmatic scroll, session patterns (timer paging, ID enumeration, 4xx probing), honeypots | SDK statistics + server |
| device | headless checks, anti-detect inconsistencies, WebGL/canvas | SDK |
| reputation | threat lists (FireHOL, Spamhaus DROP, AbuseIPDB, Tor), known tool user agents | server |
| payload | XSS/SQLi/CRLF/path traversal/prototype pollution patterns | server |
| ML | probability from the ensemble on the 50-feature vector | ML model |

## Scoring

**Node (`@aegis/core` + `AegisNode`)**
1. Within a category: weighted mean of `value × confidence` over its signals.
2. Across categories: **noisy-OR**, `score = 100 · (1 − Π(1 − s_c/100))`, plus
   boosts for decisive signals (e.g. headless).
3. `AegisNode` fuses that engine score with the token's score, the anti-detect
   score and the ML score, again by noisy-OR.

**Python (`aegis_shield`)**
1. Each request signal has a value 0–100; all are fused by noisy-OR.
2. Telemetry: rule score and ML score fused by noisy-OR. The ML probability is
   rescaled so the model's own decision threshold maps onto the challenge
   threshold.

**Decision** (both): `score ≥ block_threshold` (80) → block,
`≥ challenge_threshold` (50) → challenge, else allow; `monitor` mode never
denies. Then:
- a solved proof of work turns *challenge* into *allow*, never *block*;
- token-required paths need a token backed by telemetry;
- tokens bound to another user agent or session count as risk, not as evidence.

Noisy-OR treats layers as independent evidence: adding a layer can only raise
the score. Correlated layers are over-counted; thresholds are hand-set and
must be calibrated on real traffic (THESIS_NOTES §2.1, §2.4).

## Tokens and sessions

- **Token:** `AEGIS.v1.<AES-256-GCM sealed claims>.<HMAC-SHA256>`. Claims: `sid`,
  `score`, `verdict`, `uah` (user-agent hash), `exp`, `iat`, `nonce`, plus `pow`/`tel`
  after a challenge. Default lifetime 300 s.
- **Session:** an HttpOnly `aegis_sid` cookie. The record holds request times,
  paths, risk history and the latest telemetry score. Python uses a random id;
  Node uses an HMAC-signed id. Records live in memory or Redis for 30 min of
  inactivity.

## State

| State | In-process | With Redis |
|---|---|---|
| Spent challenge ids, signature nonces, single-use tokens | per process | shared, atomic `SET NX` |
| Rate-limit windows | per process (Node also a token bucket) | shared sliding window (Lua, Redis clock) |
| Sessions | per process | shared JSON values, last-writer-wins |
| Stats, events, live feed | per process | per process |

## ML

The 50-feature contract (`contracts/features.json`) covers 5 SDK categories
(mouse, keyboard, scroll, touch, fingerprint) and 2 server-side categories
(session, network). The model is a stacked ensemble (XGBoost, RandomForest
and logistic regression, combined by a logistic-regression meta-model) with a
decision threshold tuned for a false-positive budget, served in-process
(Python) or over HTTP. See
[ML_MODEL_GUIDE.md](ML_MODEL_GUIDE.md).

## Operator surfaces (Node)

- **REST:** `/aegis/health`, `stats`, `events`, `config`, `verify`.
- **GraphQL:** `/aegis/graphql`, read-only.
- **WebSocket:** `/aegis/live`, batched events.
- **OpenAPI and Swagger UI:** `/aegis/openapi.json`, `/aegis/docs`.
- **Dashboard:** uses the WebSocket feed and falls back to REST polling.

All of these describe your traffic and must sit behind authentication.

## Edge

The Cloudflare Worker verifies tokens with WebCrypto, using the same format
and secret as the servers. It also rate-limits per IP and forwards to the
origin with `X-Aegis-Edge`. ML scoring, telemetry and challenges stay at the
origin.

<div align="center">
  <h1>🛡️ AEGIS BOT SHIELD</h1>
  <p><strong>A layered bot-detection framework: browser SDK + Python/Node middleware + ML engine</strong></p>

  [![CI](https://github.com/dipro20debnath/AEGIS-BOT-SHIELD/actions/workflows/ci.yml/badge.svg)](https://github.com/dipro20debnath/AEGIS-BOT-SHIELD/actions/workflows/ci.yml)
  [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
  ![Node](https://img.shields.io/badge/Node-%E2%89%A522.12-green.svg)
  ![Python](https://img.shields.io/badge/Python-3.10--3.12-blue.svg)
</div>

---

AEGIS BOT SHIELD tells humans and bots apart on a website. A small JavaScript SDK
measures how the visitor behaves (mouse, keyboard, scroll, touch, device). The
server middleware combines that with request-level evidence (headers, IP,
session patterns, injection payloads) and a machine-learning model. It then
decides per request: **allow, monitor, challenge or block**.

> **Project status:** research software, built for a B.Sc. thesis at Metropolitan
> University, Sylhet (supervisor: Rishad Amin Pulok). It works end to end and is
> tested in CI, but it has **not** been run in production or evaluated on real
> traffic yet. The ML model is currently trained on **synthetic** data; real
> human/bot data collection is planned for November 2026. Packages are **not
> published** to npm/PyPI. Install from this repository as shown below.

---

## Contents
- [When to use it (and when not)](#when-to-use-it-and-when-not)
- [How it works](#how-it-works)
- [Repository layout](#repository-layout)
- [Quick start: demo in 5 minutes](#quick-start-demo-in-5-minutes)
- [Run everything with Docker](#run-everything-with-docker)
- [Add it to your own site](#add-it-to-your-own-site)
- [Configuration](#configuration)
- [Endpoints](#endpoints)
- [Optional features](#optional-features)
- [Several instances: shared state in Redis](#several-instances-shared-state-in-redis)
- [Edge: Cloudflare Worker](#edge-cloudflare-worker)
- [ML engine](#ml-engine)
- [Dashboard](#dashboard)
- [Performance (load test)](#performance-load-test)
- [Testing](#testing)
- [Privacy](#privacy)
- [Limitations](#limitations)
- [Documentation](#documentation)
- [Roadmap and thesis documents](#roadmap-and-thesis-documents)

---

## When to use it (and when not)

**Use it to protect endpoints that bots abuse:**

| Endpoint | Typical attack (OWASP OAT) |
|---|---|
| Login | Credential stuffing (OAT-008) |
| Sign-up | Fake account creation (OAT-019) |
| Checkout, ticket or flash sales | Scalping (OAT-005) |
| Product or price pages | Scraping (OAT-011) |
| Contact and comment forms | Spam (OAT-017) |
| Admin paths | Vulnerability scanning (OAT-014) |

**Start in `monitor` mode** on an existing site. It scores every request but
never blocks, so you can see what it would do before you enforce it.

**Do not use it as:**
- a replacement for a WAF, input sanitisation, parameterised queries or authentication;
- protection for a pure API with no browser in front of it. The behavioural
  layer needs the JavaScript SDK; for server-to-server calls use
  [request signing](#request-signing-anti-tamper) instead;
- proof that a visitor is human. It gives a risk score, and a determined,
  well-resourced bot can still get through. See [Limitations](#limitations).

---

## How it works

```
 Browser                                   Your server (Python or Node middleware)
 ───────                                   ───────────────────────────────────────
 aegis.min.js                              every request
  ├ collectors: mouse, keyboard,             ├ L1 request rules: headers, user agent, rate limit,
  │ scroll, touch (50 features)              │    injection payloads (XSS/SQLi/…), honeypots
  ├ headless + anti-detect checks            ├ L2 IP: datacenter ranges, Tor exits, threat feeds
  ├ device fingerprint (hashed)              ├ L3 session patterns: fixed-timer paging,
  │                                          │    sequential IDs, 4xx probing
  └─ POST /aegis/telemetry  ───────────────► ├ L4 behaviour rules + ML model on the 50 features
       ◄── signed token (AEGIS.v1…) ──────── │    → signed token (AES-256-GCM + HMAC, 5 min)
  fetch('/api/login')                        └ fuse all evidence (noisy-OR) → score 0–100
   + header X-Aegis-Token  ────────────────►      allow | monitor | challenge | block
  on 403 "challenge":                        L5 memory-hard proof of work (scrypt, 4 MiB)
   solve scrypt in WebAssembly ──────────►      /aegis/challenge → turns "challenge" into "allow"
```

- **Score:** 0–100. Defaults are **≥ 80 block**, **≥ 50 challenge**, otherwise
  allow. In `monitor` mode, high scores are reported as `monitor` and never blocked.
- **Fusion:** independent layers are combined with noisy-OR,
  `100 × (1 − Π(1 − sᵢ/100))`, so extra evidence can only raise the risk.
- **Token-required paths** (e.g. `/api/login`) need a valid telemetry token.
  A bare `curl` is challenged.
- **Proof of work** answers a "challenge". It never lifts a "block", and on its
  own it does not replace behavioural telemetry on token-required paths.
- **Tokens are bound** to the browser's user agent and its `aegis_sid` session
  cookie, so a token copied into another client is ignored.

---

## Repository layout

| Path | What it is |
|---|---|
| `packages/js-sdk` | Browser SDK: collectors, headless and anti-detect checks, WebGPU fingerprint, scrypt WASM solver, token handling. Builds `dist/aegis.min.js`. |
| `packages/server-python` | `aegis_shield`: **reference server middleware** for FastAPI/Starlette, Flask and Django, with the ML model in-process. |
| `packages/core` | `@aegis/core`: TypeScript detection engine (rate limiting, IP intelligence, header/TLS/HTTP2 fingerprints, honeypots, threat feeds, input validation, session patterns, PoW). |
| `packages/server-node` | `@aegis/server-node`: Express, Fastify and plain `http` middleware on top of the core, plus a status API (REST, GraphQL, WebSocket live feed). |
| `packages/edge-cloudflare` | Cloudflare Worker: token check and rate limiting at the edge, in front of either server. |
| `packages/ml-engine` | `aegis_ml`: feature extractor, synthetic data generator, RandomForest + XGBoost ensemble, training and threshold tuning, HTTP inference service. |
| `packages/dashboard` | React + Vite dashboard: live stats from the Node status API, ML results. |
| `contracts/` | `features.json`: the 50-feature contract shared by the SDK, servers and ML engine. `openapi.json`: the HTTP API of both servers. Tests in TS and Python enforce both. |
| `examples/` | Runnable demos: `fastapi-integration`, `python-flask`, `express-integration`, `html-basic`. |
| `e2e/` | Playwright end-to-end tests: real Chromium → SDK → Python server → ML. |
| `loadtest/` | Load generator and scenarios (throughput, p50/p95/p99, memory). |
| `docs/thesis/` | Thesis notes, project plan, IRB drafts, experiment results. |

---

## Quick start: demo in 5 minutes

**Requirements:** Node.js **≥ 22.12**, Python **3.10–3.12**, Git.

### 1. Install and build

```bash
git clone https://github.com/dipro20debnath/AEGIS-BOT-SHIELD.git
cd AEGIS-BOT-SHIELD
npm ci
npm run build                      # core, js-sdk (dist/aegis.min.js), server-node, dashboard

python -m venv .venv
source .venv/bin/activate          # Windows PowerShell: .\.venv\Scripts\Activate.ps1
pip install -e "packages/ml-engine[test]" -e "packages/server-python[test]" fastapi uvicorn
```

### 2. (Optional) Train a model for ML scoring

```bash
python e2e/train_model.py model.pkl     # small model on synthetic data, about 10 s
```

### 3. Run the FastAPI demo

```bash
# Linux / macOS
export AEGIS_SECRET_KEY=$(python -c "import secrets; print(secrets.token_hex(16))")
export AEGIS_ML_MODEL_PATH=model.pkl     # optional
uvicorn main:app --app-dir examples/fastapi-integration --port 8000
```

```powershell
# Windows PowerShell
$env:AEGIS_SECRET_KEY = python -c "import secrets; print(secrets.token_hex(16))"
$env:AEGIS_ML_MODEL_PATH = "model.pkl"   # optional
uvicorn main:app --app-dir examples/fastapi-integration --port 8000
```

### 4. Try it

- Open **http://localhost:8000** and log in with `demo` / `demo`. Move the
  mouse and type normally; the login succeeds.
- A script without the SDK is challenged:
  ```bash
  curl -i -X POST http://localhost:8000/api/login \
       -H "Content-Type: application/json" -d '{"username":"demo","password":"demo"}'
  # HTTP/1.1 403  {"aegis":"challenge","telemetry":"/aegis/telemetry","challenge":"/aegis/challenge"}
  ```
- Default headless Chromium (Playwright/Puppeteer) is denied at the first page
  load. A "stealth" headless browser loads the page but is blocked at login by
  the behavioural layer. `npm run test:e2e` shows both.

**Other demos:**
- **Flask:** `flask --app examples/python-flask/app.py run` (login `demo` / `demo`).
- **Express:** `node examples/express-integration/server.js`, then open
  http://localhost:3000 (login `admin` / `password`). It also serves the status
  API for the dashboard.

---

## Run everything with Docker

Requirements: Docker with Compose v2. No Node or Python installation is needed.

```bash
cp .env.example .env
# put a random secret into .env, e.g. AEGIS_SECRET_KEY=$(python -c "import secrets; print(secrets.token_hex(16))")
docker compose up --build
```

| URL | Service | What to try |
|---|---|---|
| http://localhost:8000 | `api-python`: FastAPI demo, reference server, ML model in-process | log in with `demo` / `demo` |
| http://localhost:3000 | `api-node`: Express demo, Node server, ML via the `ml` service | log in with `admin` / `password` |
| http://localhost:8080 | `dashboard`: live stats of the Express server (WebSocket) | log in a few times on :3000 and watch it update |

How the stack is set up:
- **`ml`** (inference service) is internal only. Its `/train` endpoint has no
  authentication, so it is not published to the host.
- **The bundled model is trained on synthetic data** while the image is built.
  It demonstrates the pipeline; it is not a production model.
- **Build a single image:** `docker build --target api-python -t aegis/api-python .`
  The other targets are `api-node`, `ml` and `dashboard`.
- **Behind a TLS-intercepting proxy** (corporate network), pass the proxy's CA
  for the downloads during the build:
  `docker build --secret id=extra_ca,src=proxy-ca.pem ...`
- **`redis`** (internal only) holds the state the API servers share: replay
  nonces, rate-limit windows and sessions. Each demo has its own database
  (`/0` Node, `/1` Python). See [Several instances](#several-instances-shared-state-in-redis).

## Add it to your own site

### Step 1: the browser SDK

Build it with `npm run build -w packages/js-sdk` and serve
`packages/js-sdk/dist/aegis.min.js` from your site. There is no public CDN.

**Automatic (recommended):**

```html
<script src="/static/aegis.min.js" data-site-key="YOUR_SITE_KEY"></script>
```

That's all for most sites:
- the SDK starts collecting;
- it posts telemetry when your page makes its first same-origin `fetch`/XHR;
- it adds the `X-Aegis-Token` header to your own requests (never to third-party origins);
- on a 403 "challenge" it solves the proof of work and retries once.

Optional attributes:
- `data-endpoint="https://api.example.com"`: AEGIS server on another origin;
- `data-beacon="true"`: send a final report when the page is closed;
- `data-debug="true"`: log to the console.

**Manual control:**

```html
<script src="/static/aegis.min.js"></script>
<script>
  const aegis = new Aegis.AegisClient({
    siteKey: 'YOUR_SITE_KEY',
    endpoint: 'https://api.example.com',        // default: this page's origin
    allowedOrigins: ['https://api.example.com'], // extra origins that get the token
    autoChallenge: true,                         // solve PoW on 403 "challenge" and retry
  });
  aegis.on('token', r => console.log('verdict', r.verdict, 'score', r.score));

  // If you do not use fetch/XHR interception:
  const token = await aegis.getToken();          // sends telemetry if needed
  await fetch('/api/login', { method: 'POST', headers: { 'X-Aegis-Token': token }, body });
</script>
```

Other SDK config keys (all default `true`):
- `collectMouse`, `collectKeyboard`, `collectScroll`, `collectTouch`;
- `fingerprint`, `detectHeadless`, `detectAntiDetect`;
- `autoIntercept`, `autoStart`.

### Step 2a: Python backend (reference server)

```bash
pip install -e packages/server-python       # add -e packages/ml-engine for local ML scoring
```

**FastAPI / Starlette**

```python
from fastapi import FastAPI, Request
from aegis_shield import AegisFastAPIMiddleware

app = FastAPI()
app.add_middleware(
    AegisFastAPIMiddleware,
    site_key="YOUR_SITE_KEY",
    secret_key="at-least-16-random-chars",   # keep secret; same value on every instance
    mode="monitor",                          # start here, switch to "enforce" later
    require_token_paths=["/api/login", "/api/checkout"],
    excluded_paths=["/health", "/static"],
    ml_model_path="model.pkl",               # optional
)

@app.post("/api/login")
def login(request: Request):
    aegis = request.scope["state"]["aegis"]  # AegisResult: action, score, reason
    ...
```

**Flask**

```python
from flask import Flask, g
from aegis_shield import AegisFlaskMiddleware

app = Flask(__name__)
AegisFlaskMiddleware(app, site_key="...", secret_key="...", require_token_paths=["/login"])
# inside a view: g.aegis.action, g.aegis.score, g.aegis.reason
```

**Django** (`settings.py`)

```python
MIDDLEWARE = ["aegis_shield.AegisDjangoMiddleware", ...]
AEGIS = {"site_key": "...", "secret_key": "...", "require_token_paths": ["/accounts/login/"]}
# inside a view: request.aegis.action / .score
```

Configuration from environment variables: `from aegis_shield import get_config`,
then `AegisFastAPIMiddleware(app, **get_config(), ...)`. See
[environment variables](#environment-variables-python).

### Step 2b: Node backend

The Node packages are workspace packages. Build them and import from the repo,
as `examples/express-integration/server.js` does.

**Express**

```js
const express = require('express');
const { AegisNode, aegisExpress, aegisRoutes } = require('./packages/server-node/dist');

const aegis = new AegisNode({
  siteKey: 'YOUR_SITE_KEY',
  secretKey: process.env.AEGIS_SECRET_KEY,       // >= 16 characters
  mode: 'monitor',
  requireTokenPaths: ['/api/login'],
  excludedPaths: ['/health', '/static', '/aegis/'],
  mlUrl: process.env.AEGIS_ML_URL,              // optional ML service (see ML engine)
});

const app = express();
app.use(express.json());
app.use(aegisExpress(aegis.options, aegis));
app.use(aegisRoutes(aegis));                    // status API: protect it behind auth!
app.post('/api/login', (req, res) => res.json({ score: req.aegis.score }));
```

**Fastify:**

```js
const { aegisFastify } = require('./packages/server-node/dist/middleware/fastify');
fastify.register(aegisFastify, { siteKey: '...', secretKey: '...', requireTokenPaths: ['/api/login'] });
```

**Plain `http` / Connect:** use `aegisGeneric(options)` as middleware.

### What happens to a request

| Verdict | Response | Your handler |
|---|---|---|
| `allow` | passes through | runs; the decision is in `request.aegis` |
| `monitor` | passes through (monitor mode, high score) | runs; log or flag it |
| `challenge` | `403 {"aegis":"challenge", "telemetry":…, "challenge":…}` + header `X-Aegis-Action: challenge` | not called; the SDK solves and retries |
| `block` | `403 {"aegis":"block"}` + header `X-Aegis-Action: block` | not called |

If detection itself fails, the request is **allowed** by default
(`fail_open=True`). A bug in AEGIS must not take your site down.

---

## Configuration

### Python (`aegis_shield`) keyword arguments

| Option | Default | Meaning |
|---|---|---|
| `site_key`, `secret_key` | required | Site id and signing key (≥ 16 chars) |
| `mode` | `"enforce"` | `"monitor"` scores without blocking |
| `block_threshold`, `challenge_threshold` | `80`, `50` | Score cut-offs |
| `require_token_paths` | `[]` | Path prefixes that need a telemetry token |
| `protected_paths` | `None` (all) | Only analyse these prefixes |
| `excluded_paths` | `["/health", "/favicon.ico"]` | Never analysed |
| `token_ttl` | `300` | Token lifetime, seconds |
| `ml_model_path` / `ml_url` | `None` | Local model file or ML HTTP service |
| `trusted_proxies` | `[]` | IPs/CIDRs whose `X-Forwarded-For` is trusted (set this behind nginx/Cloudflare) |
| `verify_search_engines` | `False` | Confirm Googlebot/Bingbot by reverse DNS (adds latency) |
| `input_validation` | `True` | XSS/SQLi/path-traversal/CRLF checks on path and query |
| `session_patterns` | `True` | Request-sequence checks per session |
| `live_feeds`, `feeds`, `feed_cache_dir`, `abuseipdb_key` | off | [Live IP lists](#live-ip-lists-tor-firehol-spamhaus-abuseipdb) |
| `challenge_path`, `pow_n`, `pow_r`, `pow_bits` | `/aegis/challenge`, 4096, 8, 4 | [Proof of work](#memory-hard-proof-of-work) |
| `fail_open` | `True` | Allow requests when analysis errors |
| `redis_url` | `None` | Shared state in Redis for several processes ([details](#several-instances-shared-state-in-redis)) |
| `rate_limit`, `rate_limit_window` | `0` (off), `60` | Requests per client IP per window before `rate_limit.exceeded` (score 100) |
| `endpoint_limits` | `{}` | Stricter limits per path prefix, e.g. `{"/api/login": [5, 60]}` |

### Environment variables (Python)

Read by `get_config()`:

| Variable | Purpose |
|---|---|
| `AEGIS_SITE_KEY`, `AEGIS_SECRET_KEY` | Site key and secret |
| `AEGIS_MODE` | `monitor` or `enforce` |
| `AEGIS_BLOCK_THRESHOLD`, `AEGIS_CHALLENGE_THRESHOLD` | Score thresholds |
| `AEGIS_FAIL_OPEN` | `true` / `false` |
| `AEGIS_ML_MODEL_PATH`, `AEGIS_ML_URL` | ML model file or service URL |
| `AEGIS_TRUSTED_PROXIES` | Comma-separated IPs/CIDRs |
| `AEGIS_REDIS_URL` | Shared state in Redis, e.g. `redis://localhost:6379/0` |
| `AEGIS_RATE_LIMIT` | Requests per client IP per minute (0 = off) |
| `ABUSEIPDB_API_KEY` | Enables the AbuseIPDB feed when live feeds are on |

### Node (`AegisNode`) options

The Node options mirror the Python ones in camelCase:
- `siteKey`, `secretKey`, `mode`;
- `thresholds: {block, challenge}`;
- `requireTokenPaths`, `protectedPaths`, `excludedPaths`;
- `tokenTtl`, `mlUrl`, `mlTimeoutMs`;
- `telemetryPath`, `challengePath`;
- `pow: {n, r, bits}`;
- `store` (shared state, e.g. `await createRedisStore(url)`), `sessionTtl`;
- `engine` (an extra `DetectionEngine` config, e.g.
  `engine: { ipIntelligence: { liveFeeds: { tor: true, threatFeeds: true, cacheDir: '.aegis-cache' } } }`).

---

## Endpoints

The full contract is [`contracts/openapi.json`](contracts/openapi.json)
(OpenAPI 3.1, tested against both servers). The Node server serves it at
`/aegis/openapi.json` with Swagger UI at `/aegis/docs`; in FastAPI,
`add_aegis_openapi(app)` adds these endpoints to `/docs`.

These are answered by the middleware itself:

| Method and path | Purpose |
|---|---|
| `POST /aegis/telemetry` | SDK sends behaviour features and receives `{token, expiresIn, verdict, score}` |
| `GET /aegis/challenge` | Issue a memory-hard challenge `{challenge, seed, n, r, bits, expiresAt}` |
| `POST /aegis/challenge` | Verify `{challenge, nonce}` and receive a token |

Node status API (`aegisRoutes`), meant for the dashboard. **Put it behind authentication.**

| Method and path | Purpose |
|---|---|
| `GET /aegis/health` | Liveness |
| `GET /aegis/stats` | Counts per verdict, top reasons (since process start) |
| `GET /aegis/events?limit=100` | Recent decisions (IPs truncated to /24 or /48) |
| `GET /aegis/config` | Active configuration (no secrets) |
| `POST /aegis/verify` | Verify a token from another backend |
| `GET, POST /aegis/graphql` | Read-only GraphQL over the same data ([details](#graphql)) |
| `WS /aegis/live` | WebSocket live feed of decisions, when `attachLiveFeed` is used ([details](#websocket-live-feed)) |
| `GET /aegis/openapi.json`, `GET /aegis/docs` | OpenAPI document and Swagger UI |

---

## Optional features

### Live IP lists (Tor, FireHOL, Spamhaus, AbuseIPDB)

These are off by default because they need outbound network access.

```python
AegisFastAPIMiddleware(app, ..., live_feeds=True, feed_cache_dir="/var/cache/aegis")
# AbuseIPDB as well: set ABUSEIPDB_API_KEY (free plan: synced at most every 6 h)
```

How the lists are handled:
- They refresh in the background and are cached on disk.
- A failed download keeps the previous list.
- Private, loopback, CGNAT and documentation ranges are always dropped (FireHOL
  level1 contains `10.0.0.0/8`, `127.0.0.0/8` and `100.64.0.0/10`).

**Use when** your site is internet-facing and you see traffic from hosting
providers or known attackers. A listed IP is evidence, not proof (shared NAT,
recycled cloud IPs).

### Memory-hard proof of work

This is on automatically: `challenge` responses point to `/aegis/challenge`, and
the SDK solves it with `autoChallenge`.
- **Puzzle:** scrypt with N=4096, r=8 (4 MiB per attempt), about 16 attempts.
  Measured in Chromium: 13.7 ms per attempt in WebAssembly, so about 0.2 s per
  challenge on a desktop. Slower phones take longer.
- **Raise or lower `pow_bits`** to make it harder or easier. Each +1 doubles the
  expected work. Measure on a low-end phone first.
- **Works on plain HTTP:** the SDK uses a JS SHA-256 fallback where WebCrypto is
  unavailable.
- **Content-Security-Policy:** if your CSP blocks WebAssembly, add
  `'wasm-unsafe-eval'` to `script-src`. Otherwise the slower JS solver is used.

### Security headers

```python
from aegis_shield import SecurityHeadersMiddleware
app.add_middleware(SecurityHeadersMiddleware, hsts=False)  # pass hsts=True only on HTTPS
```

```js
const { aegisSecurityHeaders } = require('./packages/server-node/dist');
app.use(aegisSecurityHeaders({ contentSecurityPolicy: "default-src 'self'" }));
```

These add CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy,
Permissions-Policy and COOP. They harden the site; they do not detect bots.

### QUIC / HTTP3 fingerprints (offline)

**What it reads:** the client's first QUIC packets. Anyone on the path can
decrypt these, and they contain the TLS ClientHello and the QUIC transport
parameters. The output is JA4 (`q…`), a transport-parameter hash, SNI, ALPN and
the QUIC stack (Chromium vs. client library).

```bash
sudo tcpdump -i any -w quic.pcap 'udp port 443'          # on the server, while traffic arrives
node packages/core/scripts/quic-fingerprint.mjs quic.pcap --json
```

**Use when** you serve HTTP/3 yourself and want to know which clients are real
browsers. For example, a Python HTTP/3 library that claims a Chrome user agent
is detected. In code: `fingerprintQuicDatagrams(datagrams)` and
`new QUICFingerprinter().analyze(fp, userAgent)`.

### Request signing (anti-tamper)

For **server-to-server** calls and webhooks, not browsers. Both sides share a
secret; a request is accepted once, and replays or modified bodies are rejected.
Node and Python produce identical signatures.

```js
// receiver (Express): mount before the JSON parser, or keep the raw body
app.post('/webhook', aegisRequireSignature(process.env.WEBHOOK_SECRET), handler);
```

```python
# sender (Python)
from aegis_shield import sign_request
headers = {"X-Aegis-Signature": sign_request("POST", "/webhook", body_bytes, secret)}
```

---

## Several instances: shared state in Redis

One process keeps its state in memory, which is correct. With several
processes or servers behind a load balancer, each would see only part of a
client's traffic: a replayed challenge solution or signed request could be
accepted once per instance, and a rate limit of N would really be N per
instance. With Redis all instances share:

| State | Redis operation |
|---|---|
| Spent proof-of-work challenges, request-signature nonces, single-use tokens | `SET key 1 PX ttl NX` (atomic claim) |
| Rate-limit windows (per IP, per endpoint) | Sliding-window log in a sorted set, one Lua script, Redis server clock |
| Sessions (request times, paths, risk history, telemetry score) | One JSON value per session with a TTL |

```bash
pip install "aegis-server-python[redis]"
AEGIS_REDIS_URL=redis://localhost:6379/0 uvicorn main:app --workers 4 ...
```

```typescript
import { AegisNode, createRedisStore } from '@aegis/server-node';
const aegis = new AegisNode({ siteKey, secretKey, store: await createRedisStore(process.env.AEGIS_REDIS_URL!) });
```

Behaviour to know:
- **Startup fails** if Redis cannot be reached, so a misconfigured deployment
  does not silently run with per-process state.
- **If Redis goes down later,** requests are still analysed (headers, token,
  input checks): rate limits and session history are skipped until it is back,
  and proof-of-work solutions get `503` instead of being accepted unchecked.
  Verified by stopping Redis under a running server.
- **Sessions are last-writer-wins** across instances; a lost update drops one
  request time. Replay and rate limits use atomic operations.
- **Counters behind the status API, GraphQL and the live feed stay per
  process.**

---

## Edge: Cloudflare Worker

`packages/edge-cloudflare` runs in front of either server and stops cheap
abuse before it reaches your origin:
- **rate limit per client IP** with the Workers Rate Limiting binding (per
  Cloudflare location, approximate), or a per-isolate fallback;
- **on token-required paths, a valid `X-Aegis-Token`** (verified with WebCrypto,
  same secret and format as the servers, bound to the user agent); otherwise
  `403` with the challenge endpoints;
- **tokens with verdict `block` or score ≥ the block threshold** are refused.

The ML model, telemetry scoring and the challenge stay at the origin, and the
origin still checks every token itself. The worker adds `X-Aegis-Edge`
(`verified; score=…`, `no_token`, …), which is informational: trust it only if
your origin accepts traffic from Cloudflare alone.

```bash
cd packages/edge-cloudflare
echo "AEGIS_SECRET_KEY=<same as the origin>" > .dev.vars
npx wrangler dev                          # local workerd; forwards to AEGIS_ORIGIN (wrangler.toml)
npx wrangler secret put AEGIS_SECRET_KEY  # then: npx wrangler deploy (your Cloudflare account)
```

Settings are `[vars]` in `wrangler.toml`: `AEGIS_REQUIRE_TOKEN_PATHS`,
`AEGIS_EXCLUDED_PATHS`, `AEGIS_BLOCK_THRESHOLD`, `AEGIS_MODE` (`monitor`
only annotates), `AEGIS_ORIGIN` (remove it for route mode on your zone).

---

## ML engine

```bash
cd packages/ml-engine
python scripts/thesis_experiment.py --out ../../docs/thesis/results/synthetic   # full experiment
```

The full experiment:
- trains the RandomForest + XGBoost ensemble on synthetic data;
- tunes the decision threshold on out-of-fold predictions (≤ 2% FPR budget);
- runs per-category and group ablation;
- writes `thesis_report.md`, `results.json`, `metrics.csv` and ROC, importance
  and confusion plots.

**Use the model:**
- **In-process (Python server):** `ml_model_path="model.pkl"`. Train a quick
  one with `python e2e/train_model.py model.pkl`.
- **As a service** (for the Node server):
  ```bash
  pip install -e "packages/ml-engine[server]"
  MODEL_PATH=model.pkl uvicorn aegis_ml.server:app --port 8001   # POST /predict
  ```
  Then pass `mlUrl: 'http://localhost:8001'` to `AegisNode`.

**Phase C experiments** (model comparison with bootstrap CIs, unseen-bot-type
tests, SHAP, 1D-CNN/LSTM on raw mouse trajectories, publication figures):

```bash
pip install -e "packages/ml-engine[deep]"
cd packages/ml-engine
python scripts/phase_c_experiment.py --out ../../docs/thesis/results/phase_c   # ~15 min on 4 CPUs
python scripts/phase_c_seed_robustness.py --out ../../docs/thesis/results/phase_c
```

Per-request explanations: `InferenceEngine.explain(data)` or `POST /predict`
with `"explain": true`. SHAP values come from XGBoost's built-in TreeSHAP
(`pred_contribs`), so no extra package is needed.

Results so far are on **synthetic** data only (see
`docs/thesis/results/synthetic/thesis_report.md`). They show the pipeline
works; they are not real-world accuracy.

---

## Dashboard

```bash
node examples/express-integration/server.js              # status API + live feed on :3000
AEGIS_API=http://localhost:3000 npm run dev -w packages/dashboard
```

Open the URL Vite prints. It shows counts, recent decisions, top reasons and
the ML results from `docs/thesis/results/`. Overview, Threats and Logs update
over the WebSocket feed (marked **Live**); if the socket is down they poll
the REST API every 5 s (**Polling**) and keep retrying.

### WebSocket live feed

```typescript
const server = app.listen(3000);
attachLiveFeed(server, aegis, { authorize: req => isAdmin(req), allowedOrigins: ['https://admin.example.com'] });
```

Messages: `hello` (counters + last 100 events) on connect, then `events`
batches every 250 ms (at most 200 per batch; the rest are counted in
`dropped`) and `summary` at most every 2 s. Slow clients skip batches instead
of growing server memory.

### GraphQL

Read-only (no mutations), at `/aegis/graphql` when `aegisRoutes` is mounted:

```bash
curl -s localhost:3000/aegis/graphql -H 'content-type: application/json' \
  -d '{"query":"{ stats { totalRequests blocked } threats(limit: 5) { reason count } events(verdict: block, limit: 3) { path score reasons ipPrefix } }"}'
```

Limits: 8 KB documents, 10 root fields per operation (aliases count),
`limit` ≤ 500. Like the REST status API, put it behind authentication.

---

## Performance (load test)

```bash
npm run build && redis-server &
node loadtest/run.mjs --out docs/thesis/results/phase_d    # ~12 min; --only node|python, --duration, --repeats
```

Measured on a 4-vCPU cloud VM (generator, Redis and server on the same
machine), one Node process / one uvicorn worker, 32 connections, median of 3
runs. Full table: [`docs/thesis/results/phase_d/load_test.md`](docs/thesis/results/phase_d/load_test.md).

| Page request | req/s | p50 / p95 / p99 ms under load | p50 unloaded ms |
|---|---|---|---|
| Express, no AEGIS | 6123 | 4.7 / 8.3 / 10.8 | 0.20 |
| Express + AEGIS | 2816 | 10.4 / 16.2 / 23.6 | 0.48 |
| Express + AEGIS, Redis | 2716 | 11.1 / 16.3 / 19.9 | 0.75 |
| FastAPI, no AEGIS | 1693 | 17.5 / 27.4 / 46.1 | 0.73 |
| FastAPI + AEGIS | 1247 | 22.3 / 33.4 / 140.8 | 0.86 |
| FastAPI + AEGIS, Redis | 724 | 42.0 / 58.2 / 80.0 | 1.38 |
| FastAPI + AEGIS, Redis, 4 workers | 1878 | (see note) | – |

- **AEGIS costs about 0.2 ms of server time per request** in both servers
  (in-process state). With Redis: about 0.2 ms (Node) and 0.8 ms (Python: the
  synchronous Redis client waits for 2–3 round trips per request).
- **With Redis, Python scales out:** 4 uvicorn workers handle 2.6× the
  single-worker rate (measured with 128 connections; uvicorn's multi-worker
  mode adds ~44 ms per keep-alive request even without AEGIS, so only its
  throughput is meaningful).
- **Telemetry with ML:** 936 req/s (Node → ML service over HTTP) and 458 req/s
  (Python, model in-process), unloaded p50 1.9 ms and 2.4 ms.

---

## Testing

---

## Testing

```bash
npm run build && npm test && npm run lint                      # core, js-sdk, server-node, edge-cloudflare
python -m pytest packages/ml-engine/tests packages/server-python/tests
npx playwright install chromium && npm run test:e2e            # real browser end to end
```

The shared-store tests also run against a real Redis when
`AEGIS_TEST_REDIS_URL` is set (e.g. `redis://127.0.0.1:6379/15`; CI does this);
without it they use the in-memory store and skip the Redis cases.

On **Windows**:
- add `--basetemp=.pytest_tmp` to pytest;
- set `$env:PYTHON="python"` before `npm run test:e2e`.

CI runs all of this on every pull request:
- Node 22 and 24;
- Python 3.10–3.12;
- the e2e test;
- the Redis cases, against a Redis service container;
- `npm audit` and `pip-audit`.

---

## Privacy

What the SDK sends:
- **Timing and geometry statistics only.** No key contents, no typed text, no
  URLs, no raw user agent.
- **The device fingerprint as a SHA-256 hash.**

The server keeps:
- **Sessions:** in memory (or Redis, with a 30-minute TTL), through an HttpOnly
  `aegis_sid` cookie.
- **Dashboard events:** truncated IPs (/24 or /48).

If you add data logging (`on_record`), you are responsible for consent and
retention. See `docs/thesis/irb/` for the study's data dictionary and consent
forms.

---

## Limitations

- **Synthetic training data:** detection rates on real traffic are unknown until
  the planned study.
- **Rule thresholds** are hand-set, and independent layers are assumed
  independent. Correlated signals are counted twice.
- **Anti-detect checks** catch inconsistent profiles. A carefully consistent
  profile, patched at the browser's native level, passes. They have not yet
  been tested against a real anti-detect browser.
- **Session-pattern checks** are evaded by a real browser with random timing
  that follows links.
- **Proof of work** proves cost, not humanity. It makes mass automation
  expensive but does not stop a single bot.
- **Shared state needs Redis:** without it, run one instance (or sticky
  sessions). The status counters, GraphQL and the live feed are per instance
  even with Redis.
- **Python with Redis** waits synchronously for each Redis round trip
  (~0.8 ms of server time per request here); scale with more workers.
- **Edge worker:** the Rate Limiting binding is per Cloudflare location and
  approximate; the per-isolate fallback is weaker. Not yet deployed on a real
  zone (tested with `wrangler dev`/workerd only).
- **QUIC/HTTP3 fingerprinting** works on captured packets (pcap or a UDP tap), not
  inside the request path: HTTP/3 is terminated by your proxy/CDN, which does not
  pass the handshake on. Only Chromium and aioquic have been profiled so far.

---

## Documentation

| Document | Contents |
|---|---|
| [Getting started](docs/getting-started.md) | Demo in 5 minutes, first integration, monitor → enforce |
| [Configuration](docs/configuration.md) | Every option of every component, with defaults (reserved options marked) |
| [Integration guide](docs/INTEGRATION_GUIDE.md) | FastAPI, Flask, Django, Express, Fastify, http; proxies, CORS, Redis, edge, rollout |
| [API reference](docs/API_REFERENCE.md) | HTTP API, SDK, Node, core, Python and ML library APIs |
| [Architecture](docs/architecture.md) | Components, request flow, signals, scoring, state |
| [ML model guide](docs/ML_MODEL_GUIDE.md) | Features, model, training, evaluation, serving |
| [Security whitepaper](docs/security-whitepaper.md) | Threat model, OWASP OAT mapping, failure behaviour, deployment checklist |
| [Releasing](docs/RELEASING.md), [Changelog](CHANGELOG.md) | npm/PyPI publishing (not published yet) |

Tests keep these documents honest: the OAT table must match the engine, the
option tables must list every option, and every relative link must resolve.

## Roadmap and thesis documents

- **[docs/thesis/PROJECT_PLAN.md](docs/thesis/PROJECT_PLAN.md):** phase plan and
  current status. Done: Phases A–E. Next: production readiness (Phase F: bot
  scripts for self-testing, profiling, Prometheus, Kubernetes, v1.0.0), then the
  data-collection website.
- **[docs/thesis/THESIS_NOTES.md](docs/thesis/THESIS_NOTES.md):** every design
  decision, measurement, bug and limitation, with reasons.
- **[docs/thesis/irb/](docs/thesis/irb/):** study protocol, consent forms
  (English and Bangla), data dictionary.

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: [SECURITY.md](SECURITY.md).
MIT License, © Dipro Debnath.

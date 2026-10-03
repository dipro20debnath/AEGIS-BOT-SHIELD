# AEGIS BOT SHIELD — Security Whitepaper

Version 1.0 · 2026-10-03 · applies to the code in this repository.

This document states what AEGIS protects against, how, what it does not do,
and where each claim is tested. Where a claim depends on data we do not have
yet (real users, real bots), it says so. Measurements so far come from
synthetic data, automated tests and load tests on one machine.

---

## 1. Scope and summary

AEGIS is bot-detection middleware for web applications. A browser SDK sends
behavioural telemetry; a server (Node or Python) scores it together with
request-level signals and an optional ML model, issues a short-lived token,
and decides per request whether to **allow**, **challenge** or **block**.
An optional Cloudflare Worker repeats the cheap checks at the edge.

What it is for: raising the cost of **automated abuse** — credential
stuffing, scraping, fake sign-ups, form spam, vulnerability scanning,
request floods — in the [OWASP Automated Threats](https://owasp.org/www-project-automated-threats-to-web-applications/) sense.

What it is not:
- **not a WAF** — input checks are pattern-based signals, not a parser-level defence;
- **not authentication or authorisation** — a valid AEGIS token says "probably
  not a bot", never "this user may do X";
- **not a DDoS shield** — volumetric attacks must be absorbed upstream (CDN);
- **not proof of humanity** — every client-side signal can be forged by a
  determined attacker (§4.1); AEGIS makes automation expensive and detectable,
  not impossible.

---

## 2. System and trust boundaries

```
 Browser (untrusted)            Edge (optional)            Origin (trusted)                    Internal
┌───────────────────┐   HTTPS  ┌───────────────┐  HTTPS   ┌──────────────────────────┐        ┌───────────┐
│ page + aegis SDK  │ ───────▶ │ CF Worker     │ ───────▶ │ app + AEGIS middleware   │ ─────▶ │ ML service│
│ telemetry, PoW    │          │ token check,  │          │ (Node or Python)         │        │ (/predict)│
└───────────────────┘          │ rate limit    │          │ status API (Node)        │ ─────▶ │ Redis     │
                               └───────────────┘          └──────────────────────────┘        └───────────┘
```

| Boundary | What crosses it | Trust |
|---|---|---|
| Browser → server | Telemetry, PoW solutions, tokens, every request | **Untrusted.** Everything the client sends is attacker-controlled. |
| Edge → origin | Forwarded requests plus `X-Aegis-Edge` | Informational only. The origin re-verifies tokens; trust the header only if the origin accepts traffic from Cloudflare alone. |
| Origin → ML service | Feature vectors | Internal network only. The ML service's `/train` endpoint has **no authentication**. |
| Origin → Redis | Nonces, rate-limit windows, sessions | Internal network only. Whoever can write to Redis can reset limits and replay protection. |
| Operator → status API | Stats, events, config, GraphQL, live feed | **Unauthenticated by default.** Mount behind your admin authentication. |

The shared secret (`AEGIS_SECRET_KEY`, ≥ 16 characters) is held by every
origin instance and the edge worker. Whoever holds it can mint valid tokens.

---

## 3. Adversaries and how far AEGIS gets

| Tier | Example | Main layers that catch it | Evidence |
|---|---|---|---|
| T1 HTTP libraries | `curl`, `python-requests`, Scrapy, Go `net/http` | Header analysis (missing client hints, generic `Accept`), known-tool UA patterns, token-required paths, session patterns (timer paging, ID enumeration, 4xx probing), rate limits | e2e: "a scripted client without token is challenged on the login API"; `server-*/tests` |
| T2 Default headless browsers | Headless Chromium, Puppeteer/Playwright defaults | Headless checks in the SDK (webdriver, missing plugins, UA tokens), header inconsistencies | e2e: "default headless Chromium is denied at the first page load" |
| T3 Stealth automation | Patched UA, `navigator.webdriver` hidden, scripted mouse | Behavioural features (mouse straightness, tremor, typing rhythm), anti-detect consistency checks, ML model | e2e: "the same stealth browser is blocked at login in enforce mode" (scripted input); synthetic results §5 of THESIS_NOTES |
| T4 Anti-detect browsers + residential proxies | Multilogin, GoLogin with residential IPs | Fingerprint consistency checks (partial), behaviour; IP reputation is weak here | **Not yet evaluated** against a real anti-detect browser |
| T5 Human-in-the-loop / replayed behaviour | CAPTCHA farms, replay of recorded human sessions | Proof of work makes volume expensive; session patterns; **behaviour alone fails** | Phase C: unseen replay bots detected only 36–47 % at 2 % FPR (synthetic) |
| T6 Holder of the secret | Leaked `AEGIS_SECRET_KEY` | Nothing in AEGIS | Rotate the secret (§6.6) |

The design assumption is **defence in depth**: each layer is weak alone and
the layers fail on different attacks (Phase C showed sequence models and
feature models failing on *different* unseen bot types). The risk score fuses
layers with a noisy-OR, which over-counts correlated signals; thresholds are
hand-set and not yet calibrated on real traffic.

---

## 4. Security properties and mechanisms

### 4.1 Telemetry is evidence, not proof

The SDK reports timing and geometry statistics (`contracts/features.json`).
An attacker can compute and send human-looking numbers directly. AEGIS
therefore never lets telemetry alone decide:
- request-level signals (headers, IP intelligence, input checks, session
  patterns, rate limits) are recomputed **on every request** server-side;
- the telemetry score is carried in a token and fused with those signals;
- forged telemetry still has to be sent from a client whose requests look
  consistent, from a session that behaves plausibly, at a rate under the limits.

This is the main reason the thesis evaluates real bots (Phase F) and real
humans (November study) before claiming detection rates.

### 4.2 Tokens

Format (identical in `@aegis/core`, `aegis_shield.verifier` and the edge worker):

```
AEGIS.v1.<base64url(JSON{iv, ciphertext, tag})>.<base64url(HMAC-SHA256(secret, part3))>
```

| Property | Mechanism | Test |
|---|---|---|
| Integrity | HMAC-SHA256 over the sealed payload, constant-time comparison | `core/tests/crypto.test.ts`, `server-python/tests/test_tokens.py`, `edge-cloudflare/tests` (forged → rejected) |
| Confidentiality of claims | AES-256-GCM; key = SHA-256(secret), or the secret's bytes if exactly 32 bytes | cross-language tests (Python ↔ Node ↔ WebCrypto) |
| Expiry | `exp` claim and `iat` age check (default TTL 300 s) | all three implementations |
| Bound to the client's user agent | `uah` = first 16 hex of SHA-256(User-Agent); mismatch → token ignored, +60 risk | `test_token_bound_to_user_agent`, edge tests |
| Bound to the session | `sid` must equal the `aegis_sid` session of the request; mismatch → ignored, +60 risk (`token_session_mismatch`) | `test_token_bound_to_session`, express "rejects a token used outside the session", edge "outside its session" |
| Proof of work never lifts a block | a solved challenge turns *challenge* into *allow* only; token-required paths additionally need telemetry (`tel` claim) | `test_solved_challenge_never_lifts_a_block`, `test_proof_of_work_alone_does_not_unlock_token_required_paths`, e2e |

Known weaknesses:
- **Tokens are reusable within their TTL** by the same session and user
  agent (a `single_use` mode exists in the Python verifier for one-shot tokens).
  A bot that drives a real browser session can harvest a token and reuse it
  from that session for 5 minutes; request-level signals still apply.
- **One secret, two uses.** The same secret keys HMAC and (hashed) AES. A
  proper KDF (HKDF with separate labels) is planned for a `v2` token format;
  changing it now would break compatibility between the three implementations.
- **The session binding raises the bar, it is not a wall.** The session cookie
  is HttpOnly (page scripts cannot read it), and `sid` is encrypted inside the
  token, so copying a token without its cookie fails. An attacker who
  exports both from a browser profile can still reuse them.

### 4.3 Proof of work (memory-hard)

scrypt with N = 4096, r = 8 (4 MiB per attempt), 4 leading zero bits by
default (≈ 16 attempts). Challenges are HMAC-signed, expire after 120 s, and
each challenge id is **burnt before** the expensive check, so a flood of
guesses for one challenge costs the server at most one scrypt evaluation.
With a shared store the id is burnt across all instances (atomic `SET NX`);
if the store is unreachable, verification answers **503 instead of accepting**.
Tests: `MemoryHardChallenge.test.ts`, `test_challenge.py`, `sharedStore.test.ts`.

Limit: proof of work prices volume. It does not stop one well-resourced bot,
and it costs real users battery on slow devices.

### 4.4 Request signing for server-to-server calls

`X-Aegis-Signature: t=<unix>,n=<nonce>,s=<HMAC>` over method, path with query,
timestamp, nonce and SHA-256 of the body; ±300 s skew; nonces remembered for
twice the skew (shared across instances with Redis). The nonce is recorded
only after the signature verifies, so unsigned requests cannot burn nonces.
For backends and webhooks only — browsers cannot hold the secret.

### 4.5 Input checks and security headers

- `InputValidator` (both languages) flags XSS, SQL injection, CRLF, path
  traversal and prototype-pollution patterns in path, query and (Node) body as
  **signals** in the *payload* category. Pattern matching has false negatives
  (encodings, novel payloads) and false positives; it complements a WAF and
  parameterised queries, it does not replace them.
- `securityHeaders` sets `X-Content-Type-Options`, `Referrer-Policy`,
  `X-Frame-Options`, HSTS (opt-out) and a restrictive default CSP
  (`script-src 'self'`, `frame-ancestors 'none'`, …). The SDK's WebAssembly
  solver needs `'wasm-unsafe-eval'` in `script-src`; without it the SDK falls
  back to a slower pure-JS solver.

### 4.6 Availability and failure behaviour

| Failure | Behaviour | Why |
|---|---|---|
| Analysis throws (bug, unexpected input) | **Fail open** (`fail_open=True` default): the request is allowed | A detection bug must not take the site down. Set `fail_open=False` for high-value paths if you prefer availability loss to bypass. |
| Redis unreachable at startup | Startup fails | Prevents silently running with per-process state |
| Redis unreachable later | Requests are still analysed; rate limits and session history are skipped; PoW returns 503 | Found by testing: the first version let a Redis outage bypass all checks. Fixed and tested (`store outage` tests; stopping Redis under a running server). |
| ML service slow or down | Scored without the model (timeout 500 ms default) | |
| Telemetry body too large | 413 (64 KB default) | Bounds parsing cost |

Abuse of AEGIS's own endpoints is bounded: telemetry size limits, PoW issue
is one HMAC, PoW verify at most one scrypt per issued challenge, GraphQL caps
(8 KB documents, 10 root fields counted through aliases and fragments,
`limit` ≤ 500), the WebSocket feed batches and drops for slow clients and
accepts at most 100 connections.

### 4.7 Shared state

With several instances, replay protection and rate limits are only correct if
shared. `RedisStore` uses atomic operations (`SET … NX PX`, a Lua sliding
window on the Redis clock). Sessions are last-writer-wins JSON values. Redis
must be on a private network or require authentication/TLS
(`rediss://user:pass@host`); its contents let an attacker reset limits.

---

## 5. OWASP Automated Threats (OAT) mapping

Status legend:
- **Labelled** — the core engine attaches this OAT label to its decision
  (`classifyThreats`) when the listed signals fire.
- **Generic** — no OAT-specific logic, but the automation behind the threat is
  what AEGIS detects (bot signals, token-required paths, PoW, rate limits).
- **Partial** — some signals help, clear gaps remain.
- **No** — outside what AEGIS can see.

| OAT | Threat | Status | How / gap |
|---|---|---|---|
| 001 | Carding | Generic | Token-required checkout path, per-endpoint rate limits (`/api/checkout` 10/min default). No payment-pattern logic. |
| 002 | Token Cracking | Partial | Rate limits; sequential-ID enumeration check in session patterns. No coupon-specific logic. |
| 003 | Ad Fraud | Generic | Bot detection on page views; no ad-click model. |
| 004 | Fingerprinting | Partial | Honeypot trap endpoints, header anomalies; a careful recon tool looks like a browser. |
| 005 | Scalping | Generic | Bot detection + PoW cost on purchase paths; no inventory awareness. |
| 006 | Expediting | Generic | Token-required paths on multi-step flows; no flow-order verification. |
| 007 | Credential Cracking | Generic | Per-endpoint login limits, token-required login. Brute force from many IPs needs the shared store. |
| 008 | Credential Stuffing | **Labelled** | Rate limit or headless signal on an auth path (`/login`, `/signin`, `/auth`). e2e covers scripted and stealth logins. |
| 009 | CAPTCHA Defeat | No | AEGIS has no CAPTCHA; PoW is not a humanity test (§4.3). |
| 010 | Card Cracking | Generic | As OAT-001. |
| 011 | Scraping | **Labelled** | Known-tool UA/patterns, trap endpoints, crawl breadth and sequential IDs per session. Distributed low-rate scrapers with real browsers evade it. |
| 012 | Cashing Out | No | Business-logic fraud after login; out of scope. |
| 013 | Sniping | Generic | Bot detection on the final action; no timing-of-auction logic. |
| 014 | Vulnerability Scanning | **Labelled** | Input-pattern signals, 4xx-probing per session, scanner UAs (sqlmap, nikto, …). |
| 015 | Denial of Service | **Labelled** (application layer) | Rate limits label it; volumetric DoS is out of scope (§1). |
| 016 | Skewing | Generic | Bot detection on voting/metrics endpoints; no statistical skew detection. |
| 017 | Spamming | **Labelled** | Honeypot form fields / fill-timing on non-auth forms. |
| 018 | Footprinting | Partial | Trap endpoints, 4xx probing; passive recon is invisible. |
| 019 | Account Creation | **Labelled** | Honeypot/timing signals on auth-like paths; token-required registration. |
| 020 | Account Aggregation | Generic | Token-required paths, bot signals on aggregator logins. |
| 021 | Denial of Inventory | Generic | Bot detection + PoW cost on add-to-cart/hold paths; no hold-pattern logic. |

Honest summary: **6 of 21 are labelled**, 11 are covered only by generic bot
detection, 2 partially, 2 not at all. Earlier drafts of this document claimed
"all 21"; that was not true.

---

## 6. Deployment checklist

1. **Secret:** ≥ 32 random bytes (`python -c "import secrets; print(secrets.token_hex(32))"`), from a secret store, never committed; the same value on all origin instances and the edge worker.
2. **TLS** everywhere between browser, edge and origin (AEGIS does not terminate TLS).
3. **Behind a proxy/CDN:** set `trusted_proxies` / Express `trust proxy`, otherwise all clients share one IP (rate limits) or attackers spoof `X-Forwarded-For`.
4. **Status API, GraphQL, live feed:** mount behind admin authentication; set `authorize`/`allowedOrigins` on the WebSocket feed.
5. **ML service and Redis:** private network only; Redis with authentication or TLS.
6. **Secret rotation:** changing the secret invalidates all tokens and open challenges (users re-run telemetry automatically). Rotate after any suspected leak.
7. **Start in `monitor` mode,** review `/aegis/events` and the dashboard, then switch to `enforce`.
8. **Several instances:** configure Redis (`AEGIS_REDIS_URL` / `store`), or replay protection and limits are per instance.
9. **Content Security Policy:** allow `'wasm-unsafe-eval'` if you want the fast PoW solver.
10. **Probes and metrics:** use `/aegis/health` for liveness and `/aegis/ready` for readiness (it fails while Redis is down, so traffic moves to healthy instances). Scrape `/aegis/metrics` from inside the network only, and alert on `aegis_store_errors_total` and `aegis_ml_errors_total`.
11. **Memory:** without Redis, each process keeps at most ~100,000 keys per per-client map (about 250 MB in Node). Size container limits for that; under heavy IP rotation, Redis gives exact rate limits.
12. **Self-test before go-live:** run `bots/run_pentest.py` against a staging copy (never against sites you do not operate).

---

## 7. Privacy and data handling

| Data | Where | Retention |
|---|---|---|
| Behaviour statistics (timing/geometry aggregates; no key contents, no text, no URLs, no raw user agent) | Request body of `/aegis/telemetry`; not stored unless you enable `on_record` logging | Request lifetime |
| Device fingerprint | Only as a SHA-256 hash | Request lifetime |
| Session record (request times, paths, risk scores; no IP) | Memory or Redis | 30 min of inactivity |
| Rate-limit windows (keyed by full client IP) | Memory or Redis | The window length (≤ 60 s by default) |
| Dashboard events (path, verdict, score, reasons, IP truncated to /24 or /48) | Memory, last 500 | Process lifetime |

The research study's data dictionary, consent forms (English and Bangla) and
retention plan are in `docs/thesis/irb/`. Operators who add logging are
responsible for consent and retention under their jurisdiction.

---

## 8. Verification

| What | Where |
|---|---|
| Unit and integration tests (TypeScript, Python) | `packages/*/tests` — run in CI on Node 22/24 and Python 3.10–3.12 |
| Real-browser end-to-end (Chromium → SDK → server → ML) | `e2e/sdk-flow.test.mjs` |
| API contract (both servers, every documented status exercised) | `contracts/openapi.json`, `server-node/tests/openapi.test.ts`, `server-python/tests/test_openapi.py` |
| Shared state across instances, Redis outage | `core/tests/store.test.ts`, `server-node/tests/sharedStore.test.ts`, `server-python/tests/test_store.py` (live Redis in CI) |
| Edge worker in the Workers runtime | `wrangler dev` runs recorded in THESIS_NOTES §2.11 |
| Dependency audit | `npm audit`, `pip-audit` in CI |
| Detection quality | Synthetic data only (THESIS_NOTES §5, results/phase_c). **Real bots: Phase F. Real humans: November study.** |

## 9. Reporting a vulnerability

Please do not open a public issue. Use GitHub's private vulnerability
reporting on the repository (Security → Report a vulnerability) if it is
enabled, or contact the maintainer privately. Include the version or commit,
a reproduction and the impact you see.

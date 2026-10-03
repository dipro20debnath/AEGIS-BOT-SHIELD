# AEGIS BOT SHIELD — Thesis Notes

> Living notebook for the B.Sc. thesis. Every experiment, design decision,
> bug and result that may end up in the thesis is recorded here, newest first
> inside each section.
>
> **Student:** Dipro Debnath · **Supervisor:** Rishad Amin Pulok (Lecturer, CSE, Metropolitan University)
> **Semester:** Fall 2026 · **Last updated:** 2026-10-03

---

## 0. Status at a glance

| Item | Status |
|------|--------|
| Thesis proposal (LaTeX) | Done — `docs/thesis_proposal.tex` |
| ML pipeline runs end-to-end | Done (fixed 2026-10-02, see §4) |
| Synthetic-data experiment | Done — `docs/thesis/results/synthetic/` |
| Ethics / IRB application | **Submission planned Oct 21**; drafts ready in `docs/thesis/irb/` (protocol, consent EN+BN, data dictionary) — fill the [bracketed] fields, supervisor review |
| Real human data (30–50 participants) | Nov 11–25, after IRB approval (see §0.1) |
| Real bot traffic (5 tools) | Oct 22 – Nov 10 (no IRB needed, see §0.1) |
| Phase D (Redis, live dashboard, GraphQL, edge worker, load test) | Done — §2.11, `docs/thesis/results/phase_d/` |
| Phase E (OpenAPI contract, whitepaper, reference docs, release readiness) | Done — §2.12, `docs/`, `contracts/openapi.json` |
| Results on real data | Not started |
| Thesis writing | Not started (Dec 1–15) |

### 0.0 Component status after Phase A (2026-10-03, measured)

| Component | Builds | Tests | Wired |
|-----------|--------|-------|-------|
| ML engine (Python) | Yes | 31 | Used by the Python server (local model) and Node server (ML service URL) |
| Core engine (TS) | Yes (was 74 errors) | 55 | DetectionEngine runs the real modules |
| JS SDK (TS) | Yes (was 3 errors) + 35 KB browser bundle | 24 | Sends the 50-feature contract to /aegis/telemetry |
| Server Python | Yes | 40 (FastAPI, Flask, Django, Node interop, ML in loop) | Telemetry endpoint, tokens, ML scoring |
| Server Node (TS) | Yes (was 15 errors) | 15 (Express, Fastify, http, Python interop) | Core engine + ML service |
| Dashboard | Yes (Vite) | type-checked | Reads live server stats; ML page reads results.json |
| End-to-end | — | 4 (real Chromium -> SDK -> server -> ML) | — |
| Data-collection website | Phase G | — | — |

Phase B progress (2026-10-03): B1 security layer, B2 live feeds + session
patterns, B3 anti-detect + WebGPU + memory-hard challenge, B4 QUIC fingerprint
parser, B5 Docker done (**Checkpoint B reached**). Core 123 tests, SDK 45, Node 23,
Python 77, ML 31, e2e 5; `docker compose up` verified with a real browser.
Phase C (ML) done 2026-10-03: ML tests 40; results in `docs/thesis/results/phase_c/`.

Before Phase A (2026-10-02 audit): only the ML engine worked; core/SDK/Node did
not compile, no layer called another, the SDK sent no behavioural data, and the
dashboard showed hardcoded numbers.


 (IRB submission moved to Oct 21)

Approval usually takes 2–3 weeks, so it is expected **Nov 4–11** instead of
late October. That moves the human study from Nov 1–20 to about Nov 11–25, so
it now runs in parallel with the analysis.

| Dates | Work | Needs IRB? |
|-------|------|-----------|
| Oct 3–20 | Prepare IRB packet (protocol, consent EN+BN, data handling plan); build data-collection website + logging endpoint; write the 5 bot scripts | No |
| **Oct 21** | **Submit IRB** (supervisor signature) | — |
| Oct 22 – Nov 10 | Collect bot traffic against the test site; pilot the full pipeline on real bot data + synthetic humans; dry-run the website with the researcher only | No: no human participants |
| ~Nov 4–11 | IRB approval expected | — |
| Nov 11–25 | Human data collection (target 30–50; minimum 30) | Yes |
| Nov 20 – Dec 5 | Train/evaluate on real data, group ablation, bootstrap CIs; write Ch. 1–3 in parallel | — |
| Dec 1–15 | Ch. 4–8 | — |
| Dec 15–20 | Slides | — |
| Dec 22–30 | Defense | — |

Risks:
- Approval after Nov 11 leaves less than 2 weeks for 30+ participants.
  Mitigation: recruit and schedule participants in advance; book a lab
  session where 10–15 people take part at once.
- IEEE ICCIT (deadline est. Oct–Nov) cannot include real human data. Target
  ECCE (Nov–Dec) or ICIEV (Dec–Jan) for a paper with real results.
- Ask the supervisor whether the study qualifies for expedited/exempt review
  (minimal risk: anonymised timing data only, no keystroke content, no
  screenshots); that could shorten approval.

---

## 1. Research questions and current evidence

| RQ | Question | Evidence so far (synthetic only) |
|----|----------|----------------------------------|
| RQ1 | How well does the stacked ensemble (XGBoost + RF + LR → LR meta) separate humans and bots? | 5-fold CV: F1 0.9706 ± 0.0044, AUC 0.9962 ± 0.0015 (§5.2) |
| RQ2 | Which signal categories contribute most? | Group ablation: network > fingerprint > behavior ≈ session (§5.3) |
| RQ3 | Does the multi-layer design beat single-layer detection (FPR < 2%)? | Behavior-only recall@FPR≤2% = 0.80 vs full 0.96; replay bots: 5% → 77–84% recall (§5.4) |
| RQ4 | Robustness against evasion (residential proxy, stealth headless, replay)? | Replay bots are the weak spot: 76.8% recall at the tuned threshold (§5.4) |

**Every number above comes from synthetic data whose distributions were
designed by us. They show the pipeline works and illustrate the multi-layer
argument; they are not evidence of real-world accuracy.** The thesis claims
must be made on the November real-data experiment (human data ~Nov 11–25).

---

## 2. Methodology decisions (with reasons — cite in Ch. 3)

### 2.1 Decision threshold (2026-10-02)
- Requirement: FPR < 2% (blocking real users is costlier than missing a bot).
- Threshold = highest bot recall whose held-out FPR ≤ **1.5%** (2% target − 0.5% safety margin).
- Held-out predictions = 5-fold out-of-fold predictions on the training split
  + final-model predictions on the validation split (≈2,100 humans).
- Why not the validation split alone: it has only ~375 humans, so one human
  moves FPR by 0.27%. Measured over 5 seeds:

| Tuning method | Test FPR (mean ± std, max) | Test recall |
|---------------|----------------------------|-------------|
| Fixed 0.5 | 2.45% ± 0.62 (max 3.47%) | 96.32% |
| Validation split only, 2% | 2.40% ± 1.00 (max 3.47%) | 96.00% |
| Out-of-fold, 2% | 2.24% ± 0.62 (max 3.20%) | 95.89% |
| **Out-of-fold, 1.5% (chosen)** | **1.71% ± 0.62 (max 2.67%)** | **95.25%** |

- Thesis point: tuning a threshold exactly at the FPR budget overshoots it on
  unseen data; a margin is needed. Even with it, single runs can exceed 2%
  (max 2.67%), so report FPR with confidence intervals on real data.

### 2.2 Group ablation instead of only per-category ablation
- Removing a single behavioral category (mouse, keyboard, scroll or touch)
  changes F1 by < 0.3% — the categories are redundant (a desktop user has
  mouse + keyboard + scroll; removing one leaves the others).
- So we ablate **groups**: behavior (mouse+keyboard+scroll+touch = 35
  features), session (5), network (5), fingerprint (5); both "without X" and
  "only X"; 5-fold CV; threshold-free metrics (AUC, F1@0.5, recall@FPR≤2%).

### 2.3 Synthetic data design (Ch. 5)
`packages/ml-engine/aegis_ml/training/synthetic_generator.py`
- Humans: 70% desktop (mouse, no touch) / 30% mobile (touch, no mouse);
  20% never type; 10% bounce; 8% VPN, 3% datacenter (corporate), 2% falsely
  flagged as residential proxy.
- Five bot types, equal share:

| Bot type | Models | Main tells |
|----------|--------|-----------|
| simple_script | `requests`, `curl` | No JS → no behavior, empty fingerprint, datacenter IP |
| crawler | Scrapy | No JS, many unique paths, high request rate |
| headless_browser | Selenium, basic Puppeteer | Straight fast mouse, uniform typing, headless flags (70%) |
| sophisticated_bot | Puppeteer-stealth + Bezier cursor | Human-like with small shifts; residential proxy 60% |
| replay_bot | Replays recorded human traces in an antidetect browser | Behavior = human distribution; only session/network/fingerprint and trace-vs-profile device mismatch (25%) |

- Threats to validity: the separability is set by our chosen parameters;
  real bots and real humans may overlap more or less.

---

### 2.4 Rule-based risk fusion in the core engine (2026-10-03)
`packages/core/src/engine/RiskScorer.ts` fuses signals from all layers:
- Within a category: weighted mean of `value x confidence` (weights = signal weights).
  The old code divided by `sum(weight x confidence)`, which cancels confidence
  for a lone signal: a 0.4-confidence hint counted at full value.
- Across categories: **noisy-OR**, `score = 100 * (1 - prod(1 - s_c/100))`.
  The old weighted average let a weak signal in one layer *lower* a decisive
  one in another (measured: honeypot hit 98 + weak header hint -> 60, i.e.
  "challenge" instead of "block"). Noisy-OR treats layers as independent
  evidence, so adding a layer can only raise the score — the formal reason
  defense-in-depth helps. Two independent 50s give 75.
- Critical boosts (headless >= 85; value >= 95 & confidence >= 0.9 -> x1.2) unchanged.
- Thesis point: report this as the fusion rule for the rule-based layers; the
  ML ensemble is a separate scorer (§2.1). Independence is an assumption —
  correlated layers (e.g. datacenter IP + headless) will be over-counted.

### 2.5 Application-layer (payload) category (2026-10-03, Phase B1)
`InputValidator` (core TS + `aegis_shield/security.py`) adds pattern checks for
XSS, SQLi, path traversal, CRLF (headers) and prototype-pollution keys in the
path, query string and (Node) body. Its signals get their **own category
`payload`** instead of `protocol`:
- Measured problem: inside one category the score is a weighted *mean*. A SQLi
  signal (85 x 0.7) placed in `protocol` next to stronger header anomalies
  pulled the protocol score down: attack request 75 vs. clean 77.
- Payload inspection is independent evidence from header fingerprinting, so it
  is fused with noisy-OR like the other layers; the test now asserts that the
  injection request always scores higher.
- Maps to OWASP OAT-014 (Vulnerability Scanning).
- Limits for Ch. 7: pattern matching, not a WAF. Obfuscated payloads evade it.
  Free text can match. Password/token fields are skipped to avoid both false
  positives and logging secrets. The Python adapters inspect path + query only,
  because reading the body in middleware would consume the request stream.
- Benign-text test set (EN + Bangla, "O'Brien", "union jack", "Price < 500")
  produces no findings; a real FPR needs the November traffic.

`AntiTamper` signs server-to-server calls: `X-Aegis-Signature: t,n,s`, HMAC over
`METHOD\npath?query\nt\nnonce\nsha256(body)`, 300 s skew, nonce replay cache.
The nonce is checked **after** the HMAC, so unsigned requests cannot fill or
burn the cache. Node and Python produce byte-identical signatures (tested both
ways). Not usable from browsers (the secret would be public); browser requests
keep using the server-issued AEGIS token.

`securityHeaders` / `SecurityHeadersMiddleware`: OWASP Secure Headers defaults
(CSP `default-src 'self'`, HSTS 1 y, X-Frame-Options DENY, nosniff,
Referrer-Policy, Permissions-Policy, COOP). These harden the protected site;
they do not detect bots and should not be counted as a detection layer.

### 2.6 Live IP lists and session patterns (2026-10-03, Phase B2)
**Tor and threat feeds** (`TorExitNodeChecker`, `ThreatFeedSync`, Python `feeds.py`):
Tor Project bulk exit list, FireHOL level1, Spamhaus DROP v4, AbuseIPDB
(confidence >= 90, only with an API key; free plan = 5 downloads/day, so at
most every 6 h). All off by default (`liveFeeds` / `live_feeds=True`), refreshed
in the background, cached on disk, and a failed or empty download keeps the
previous list.
- **Removed fabricated data:** the old code hard-coded 4 "sample" Tor IPs in
  both servers and labelled them as Tor exits. Without a live list, nothing is
  classified as Tor now. Any earlier `is_tor` values were meaningless.
- **Measured on the real FireHOL level1 (2026-10-02, 4,650 lines):** it contains
  13 special-purpose ranges, including 10.0.0.0/8, 127.0.0.0/8, 192.168.0.0/16,
  CGNAT 100.64.0.0/10 and TEST-NET 198.51.100.0/24. Imported as-is it would
  block localhost, every request behind a reverse proxy and carrier-NAT mobile
  users, which matters for Bangladesh's mobile-heavy traffic. These ranges are
  dropped (RFC 6890); bogons are handled separately by IPAnalyzer. 4,637 entries
  remain, covering about 0.5% of random public IPv4 addresses.
- Lookup: the old ThreatDatabase scanned every CIDR linearly. It is now an index
  by prefix length: 1.6 µs per lookup with the full FireHOL list (Node, 100k lookups).
- Validity note: a listed IP means the host attacked *someone*, not that this
  request is a bot (shared NAT, recycled cloud IPs). In Python the list
  signals appear both in the telemetry token score and in the request score,
  so they are counted twice under noisy-OR (the independence assumption of
  §2.4 is violated here; same for header signals). Mention in Ch. 7.
- Sandbox note: the Tor and Spamhaus URLs were blocked by the development
  proxy, so their parsers are tested against the documented formats; FireHOL
  was tested against a real excerpt.

**Session patterns** (`BotBehaviorAnalyzer`, Python `session_patterns.py`), no
JavaScript needed, so they catch plain HTTP-library bots:
| Signal | Rule | Min. evidence |
|---|---|---|
| timer_regular | CV of gaps between page requests < 0.15, mean < 60 s | 8 pages |
| sequential_ids | >= 5 consecutive pages whose trailing number changes by a constant step (OAT-011) | 5 pages |
| crawl_breadth | > 90% distinct pages within 5 min (OAT-011) | 30 pages |
| error_probing | > 50% 4xx responses (OAT-014) | 10 responses |
| no_referer | no page after the first carries a Referer | 5 pages |
| no_assets | pages without any CSS/JS/image request (opt-in: wrong with a CDN) | 5 pages |
- 200 simulated human sessions (log-normal reading times, random pages): 0
  flagged in either implementation. This is a sanity check only; the false-positive
  rate must come from the November human data.
- Evasion: random delays plus link-following plus asset loading (a real browser)
  pass all of these checks; that is the behavioural SDK layer's job. This
  layering argument supports RQ3.

### 2.7 Anti-detect browsers, WebGPU and the memory-hard challenge (2026-10-03, Phase B3)
**AntiDetectDetector** (SDK): anti-detect browsers (Multilogin, GoLogin,
Dolphin, AdsPower) replace individual fingerprint values per profile. Each
value looks plausible on its own; the detector looks for *combinations* a real
device cannot produce. 8 passive checks, fused with noisy-OR; "suspected" at >= 0.7:
| Check | Example | Weight |
|---|---|---|
| uaPlatformMismatch | Windows UA, `navigator.platform` = MacIntel | 0.9 |
| clientHintsMismatch | UA vs `userAgentData` platform/version/mobile | 0.9 |
| gpuOsMismatch | Apple M-series or Metal renderer on a Windows UA; Direct3D on Mac | 0.8 |
| webglWebgpuMismatch | WebGL says NVIDIA, WebGPU adapter says Apple (tools spoof WebGL, often not WebGPU) | 0.7 |
| timezoneMismatch | `Intl` zone offset differs from `Date.getTimezoneOffset()` | 0.8 |
| screenInconsistent | window larger than the screen, avail > total | 0.5 |
| languageMismatch | `navigator.language` differs from `languages[0]` | 0.6 |
| nativeOverride | navigator getter redefined by script (also catches puppeteer-stealth) | 0.9 |
- False-positive guards that are in the tests: Android (Linux platform),
  iPadOS (Mac platform) and hybrid-GPU laptops (Intel/AMD iGPU with an NVIDIA/AMD
  dGPU report different vendors in WebGL and WebGPU) are accepted.
- The result goes to the server as `antiDetect {score, checks}`, **outside the
  50-feature ML contract**, so trained models stay valid. The server adds the
  rule signal `anti_detect` = 80 x score, but only when score >= 0.5.
- Limit: a profile that keeps all values consistent and patches at the C++
  level (not in JS) passes. No real anti-detect browser was available for
  testing; all cases are constructed from documented leak patterns. **Test this
  with a real GoLogin/Multilogin trial in November before claiming detection rates.**

**WebGPUFingerprinter**: adapter vendor, architecture, features and limits.
Requests an adapter only (no device), with a 1.5 s timeout because some drivers
hang. Browsers deliberately coarsen `GPUAdapterInfo` to the vendor/family, so it
identifies the GPU family, not the machine. Headless Chromium has no adapter,
so "unsupported" is normal and not a bot signal. Its main use is the WebGL
cross-check above. Do a literature check before calling it novel; WebGPU
fingerprinting papers appeared from 2023 on.

**Memory-hard proof of work** (SDK + both servers):
- **Puzzle:** find a nonce with scrypt(challenge:nonce, seed, N=4096, r=8, p=1)
  having >= 4 leading zero bits. That is 4 MiB of memory per attempt and 16
  attempts expected. The challenge is HMAC-signed and expires after 120 s.
- **Implementation:** scrypt's ROMix runs in a 1,182-byte WebAssembly module
  generated from a script (CI checks that the committed bytes match the
  generator). PBKDF2 uses WebCrypto. Servers verify with the built-in
  `crypto.scrypt` / `hashlib.scrypt`. Outputs match Node's scrypt and the RFC
  7914 test vector. Node and Python issue and verify each other's challenges.
- **Measured in Chromium** (4-core cloud container, N=4096, r=8, one scrypt):
  WASM 13.7 ms median, pure JS 44.7 ms (3.3x slower), server-side native check
  9.5 ms. A full solve in the e2e test took 14 attempts / 166 ms. Low-end phones
  will be several times slower: **measure on real devices before choosing `bits`.**
- **Bugs found while building it** (good material for Ch. 4):
  1. WebCrypto exists only in secure contexts (HTTPS/localhost). On a plain-HTTP
     page the solver crashed. Fixed with a JS SHA-256/HMAC/PBKDF2 fallback,
     tested against Node's crypto.
  2. **Policy hole:** if a PoW token satisfied `require_token_paths`, a bot could
     pay ~0.2 s of CPU and skip the whole behavioural layer at login. Now a PoW
     token unlocks a token-required path only when the session also sent
     telemetry (`tel` claim). PoW on its own only turns a "challenge" verdict
     into "allow", and never lifts a "block". The e2e test checks this with a real browser.
  3. **Double counting:** the PoW token first carried the last request risk.
     The next request recomputes the same request signals, so noisy-OR counted
     them twice: a client at 62.5 jumped to 86 (block) after solving. The token
     now carries only the telemetry score.
- **DoS:** each challenge id is burnt before the scrypt check, so one issued
  challenge costs the server at most one ~10 ms verification. Both endpoints
  still need rate limiting.
- **What it proves:** CPU time and memory, not humanity. Cost estimate: 1 million
  credential-stuffing attempts at 16 x 13.7 ms is about 61 CPU-hours. That is an
  economic deterrent for mass automation, not a defence against a single
  targeted bot.

### 2.8 QUIC (HTTP/3) client fingerprinting (2026-10-03, Phase B4)
`packages/core/src/modules/fingerprint/quic.ts`, `QUICFingerprinter.ts`, `pcap.ts`.
- **Why it is possible:** a client's QUIC Initial packets are encrypted with keys
  derived only from the Destination Connection ID in the clear (RFC 9001 §5.2).
  Any on-path observer can decrypt them. The parser does this:
  1. HKDF key derivation (QUIC v1 and v2);
  2. header-protection removal;
  3. AES-128-GCM decryption;
  4. CRYPTO-frame reassembly by offset;
  5. TLS ClientHello parsing.
- **Outputs:**
  - JA4 with protocol `q` (FoxIO JA4 spec);
  - a QUIC transport-parameter fingerprint (sorted ids plus integer values;
    GREASE ids removed);
  - SNI, ALPN, key-share groups;
  - a stack guess: chromium, library or unknown.
- **Verified against the standards:** the derived keys equal **RFC 9001 Appendix
  A.1**, and the header-protection mask equals A.2. The QUIC v2 keys equal **RFC 9369 A.1**.
- **Real captures (fixtures):**
  - **Chromium 141:** 6 UDP datagrams from headless Chromium. The 1.7 KB
    ClientHello (X25519MLKEM768 post-quantum key share, `0x11ec`) is spread over
    5 Initial packets and **35 CRYPTO frames in shuffled order**. This is Chrome's
    deliberate "chaos protection" against ossified middleboxes, so offset-based
    reassembly is required. Chromium traits seen:
    - `google_version` transport parameter `0x4752`;
    - a GREASE transport parameter with a 62-bit id;
    - the ALPS extension `0x44cd`.
  - **aioquic 1.3.0 (Python):** the ClientHello fits in 1 packet;
    JA4 `q13d0307h3_55b375c5d22e_1cecd519fee8`; transport parameters
    sorted ascending; no GREASE.
  - **How they differ:** the two share the TLS 1.3 cipher hash. They differ in
    the extensions/signature-algorithms hash, the transport-parameter set and
    values, and the presence of GREASE. That is enough to tell a Python HTTP/3
    bot that claims a Chrome user agent apart from Chrome: rule signal
    `quic.ua_mismatch` (75) plus `quic.library_client` (70).
- **Bug found:** Chrome's GREASE transport-parameter ids are 62-bit numbers.
  JavaScript numbers lose precision above 2^53, so the RFC 9000 GREASE test
  (31·N + 27) failed. It now uses BigInt.
- **Deployment limit (must be stated):**
  - Node never sees QUIC packets. HTTP/3 is terminated by the reverse proxy or
    CDN (nginx, Caddy, Cloudflare), and none of them exposes the transport
    parameters.
  - So this is a **passive sensor**: offline from a packet capture
    (`tcpdump -w quic.pcap udp port 443` →
    `node packages/core/scripts/quic-fingerprint.mjs quic.pcap`), or live from a
    UDP tap or port mirror feeding `QuicInitialAssembler`.
  - Joining a fingerprint to an HTTP request needs the client IP and port from
    the proxy. Behind a CDN, the CDN's own QUIC client is what you see.
- **Gaps:**
  - Only 2 client stacks captured (Chromium and aioquic). In November, also
    capture Firefox (neqo), Safari, curl (ngtcp2/quiche) and quic-go before
    claiming generality.
  - The Chromium capture targeted an IP literal, so it has no SNI (JA4 `i`
    instead of `d`). Hostname resolution was not available in the sandbox.
  - pcapng and IPv6 extension headers are not parsed.

### 2.9 Containers and Checkpoint B (2026-10-03, Phase B5)
**Setup:** one multi-target `Dockerfile` and a working `docker-compose.yml`.
| Service | Contents |
|---|---|
| `ml` | Inference service; internal only, because `/train` has no authentication |
| `api-python` | FastAPI reference server, model in-process |
| `api-node` | Express server, ML via the `ml` service |
| `dashboard` | nginx serving the Vite build, `/aegis` proxied to `api-node` |

- **Removed from the old setup:** the previous compose file started
  `packages/core/dist/index.js`, which is a library that exits at once, plus an
  unused Postgres and an empty nginx. All removed.
- **Checkpoint B, verified in the dev container** (Docker 29):
  - all 4 images build;
  - `docker compose up` gives healthy services;
  - `curl` to the login is challenged;
  - the dashboard proxy shows live stats;
  - `ml` is unreachable from the host;
  - headless Chromium through the stack is blocked at login on both servers
    (scores 98.5 and 100), with `api-node` calling `ml /predict`.
- **Bugs that only Docker exposed:**
  1. **Packaging:** `aegis_ml` subpackages had no `__init__.py`, so a normal
     `pip install` shipped only the top-level module, and importing failed.
     `pip install -e` (used everywhere until now) hides this. Fixed. The CI e2e
     job now installs non-editable, to catch it in future.
  2. **Stale `tsconfig.tsbuildinfo`:** copied into the build context, it made
     incremental `tsc` skip emitting core's `dist/`. Now excluded in `.dockerignore`.
- **Security-audit failure (same day):** a new advisory, GHSA-vfj7-8cjw-p6xm
  (`braces`, all versions), came in only through dev tooling (jest 29,
  typescript-eslint 7, tailwind 3). Fixed by upgrading to jest 30,
  typescript-eslint 8 and tailwind 4. No runtime dependency was affected.
- **Image sizes:**
  - dashboard 93 MB;
  - api-node 313 MB;
  - each Python image 1.64 GB, mostly xgboost's CUDA libraries. A CPU-only
    build would shrink this (to do).
- **Limits:**
  - the bundled model is synthetic;
  - state is in memory (one replica per service until Redis in Phase D);
  - no TLS termination (put a reverse proxy in front).

### 2.10 Phase C: model comparison, SHAP, sequence models (2026-10-03)
Code: `aegis_ml/evaluation/` (compare, stats, explain, plots, trajectory_experiment),
`aegis_ml/trajectories/`, `aegis_ml/models/sequence_models.py`. Reproduce with:
- `scripts/phase_c_experiment.py`: about 15 min on 4 CPUs;
- `scripts/phase_c_seed_robustness.py`: about 20 min.

Report, figures and JSON: `docs/thesis/results/phase_c/`. **All data is synthetic.**

**C1 Model comparison (identical 5-fold CV, 5,000 sessions, stratified bootstrap
95% CIs, paired differences):**
| Model | AUC-ROC | Recall @ 2% FPR | p50 latency |
|---|---|---|---|
| Logistic regression | 0.9947 (0.9931–0.9961) | 0.961 | 0.29 ms |
| Random forest | 0.9931 (0.9910–0.9950) | 0.956 | 58 ms* |
| XGBoost | 0.9939 (0.9919–0.9955) | 0.955 | 0.33 ms |
| Stacked ensemble (AEGIS) | 0.9940 (0.9920–0.9958) | 0.960 | 1.16 ms |

- **The ensemble is not significantly better than logistic regression or
  XGBoost** (paired ΔAUC CIs include 0). It beats the random forest by
  +0.0008, which is statistically significant but negligible.
- On this synthetic feature space, a linear model is enough. Do not claim the
  ensemble helps until the real data shows it.
- *The standalone RF latency is joblib thread dispatch (`n_jobs=-1`) for a single
  row. The production ensemble evaluates the RF through FlatForest (§4), at 1.16 ms total.

**C1b Unseen bot types (leave one type out):**
- Recall on the held-out **replay bot** is only **0.36–0.47** at 2% FPR, for
  every model. It is also the weakest type even when it is seen in training
  (0.79–0.82).
- A bot that replays recorded human behaviour cannot be separated by
  behavioural features alone. This is the quantitative argument for the
  non-behavioural layers (session patterns, IP reputation, proof of work): RQ3.

**C2 SHAP** (TreeSHAP on the XGBoost component, computed with XGBoost's
built-in `pred_contribs`, which matches the `shap` package; exact, additivity error 5e-6;
1.8 ms per explanation):
- **Network features dominate** (`ip_reputation` mean |SHAP| 2.78), then
  `headless_confidence` 1.60, then `session_reputation` 0.83.
- This reflects the synthetic generator, which gives bots bad IP reputation.
  Real bots behind residential proxies will make this feature far weaker.
  **Re-run SHAP on the November data before interpreting it.**
- Rank agreement with the other base models: RF 0.75, LR 0.55 (Spearman).
  So explaining only the XGBoost part is a reasonable but imperfect proxy for
  the ensemble.
- Available per request: `InferenceEngine.explain()` and
  `POST /predict {"explain": true}`. This can back a dashboard "why was I
  blocked" view.

**C3 Raw mouse trajectories** (new simulator: minimum-jerk + Fitts' law +
tremor + overshoot for humans; linear / teleport / Bézier (ghost-cursor) /
humanized / replay bots):
- **First attempt failed for set-up reasons.** Deep models on raw `(dx, dy, dt)`
  at 6 epochs reached only AUC 0.54 (LSTM) and 0.88 (CNN). Fixed by:
  1. adding speed, turning-angle and pause channels;
  2. standardising each channel;
  3. a strided-convolution front end before the LSTM;
  4. training for 20 epochs with best-validation checkpointing.
  Report this as tuning that was needed, not as a property of the method.
- **Mixed split** (4,000 trajectories), AUC:
  | Model | AUC |
  |---|---|
  | Features + RF | 0.996 |
  | Features + XGBoost | 0.999 |
  | 1D-CNN | 0.998 |
  | Conv-LSTM | 0.998 |

  Sequence models add **nothing** when every bot type is in training.
- **Unseen bot type, 3 seeds (mean ± sd recall @ 2% FPR):**
  | Held-out type | Feature models | Sequence models |
  |---|---|---|
  | linear | 0.10–0.17 | **0.95–0.98** |
  | Bézier | 0.27 ± 0.44 (RF), ≈0 (others) | ≈0 |
  | replay | 0.14–0.44 | 0.26–0.36 |
  | teleport, humanized | ≈1 | ≈1 |

  - **Linear:** sequence models generalise; feature models do not.
  - **Bézier (ghost-cursor style):** essentially undetected when unseen.
  - **Replay:** hard for all models.
- **Lesson on single seeds:** the first single-seed run reported Bézier at 0.98
  for RF. Across seeds it is 0.27 ± 0.44. Single-seed generalisation numbers are
  unreliable; always report several seeds.
- **Thesis claim supported:** the model families fail on different unseen
  attacks, so diversity (features + sequence models, plus non-behavioural layers)
  is what helps generalisation, not one "best" model.
- **Latency:** CNN 1.1 ms and LSTM 1.7 ms per trajectory on CPU, which is
  acceptable server-side.
- **Not integrated in the live pipeline yet.** The SDK sends only summary
  features, and sending raw trajectories needs an IRB/privacy decision (they
  are richer behavioural data). Decide before the November study.

**Figures (300 dpi PDF + PNG):**
- `fig_c1_roc_pr`: ROC on a log-FPR axis with the 2% budget marked, plus PR, with bootstrap 95% bands;
- `fig_c1_unseen_bot_types`;
- `fig_shap_importance`;
- `fig_trajectory_examples`;
- `fig_c3_trajectory_roc_pr`;
- `fig_c3_trajectory_unseen_types`.

**Colour and print:** colours come from a validated palette (CVD-safe). The
two low-contrast hues also differ in line style, so the figures survive
grayscale printing.

### 2.11 Phase D: shared state, live dashboard, GraphQL, edge, load test (2026-10-03)

**D1 Shared state in Redis** (`packages/core/src/store/`, `aegis_shield/store.py`,
same key layout in both languages):
- **Why:** with several server processes, in-process state is wrong, not just
  slow. Each process would accept a replayed proof-of-work solution or signed
  request once, and a rate limit of N would be N per process.
- **Design:**
  | State | Redis operation | Consistency |
  |---|---|---|
  | Spent challenges, request nonces, single-use tokens | `SET … PX ttl NX` | Atomic: exactly one instance wins |
  | Rate-limit windows | Sorted-set sliding log in one Lua script, Redis clock | Atomic; immune to clock skew between instances |
  | Sessions | One JSON value per session, TTL 30 min | Last-writer-wins (a lost update drops one request time) |
- **Verified:** two server instances on one store (in-memory shared object and
  a live Redis):
  - a challenge redeemed at A is rejected at B (`replay`);
  - a rate limit of 2 is enforced across A and B (3rd request blocked);
  - the telemetry score from A is carried into a token issued by B.
- **Outage behaviour (found by testing, then fixed):** the first version let
  a Redis outage turn into fail-open. The store error escaped the analysis,
  the adapter's "never take the site down" rule let the request through, and
  a login without a token reached the application (HTTP 401 from the app
  instead of 403 from AEGIS). Now store reads and writes degrade: the request
  is analysed with a fresh session, without rate limits. Replay checks refuse
  (`503`) rather than accept. Re-tested by stopping Redis under a running
  server: 403 before, during and after the outage.
  - **Thesis point:** availability-first error handling can silently become a
    security bypass once a dependency is added. Each dependency failure needs
    its own decision (degrade vs. refuse).

**D2 WebSocket live feed** (`server-node/src/live.ts`; dashboard `useLiveStats`):
- **Batching:** events go out in batches every 250 ms, at most 200 per batch,
  with a count of the rest. A traffic spike costs one message per client per
  250 ms, not one per request.
- **Slow clients:** a client with more than 1 MB buffered skips batches, so
  the server's memory does not grow.
- **Access control:** the `authorize` and `allowedOrigins` options control who
  may connect (tested: wrong origin 403, no credentials 401, valid 101).
- **Dashboard fallback:** the dashboard falls back to 5 s polling and
  reconnects with backoff; verified in Chromium by killing the server.
- **Bug found while verifying:** the bar chart stayed empty under live
  updates. Recharts restarted its entry animation on every update, so the bars
  never finished drawing. Animation is now off for live charts.

**D3 GraphQL** (`server-node/src/graphql.ts`): read-only (no Mutation type).
- **Limits against cost amplification:** 8 KB documents, 10 root fields per
  operation counted through aliases and fragments, `limit` ≤ 500, so at most
  10 × 500 events per request.
- **No depth limit needed:** the schema has no recursive types.

**D4 Cloudflare Worker** (`packages/edge-cloudflare`):
- **What it does:** token verification with WebCrypto (HMAC-SHA256 +
  AES-256-GCM), user-agent binding, block-verdict refusal, the
  proof-of-work-is-not-telemetry rule, and rate limiting.
- **Tested in Node (12 tests):** tokens from both `@aegis/core` and the Python
  server verify; forged, expired and other-UA tokens are rejected; spoofed
  `X-Aegis-Edge` headers are stripped.
- **Tested in workerd** (`wrangler dev`, the real Workers runtime), in front of
  the Express demo:
  | Request | Result |
  |---|---|
  | Valid token | 200, forwarded with `verified; score=12` |
  | No token | 403 challenge |
  | Forged token | 403 |
  | Token with block verdict | 403 |
  | Token from another user agent | 403 |
  | 130 requests against a 120/min binding | 113 × 200, 17 × 429 (some budget already used) |
- **Browser through the edge:** headless Playwright still got blocked by the
  origin (telemetry score 100: headless + anti-detect signals). The edge passed
  the origin's verdict on unchanged.
- **Limits:**
  - the Rate Limiting binding counts per Cloudflare location and is eventually
    consistent;
  - the per-isolate fallback bounds only one isolate;
  - not deployed to a real zone (needs the student's Cloudflare account).

**D5 Load test** (`loadtest/`, results `docs/thesis/results/phase_d/load_test.{md,json}`):
- **Method:**
  - closed-loop generator with 32 keep-alive connections;
  - every latency recorded, so percentiles are exact;
  - each request from a random 10.x client address via `X-Forwarded-For`, so
    per-IP limits are evaluated but never triggered;
  - servers in monitor mode, so every request runs the whole pipeline and the
    handler;
  - 3 × 10 s runs per scenario, median reported;
  - unloaded latency measured separately with 1 connection.
- **Machine:** 4-vCPU Xeon VM, with the generator and Redis on the same
  machine. Absolute numbers are a lower bound; compare rows with each other.
- **Results** (page request; server time = 1 / saturated throughput of one process):
  | | req/s | Server time per request | Unloaded p50 |
  |---|---|---|---|
  | Express | 6123 | 0.163 ms | 0.20 ms |
  | Express + AEGIS | 2816 | 0.355 ms (+0.19) | 0.48 ms |
  | Express + AEGIS, Redis | 2716 | 0.368 ms (+0.21) | 0.75 ms |
  | FastAPI | 1693 | 0.591 ms | 0.73 ms |
  | FastAPI + AEGIS | 1247 | 0.802 ms (+0.21) | 0.86 ms |
  | FastAPI + AEGIS, Redis | 724 | 1.381 ms (+0.79) | 1.38 ms |
  | FastAPI + AEGIS, Redis, 4 workers (128 conns) | 1878 | – | – |
  | Telemetry + ML, Node → ML service (HTTP) | 936 | 1.07 ms | 1.94 ms |
  | Telemetry + ML, Python in-process | 458 | 2.18 ms | 2.35 ms |
- **Answer for the thesis:** the rule pipeline costs about **0.2 ms of server
  time per request** in both languages, well under the 5 ms target. The ML
  model dominates the telemetry endpoint (≈1–2 ms), consistent with §5.5.
- **Findings, each measured before acting on it:**
  1. **Python + Redis was slow** (490 req/s at first). A profile showed 626 µs
     per request versus 51 µs in memory: three synchronous Redis calls of
     ~100–200 µs each (`PING` 100 µs here, `redis-cli --latency` 0.54 ms).
     - Saving the session once per request (with the response status) brought
       it to 404 µs.
     - hiredis gave only 626 → 581 µs.
     - Moving the analysis into Starlette's threadpool made it *worse*
       (432 req/s; ML 281 vs 437) because of GIL contention, so it was
       reverted.
     - Kept: fewer round trips, and scaling out with workers, which Redis
       makes correct.
  2. **Four uvicorn workers at first showed no gain** (630 vs 590 req/s).
     Per-process CPU showed one worker at 68% and three at 9–17%: keep-alive
     connections stay with the worker that accepted them. With 128
     connections, three workers were busy and throughput was 1856–2165 req/s.
  3. **uvicorn 0.50's multi-worker mode adds ≈44 ms per keep-alive request,**
     even without AEGIS (43.9 ms vs 0.68 ms with one worker). The 4-worker
     latencies are reported as an artefact; only that row's throughput counts.
  4. **Node's RSS with in-process state reached ~720 MB** after ~100 k distinct
     simulated clients (each creates sessions and per-IP entries), vs ~470 MB
     with Redis. This is bounded only by the caps in the engine maps (sessions
     are cleared at 100 k). Profile it in Phase F (memory per client, eviction
     policy).
  5. **FastAPI + AEGIS in-process had a high p99** (95–176 ms vs a p95 of
     33 ms). Not investigated yet (likely GC or eviction pauses); Phase F.

### 2.12 Phase E: documentation, API contract, release readiness (2026-10-03)

**What was wrong before:** the files under `docs/` predated the code and
described a different product:
- a cloud API with API keys and a CDN;
- an Isolation Forest, LightGBM and ONNX that do not exist;
- "covers all 21 OWASP automated threats";
- "TLS 1.3 in transit, AES-256 at rest" (AEGIS terminates no TLS and stores
  nothing encrypted at rest).

All were rewritten from the code. Statements that cannot be checked yet
(detection on real traffic) are marked as such.

**E1 One API contract for two servers** (`contracts/openapi.json`, OpenAPI 3.1):
- **Contract tests** send real requests to both servers and validate every
  documented status (200/400/403/413/429/503, denial 403, status API) against
  the schemas:
  - Node with Ajv (JSON Schema 2020-12);
  - Python with `jsonschema`;
  - the SDK's own telemetry payload is checked against the request schema;
  - negative tests prove the checker rejects bad bodies, e.g. an unmasked IP.
- **The document itself** is validated with `openapi-spec-validator`.
- **Serving:** the Node server serves it with Swagger UI (pinned version,
  SRI hashes; rendered in Chromium with no console errors).
  `add_aegis_openapi()` merges the middleware endpoints into FastAPI's `/docs`;
  FastAPI cannot see them because the middleware answers before the router.

**E2 Security whitepaper:**
- **Content:** threat model by attacker tier, with the test that backs each
  claim; token properties and known weaknesses; failure behaviour; deployment
  checklist; data inventory.
- **OWASP OAT mapping:** **6 of 21 labelled** by the engine, 11 only through
  generic bot detection, 2 partial, 2 not covered. A test fails if the table
  and `classifyThreats()` disagree.
- **Finding while writing the threat model:** tokens were bound to the user
  agent only. The `sid` claim was never compared with the request's session,
  so a token harvested in one browser could be replayed for 5 minutes from any
  client sending the same User-Agent string.
  - **Fix:** a token whose `sid` differs from the request's `aegis_sid`
    session is ignored and scored as risk (+60, `token_session_mismatch`), in
    the Node server, the Python server and the edge worker.
  - Tests, real-browser e2e and the edge tests updated; a browser keeps its
    cookie, so legitimate flows are unaffected.
  - **New constraint:** an API on another site must receive the cookie.
    Same-site subdomains work with `credentials: 'include'`; fully cross-site
    setups do not (the cookie is `SameSite=Lax`). Documented.
- **Known, not fixed:**
  - tokens are reusable within their TTL by the same session;
  - one secret keys both HMAC and AES (no KDF separation). Changing the token
    format is a `v2` decision because three implementations must change
    together.

**E3 Reference documentation** (getting started, configuration, integration,
API reference, architecture, ML guide):
- **Reserved options:** the engine's config type had options that nothing reads:
  - `redisUrl`, `behavioral.weights` / `minSignals`;
  - most of `challenges.*`, `logging.*`, `rateLimiting.adaptive`;
  - `ipIntelligence.blockVPN` / `blockTor` / `blockDatacenter` /
    `detectResidentialProxy`.

  They are documented as reserved and marked in the types, instead of being
  presented as working.
- **Tests that keep the docs true:**
  - every option of `AegisNodeOptions`, `AegisClientConfig`, the edge `Env`,
    `LiveFeedOptions` and Python's `AegisConfig` must appear in
    `configuration.md`;
  - every relative link and `#anchor` in the README and `docs/` must resolve
    (GitHub slug rules; a negative test confirmed it catches a broken anchor).
  - The first strict run found one undocumented option (`authorize`).

**E4 Release readiness (nothing published):**
- npm and PyPI metadata, per-package READMEs and licences, cross-platform
  `clean` scripts, and `prepublishOnly` builds and tests.
- `npm run release:check` (also a CI job) checks:
  - tarball contents (README, LICENSE, entry points; no tests or sources);
  - that all version strings agree;
  - `python -m build` + `twine check --strict` for both Python packages
    (all four distributions pass).
- An installed wheel loads the packaged OpenAPI document.
- **Names (2026-10-03):** `aegis-server-python` and `aegis-ml-engine` are free
  on PyPI. The `@aegis/*` npm names are unused, but the `@aegis` scope must be
  an npm organisation the student owns, otherwise rename the scope
  (docs/RELEASING.md).

### 2.13 Phase F: production readiness (2026-10-03)

**F1 Self pen-test with bots (`bots/`, results in `docs/thesis/results/phase_f/`).**

*Method.*
- Seven bot clients:
  - python-requests: naive; header-forging with hand-written human-like telemetry; the same forger waiting 11 s;
  - Scrapy;
  - Selenium (headless Chrome);
  - Puppeteer + stealth plugin;
  - Playwright, in two modes: headless stealth, and headed under Xvfb with Bézier mouse paths, jitter, irregular typing and pauses.
- 5 runs each against both demos in enforce mode, with the synthetic-data model.
- Targets restarted and Redis flushed before each bot. All bots share one IP,
  and per-IP velocity left by one bot would otherwise confound the next.
- "Passed" = the login request finally returned 200.
- A decision log (`AEGIS_RECORD_FILE`) gives each bot's telemetry score and signals.
- These scripts double as the bot side of the November data collection.

*Before → after (pass rate, Python / Node):*

| Bot | Before | After | Why |
|---|---|---|---|
| naive requests, Scrapy, Selenium, Playwright-stealth | 0/5 / 0/5 | 0/5 / 0/5 | headers, threat patterns, `ua_known_bot`, headless and linear-mouse signals |
| header-forger | **5/5** / 0/5 | 0/5 / 0/5 | new `telemetry.impossible_timing` (below) |
| forger waiting 11 s (new) | – | **5/5 / 5/5** | its telemetry is internally consistent; only a model trained on real data could tell |
| Puppeteer-stealth | **5/5** / 0/5* | **5/5 / 5/5** | score 48–49, just under the challenge threshold (50) |
| Playwright human-like | 5/5 (all via PoW) / 0/5* | 5/5 / 5/5 (all via PoW) | challenged (score 62–76), solves the proof of work |

\* Node "blocked" these only because of a false positive (finding 2), which
also hit real browsers.

*Findings and fixes:*
1. **Forged telemetry with impossible timing.**
   - The forger claimed 9.2 s of typing in a session it had opened moments earlier.
   - Both servers now compare the claimed interaction time
     (max of `kb_total_duration` and `mouse_pause_count × mouse_avg_pause_duration`)
     with the session's age, and flag `telemetry.impossible_timing` (75) when it is
     more than 1.1× the age + 2 s.
   - Applied only when the session existed before this telemetry, so a first
     telemetry without a cookie is not judged.
   - Simple to evade by waiting (the "patient" bot), but it raises the cost
     from zero to the claimed duration per login.
2. **False positive in the Node header check.**
   - `Accept: */*` was flagged on every request, but browsers send it on fetch/XHR (`Sec-Fetch-Dest: empty`).
   - Every SDK telemetry call and every API call from a real browser got
     `headers.accept_generic` (+value).
   - It is now flagged only for navigations (dest absent, `document` or `iframe`).
   - Lesson: the Node results "before" overstated detection. Any earlier Node
     measurement with real browsers carried this bias.
3. **What still passes is the honest result.**
   - Real Chrome with a stealth plugin, or with human-like scripted input, gets through.
   - The best layer against them is the proof of work, which costs time but does not stop a determined bot.
   - With the synthetic-data model, the ML layer is no evidence either way.
   - These are exactly the cases the real-data study must measure (RQ1/RQ2).

**F2 Memory and latency profile (`loadtest/memory-profile.cjs`,
`loadtest/memory_profile.py`; results in `phase_f/memory_profile.md`).**

The Phase D observation (~720 MB RSS for Node after ~100k clients, §2.11
finding 4) was traced to seven per-client maps:
- the limiters and IP counters had only time-based cleanup, which never runs
  out while an attacker keeps rotating IPs;
- `IPAnalyzer.cleanup()` was never scheduled;
- `SessionManager` scanned all sessions on each new client when full;
- `SessionRecords` cleared all sessions at 100k.

The cost was 2.9 KB per client, unbounded. That is a memory-exhaustion DoS via IP rotation (IPv6 makes rotation cheap).

**First fix, rejected after measuring.** Evicting one key at a time with
`map.keys().next()` was bounded but quadratic: V8's iterator skips deleted
entries at the front of the table. At 400k clients the mean request time was
0.52 ms instead of 0.09 ms, and a microbenchmark showed 24–100 µs per eviction.

**Fix.** `BoundedMap`, a two-generation LRU with O(1) operations (as in quick-lru):
- default 100,000 keys per map;
- every key used within the last 50,000 insertions survives, so an active client keeps its rate-limit window.

**Results.**
- Node:
  - 127 MB plateau from 100k to 400k clients (at most ~250 MB at the bound);
  - mean 0.08 ms per request, flat;
  - longest request 20 ms (GC).
- Python:
  - the in-memory store had no key limit, and the sessions were sorted on every eviction;
  - both now use `OrderedDict` LRU with O(1) eviction;
  - at 300k clients, the longest request fell from 526 ms (63 requests > 10 ms) to 106 ms (9);
  - gc callbacks show that the remaining tail is CPython's gen-2 collection, which scales with live session objects;
  - with Redis the longest was 13 ms, at +0.15 ms p50.
  - This plausibly explains the high FastAPI p99 in §2.11 (finding 5), but it was not re-measured over HTTP.

*Trade-off to state:* under a flood of more than ~50k new IPs between two
requests of one client, that client's in-process rate window restarts. Exact
limits under such load need Redis.

**F3 Monitoring.**
- Prometheus metrics with identical names in both servers (README, Monitoring):
  - decisions by kind and verdict, signals, decision latency histogram;
  - ML errors, store errors by operation;
  - sessions, live-feed clients, process metrics.
- `/aegis/ready` returns 503 while Redis is unreachable; `/aegis/health` is liveness only.
- Signal labels are a bounded set of names, so there is no label-cardinality explosion.
- Store errors are counted where the degraded paths already caught them (rate limit, replay, session get/set).
- Python metrics are off by default (`metrics_path`) because they describe traffic.

**F4 Kubernetes (`deploy/`, results in `phase_f/kubernetes.md`).**
- Helm chart with:
  - both API servers (2 replicas), ML, Redis, dashboard;
  - startup/liveness/readiness probes;
  - Secret with checksum restarts;
  - optional HPA; PDBs, NetworkPolicies, Prometheus annotations or a ServiceMonitor;
  - Ingress off by default;
  - non-root, read-only, no-capability pods;
  - a `helm test` smoke test.
- Plain manifests are rendered from the chart, and CI checks they are in sync.
- Tested on kind (Kubernetes 1.34):
  - install, `helm test` on both servers;
  - Redis outage: all API pods NotReady with no restarts, then automatic recovery;
  - cross-replica token and session use.
- `helm test` found that the Python image lacked `prometheus_client` (501), now fixed.
- NetworkPolicy enforcement could **not** be verified: the sandbox kernel would
  not let kindnet program nftables.
- Getting kind to run in the sandbox took two workarounds, documented in deploy/README.md:
  - negative `oom_score_adj` forbidden, found by bisecting an OCI spec with runc;
  - no hugetlb cgroup mount.

**F5 v1.0.0.**
- Versions were already 1.0.0 in all packages and the OpenAPI document.
- CHANGELOG has a 1.0.0 section.
- Tagging and the GitHub release wait for the merge and the student's decision.
- npm/PyPI publishing remains a separate, manual step (docs/RELEASING.md).

## 3. Contributions — what can honestly be claimed

| Claim | Status |
|-------|--------|
| 5-layer defense in one open-source SDK | Implementation exists; integration across layers still partial |
| Group ablation showing layer complementarity | Shown on synthetic data; must be repeated on real data |
| Sub-5 ms ensemble inference | Measured: p50 1.24 ms, p99 2.77 ms (§5.5) |
| Low per-request overhead | Measured: ≈0.2 ms server time per request for the rule pipeline in Node and Python; telemetry with ML ≈1–2 ms (§2.11) |
| Horizontally scalable with correct shared state | Replay, rate limits and sessions shared through Redis; verified with two instances and 4 workers; Redis outage degrades without bypass (§2.11) |
| Vectorized RandomForest evaluation (FlatForest) | Engineering contribution: 10.24 → 0.21 ms, identical output |
| Residential proxy detection, LLM honeypot traps, WebGPU fingerprinting | **Do a literature search before calling these "novel"** — related work appeared in 2025–26 |
| Bangladesh-context evaluation | Requires the real-data study |

---

## 4. Implementation log (for Ch. 4 "Implementation challenges")

### 2026-10-02 — ML pipeline was silently non-functional
Found while reviewing the code before experiments:

1. **Generator/extractor key mismatch.** The synthetic generator emitted
   `avg_velocity`, the extractor read `mouse_avg_velocity` → all 50 features
   were 0 → accuracy exactly 0.50, AUC 0.50, every ablation drop 0.
2. **Import error.** `AnomalyDetector` imported, class named `BotAnomalyDetector`
   → `import aegis_ml` failed.
3. **`BotClassifier.model` did not exist** → training crashed at the ROC plot;
   inference caught the error and returned 0.5 / "human" for every request.
4. **Tests tested dummy classes** defined inside the test files, so CI was
   green while the real code was broken. Replaced with tests against real
   code + an end-to-end test (now 30 tests).
5. **Packaging:** the stale `packages/ml-engine/src/` folder makes setuptools
   treat the package as src-layout, so `pip install -e packages/ml-engine`
   installs the old copy and `aegis_ml` is not importable. Fixed 2026-10-02
   by removing the stale scaffold files (`ml-engine/src/`, `server-python/aegis/`,
   two superseded docs, `examples/express-basic/`); the installed package now
   imports from any directory.

Lesson for the thesis: an end-to-end test on real code is what catches
integration bugs; unit tests on mocks did not.

### 2026-10-02 — Inference latency 59 ms → 1.3 ms
- Profiling (single request): RandomForest `n_jobs=-1` spawned threads per
  call (55.7 ms); with `n_jobs=1` still 10.2 ms (200 trees, one Python call each);
  inference also ran the ensemble twice (predict + predict_proba).
- Fix: `FlatForest` flattens all trees into shared arrays and traverses them
  together with numpy (max deviation from sklearn 4.4e-16, 0 label
  differences on 4,000 samples); predict derives the label from one
  probability pass.

---

### 2026-10-03 — Phase A: bugs that would have hurt real users or the study
Found while making the layers work together (each fixed and covered by a test):

| Where | Problem | Effect if shipped |
|-------|---------|-------------------|
| SDK HeadlessDetector | Called `Notification.requestPermission()` | Every visitor/participant gets a notification-permission prompt |
| SDK HeadlessDetector | Loaded `http://localhost:9999/...` | Every visitor's browser probes their own machine |
| SDK HeadlessDetector | WebRTC local-candidate check; "0 plugins = headless" | Privacy concern; all mobile and privacy browsers look like bots |
| SDK RequestInterceptor | Token header added to third-party requests | Token leaked; CORS preflight breaks payment/analytics APIs |
| SDK collectors | Units/meanings differed from ML (px/ms vs px/s, click precision inverted, keydown/keyup mis-paired under rollover) | Real data on a different scale than training data |
| Core RiskScorer | Weighted average across layers; confidence cancelled for lone signals | Extra weak evidence *lowered* risk; one weak hint could challenge |
| Core IPAnalyzer | Private IPs flagged as bogon (90) | Everyone behind a proxy / on localhost blocked |
| Core GeoIPResolver | Sent visitor IPs to ip-api.com over HTTP, no timeout | Privacy leak (IRB issue), latency |
| Core TLSFingerprinter | "Chrome + JA3 starts with 771,4865-4866" = bot | Matches every TLS 1.3 browser incl. real Chrome (disabled) |
| Python/Node servers | Missing token = +50 / risk 100 | First page load of every visitor challenged/blocked |
| Python server | "googlebot" UA = block; crawler without Accept-Language | Real Googlebot blocked (SEO) |
| Python server | Session tokens single-use | Second request of every visitor rejected |
| Tokens | Three incompatible formats | No server could verify any SDK token |
| Dashboard / Node stats | Hardcoded numbers | Misleading figures in a thesis demo |

### 2026-10-03 — End-to-end observation (RQ3, qualitative)
`npm run test:e2e` drives a real Chromium against the FastAPI example with a
trained model. Playwright with its default user agent (`HeadlessChrome`) is
denied on the first page load by header/UA rules. With a normal Chrome user
agent and `navigator.webdriver` hidden ("stealth"), the **network/header layer
lets the page load (score 0)**, but the SDK layer flags it (headless checks, no
mouse micro-tremor, uniform typing) and the **login is blocked**. This is a
concrete instance of a bot that only the behavioural layer catches; quantify it
with the November bot traffic.

## 5. Results — synthetic data (v1, 2026-10-02)

Reproduce (from `packages/ml-engine`):
```
python scripts/thesis_experiment.py --out ../../docs/thesis/results/synthetic
```
Full output: `docs/thesis/results/synthetic/` (`thesis_report.md`,
`results.json`, `metrics.csv`, ROC / confusion matrix / feature importance plots).

Setup: 2,500 humans + 2,500 bots (seed 42), split 70/15/15 stratified;
Python 3.11.15, scikit-learn 1.9.1, XGBoost 3.2.0, NumPy 2.4.6; 4-core x86_64
cloud container.

Cross-platform check (2026-10-02): the test suite also runs on the student's
Windows laptop (Python 3.13, scikit-learn 1.7.2, XGBoost 3.4.1, NumPy 2.3.5):
26/26 tests that need no temp directory passed; the 4 `tmp_path` tests need
`--basetemp=.pytest_tmp` there because of a Windows temp-folder permission
issue (environment, not code). Re-run `thesis_experiment.py` on the laptop
before the final thesis if the numbers will be reported from that machine.

### 5.1 Hold-out test set (n = 750)
| Threshold | Accuracy | Precision | Recall | F1 | FPR |
|-----------|----------|-----------|--------|----|-----|
| 0.5 | 0.9720 | 0.9758 | 0.9680 | 0.9719 | 2.40% |
| **0.8469 (tuned)** | **0.9747** | **0.9863** | **0.9627** | **0.9744** | **1.33%** |

AUC-ROC 0.9957.

### 5.2 5-fold cross-validation (full model, threshold 0.5)
Accuracy 0.9708 ± 0.0045 · Precision 0.9762 ± 0.0074 · Recall 0.9652 ± 0.0032 ·
F1 0.9706 ± 0.0044 · AUC 0.9962 ± 0.0015 · FPR 2.36% ± 0.74

### 5.3 Group ablation (5-fold CV)
| Configuration | Features | AUC | F1 @0.5 | Recall @FPR≤2% |
|---------------|----------|-----|---------|----------------|
| full | 50 | 0.9962 ± 0.0015 | 0.9706 ± 0.0044 | 0.9648 ± 0.0095 |
| without behavior | 15 | 0.9947 ± 0.0028 | 0.9631 ± 0.0106 | 0.9524 ± 0.0154 |
| only behavior | 35 | 0.9115 ± 0.0063 | 0.8784 ± 0.0112 | 0.8036 ± 0.0187 |
| without session | 45 | 0.9949 ± 0.0016 | 0.9663 ± 0.0065 | 0.9504 ± 0.0120 |
| only session | 5 | 0.8976 ± 0.0109 | 0.8020 ± 0.0073 | 0.6460 ± 0.0143 |
| without network | 45 | 0.9807 ± 0.0033 | 0.9359 ± 0.0068 | 0.8884 ± 0.0200 |
| only network | 5 | 0.9467 ± 0.0078 | 0.8981 ± 0.0073 | 0.6612 ± 0.0560 |
| without fingerprint | 45 | 0.9921 ± 0.0020 | 0.9588 ± 0.0058 | 0.9320 ± 0.0271 |
| only fingerprint | 5 | 0.9464 ± 0.0039 | 0.8878 ± 0.0070 | 0.7788 ± 0.0176 |

Reading: no single group is sufficient (best single group, behavior, reaches
only 0.80 recall at FPR≤2%); network is the largest unique contributor
(removing it costs 7.6 points of recall@FPR≤2%). Behavior's unique
contribution is small here *because* simple bots are also caught by network
and fingerprint — real data may change this.

### 5.4 Per bot type (fresh test set, seed 1042, tuned threshold)
| Class | Rate |
|-------|------|
| Human FPR | 1.40% |
| simple_script recall | 100% |
| crawler recall | 100% |
| headless_browser recall | 100% |
| sophisticated_bot recall | 98.5% |
| replay_bot recall | **76.8%** (84.1% at threshold 0.5) |

Behavior-only model on replay bots: **5.0%** recall — behavioral biometrics
alone cannot detect replayed human traces; the other layers recover most of them.
Trade-off: lowering FPR from 2.4% to 1.3% cost ~7 points of replay-bot recall.

### 5.5 Inference latency (2,000 uncached requests through `InferenceEngine`)
mean 1.27 ms · p50 1.24 ms · p95 1.66 ms · p99 2.77 ms (target < 5 ms ✔)

---

## 6. Open TODOs for the thesis

- [ ] Ethics/IRB submission (needs supervisor signature) — planned Oct 21; drafts in `docs/thesis/irb/`
- [ ] Data-collection website + logging endpoint; consent forms EN + BN
- [x] Bot scripts: requests (3 modes), Scrapy, Selenium, Puppeteer-stealth, Playwright stealth + human-like (§2.13). Residential proxy not included (needs a paid proxy service)
- [ ] Re-run §5 on real data; report 95% confidence intervals (bootstrap) for FPR and recall
- [ ] Compare against baselines: rule-based, single XGBoost, RF, LR
- [ ] Literature search for "novel" claims (§3)
- [x] Remove stale duplicate files (see §4, packaging) — done 2026-10-02

---

## 7. Chapter mapping

| Chapter | Material in these notes |
|---------|------------------------|
| 3 Methodology | §2 |
| 4 Implementation | §4 |
| 5 Experimental setup | §2.3, §5 setup |
| 6 Results | §5 (synthetic, as a pilot) + real-data results |
| 7 Discussion / threats to validity | §1 warning, §2.1, §2.3, §3 |

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

Phase B progress (2026-10-03): B1 security layer done. Core 86 tests, Node 18,
Python 63 (incl. Node<->Python request-signature interop), e2e 4.

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

## 3. Contributions — what can honestly be claimed

| Claim | Status |
|-------|--------|
| 5-layer defense in one open-source SDK | Implementation exists; integration across layers still partial |
| Group ablation showing layer complementarity | Shown on synthetic data; must be repeated on real data |
| Sub-5 ms ensemble inference | Measured: p50 1.24 ms, p99 2.77 ms (§5.5) |
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
- [ ] Bot scripts: requests/curl, Selenium, Puppeteer-stealth, Playwright + residential proxy, Scrapy
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

# AEGIS BOT SHIELD — Thesis Notes

> Living notebook for the B.Sc. thesis. Every experiment, design decision,
> bug and result that may end up in the thesis is recorded here, newest first
> inside each section.
>
> **Student:** Dipro Debnath · **Supervisor:** Rishad Amin Pulok (Lecturer, CSE, Metropolitan University)
> **Semester:** Fall 2026 · **Last updated:** 2026-10-02

---

## 0. Status at a glance

| Item | Status |
|------|--------|
| Thesis proposal (LaTeX) | Done — `docs/thesis_proposal.tex` |
| ML pipeline runs end-to-end | Done (fixed 2026-10-02, see §4) |
| Synthetic-data experiment | Done — `docs/thesis/results/synthetic/` |
| Ethics / IRB application | **Due Oct 1–7 — not yet confirmed** |
| Real human data (30–50 participants) | Planned Nov 1–20 |
| Real bot traffic (5 tools) | Planned Nov 1–20 |
| Results on real data | Not started |
| Thesis writing | Not started (Dec 1–15) |

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
must be made on the November real-data experiment.

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

- [ ] Ethics/IRB submission (needs supervisor signature) — this week
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

# ML model guide

The machine-learning part of AEGIS: what it sees, how it is trained and
evaluated, how it is served, and what the current results mean. All numbers
so far come from **synthetic data**; they show that the pipeline works, not
how well it detects real bots (that is the November study and Phase F).

## Inputs: the 50-feature contract

`contracts/features.json` is the single source of the feature list. The SDK,
both servers and the extractor are tested against it.

| Category | Source | Count | Examples |
|---|---|---|---|
| mouse | SDK | 15 | velocity mean/std, acceleration, jerk, straightness, curvature, micro-tremor frequency, Fitts' law R², pauses |
| keyboard | SDK | 10 | dwell and flight time mean/std, typing speed, paste count, correction ratio, cadence entropy |
| scroll | SDK | 5 | velocity, direction changes, maximum depth, event count, momentum ratio |
| touch | SDK | 5 | pressure, radius, swipe velocity, tap count, multi-touch ratio |
| fingerprint | SDK | 5 | WebGL/canvas present, plugin count, headless flag and confidence |
| session | server | 5 | duration, request count, unique paths, mean gap, reputation |
| network | server | 5 | VPN, Tor, datacenter, residential proxy, IP reputation |

The SDK sends only these statistics: no key contents, text, URLs or raw user
agent. Session and network features are filled in by the server.

## Model

`aegis_ml.models.classifier.BotClassifier`:
- base models: XGBoost (200 trees, depth 6), RandomForest and logistic
  regression on standardised features;
- a logistic-regression meta-model on their out-of-fold probabilities (stacking);
- a decision threshold tuned on validation data for a false-positive budget
  (default 2 %, tuned at 1.5 % because a threshold tuned exactly at the budget
  overshoots on unseen data);
- RandomForest inference through a vectorised flat forest (`FlatForest`,
  identical output, 10.2 → 0.2 ms).

## Training

```bash
pip install -e "packages/ml-engine[server]"
python e2e/train_model.py model.pkl                         # quick synthetic model (CI/demo)
cd packages/ml-engine
python scripts/thesis_experiment.py --out ../../docs/thesis/results/synthetic   # full pipeline + report
```

From Python, on your own labelled data:

```python
from aegis_ml.training.training import TrainingPipeline
pipeline = TrainingPipeline(output_dir="models")
results = pipeline.train(records, labels, max_fpr=0.02)   # records: dicts shaped like the telemetry features
# models/bot_classifier.pkl + metrics, group ablation, plots
```

`records` use the server-side feature layout (`{"mouse": {...}, "keyboard":
{...}, ..., "session": {...}, "network": {...}}`); the Python server's
`on_record` callback produces exactly this, so logged traffic can be labelled
and fed back.

The ML service's `POST /train` trains on synthetic data only
(`use_synthetic: false` has no data source yet) and has no authentication:
keep it on an internal network.

**Model files are pickles. Never load a model file from an untrusted
source** — unpickling runs code.

## Evaluation

| Script | What it produces |
|---|---|
| `scripts/thesis_experiment.py` | Hold-out and 5-fold CV metrics, group ablation, per-bot-type recall, latency (`docs/thesis/results/synthetic/`) |
| `scripts/phase_c_experiment.py` | LR vs RF vs XGBoost vs ensemble on identical folds with bootstrap CIs, leave-one-bot-type-out, SHAP, trajectory models, figures (`docs/thesis/results/phase_c/`) |
| `scripts/phase_c_seed_robustness.py` | The unseen-bot-type results over several seeds |

Headline results (synthetic, see THESIS_NOTES §2.10 and §5):
- all four models reach AUC ≈ 0.994; the ensemble is **not** significantly
  better than logistic regression or XGBoost;
- bot types missing from training are the real problem: unseen *replay* bots
  are caught only 36–47 % of the time at 2 % FPR;
- `ip_reputation` dominates SHAP importance — an artefact of the synthetic
  generator, to be re-checked on real data.

## Serving

| Mode | How | Measured |
|---|---|---|
| In-process (Python server) | `ml_model_path="model.pkl"` | telemetry with ML: 458 req/s per worker, unloaded p50 2.4 ms |
| HTTP service (Node or Python server) | `uvicorn aegis_ml.server:app --port 8001` with `MODEL_PATH`; servers call `POST /predict` (timeout 0.5 s; on timeout the rules decide alone) | Node telemetry with ML: 936 req/s, unloaded p50 1.9 ms |

ML service endpoints:

| Endpoint | Purpose |
|---|---|
| `POST /predict` | `{client_id, behavioral_data, explain?}` → `{is_bot, confidence_score, client_id, explanation?}`; 503 without a model |
| `POST /train` | Background training on synthetic data (internal only) |
| `GET /health` | `{status, model_loaded, is_training}` |
| `GET /metrics` | Inference counters and latency |
| `GET /docs` | FastAPI's generated documentation |

## Explanations (SHAP)

`InferenceEngine.explain(data, top_k=5)` or `POST /predict` with
`"explain": true` returns the top feature contributions of the XGBoost
component (exact TreeSHAP via XGBoost's `pred_contribs`, about 1.8 ms). This
explains one base model of the ensemble, not the whole ensemble (rank
agreement with RandomForest 0.75, with logistic regression 0.55).

## Raw mouse trajectories (research)

`aegis_ml.trajectories` simulates human movement (minimum-jerk, Fitts' law,
tremor, overshoot) and five bot styles, and `aegis_ml.models.sequence_models`
trains a 1D-CNN and a conv-LSTM on the raw event sequence (needs the `deep`
extra, PyTorch). They generalise to unseen *linear* bots where feature models
fail, but are **not used in the live pipeline**: the SDK sends summaries only,
and sending raw trajectories needs an ethics/privacy decision first.

## Retraining on real data (planned)

1. Collect consented human sessions (data-collection website, Phase G) and
   bot sessions from the Phase F bot scripts through `on_record`.
2. Label by source, split by participant (never by request), train with
   `TrainingPipeline`.
3. Report per-bot-type recall at the FPR budget, with bootstrap CIs, and
   leave-one-bot-type-out results — not only overall AUC.

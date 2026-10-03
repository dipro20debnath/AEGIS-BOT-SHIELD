# aegis-ml-engine (`aegis_ml`)

Machine-learning part of [AEGIS BOT SHIELD](https://github.com/dipro20debnath/AEGIS-BOT-SHIELD/blob/main/README.md): the 50-feature
extractor, a synthetic data generator, a stacked ensemble (XGBoost,
RandomForest, logistic regression; logistic-regression meta-model) with a
false-positive-budget threshold, training and evaluation pipelines, SHAP
explanations, research models on raw mouse trajectories, and an HTTP
inference service.

**Current results are on synthetic data only.** They show the pipeline
works; real-world detection rates are not known yet.

```bash
pip install "aegis-ml-engine[server]"
python e2e/train_model.py model.pkl                       # from the repository: small synthetic model
MODEL_PATH=model.pkl uvicorn aegis_ml.server:app --port 8001
curl -s localhost:8001/health
```

Extras: `server` (FastAPI service), `deep` (PyTorch sequence models),
`explain` (optional cross-check with the `shap` package), `test`.

Model files are pickles: never load one from an untrusted source.

- Guide: [ML_MODEL_GUIDE.md](https://github.com/dipro20debnath/AEGIS-BOT-SHIELD/blob/main/docs/ML_MODEL_GUIDE.md)
- Results and decisions: [THESIS_NOTES.md](https://github.com/dipro20debnath/AEGIS-BOT-SHIELD/blob/main/docs/thesis/THESIS_NOTES.md)

Python ≥ 3.9. MIT licence.

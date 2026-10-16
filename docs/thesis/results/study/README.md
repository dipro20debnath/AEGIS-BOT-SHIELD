# Study results (real data)

Empty until data collection ends. Produce the results with:

```bash
cd study && python -m aegis_study export --out dataset --no-parquet
cd ../packages/ml-engine
python scripts/study_analysis.py --export ../../study/dataset --out ../../docs/thesis/results/study
```

This writes `REPORT.md` (tables for the thesis), `results.json` (all numbers) and `roc_pr.png/.pdf`
here. The method is in `packages/ml-engine/aegis_ml/evaluation/study.py`; see THESIS_NOTES §2.18.

Do not commit the dataset itself: it stays on the encrypted drive (IRB protocol §7). Only the
aggregate results belong in this folder.

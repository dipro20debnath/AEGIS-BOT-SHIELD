# Machine Learning Model Guide

The AEGIS ML Engine is the core intelligence component responsible for identifying sophisticated, human-imitating bots.

## Feature Categories (50-Dimensional Vector)

The model relies on a carefully selected set of 50 features extracted from the client telemetry, categorized as follows:

1. **Environmental Features (15)**
   - Browser fingerprint consistency (e.g., mismatch between User-Agent and Feature Detection).
   - Canvas/WebGL rendering hashes.
   - WebDriver presence (`navigator.webdriver`, `window.cdc_adoQpoasnfa76pfcZLmcfl_Array`).
2. **Behavioral Features (20)**
   - Mouse movement entropy (calculates the randomness and curvature of mouse paths).
   - Keystroke flight time and dwell time standard deviation.
   - Scroll speed variance.
3. **Network Features (10)**
   - Request rate velocity.
   - IP reputation score.
   - ASN risk level.
4. **Hardware Constraints (5)**
   - CPU core count vs memory discrepancy.
   - GPU vendor mismatch.

## Training Pipeline

The training pipeline uses `scikit-learn` and `XGBoost`.

1. **Data Ingestion:** Load labeled dataset (CSV/Parquet).
2. **Preprocessing:** Handle missing values, normalize continuous variables (MinMaxScaler), and encode categorical variables.
3. **Feature Selection:** Recursive Feature Elimination (RFE) to ensure the 50 most impactful features are utilized.
4. **Model Training:** Train an XGBoost Classifier with early stopping.
5. **Validation:** Stratified K-Fold cross-validation.
6. **Export:** Export to ONNX format for high-performance inference in Node.js/C++.

## Synthetic Data Generation

To improve robustness against zero-day bot variants, AEGIS employs a Generative Adversarial Network (GAN) to generate synthetic bot telemetry. This augments the training dataset, teaching the model to recognize theoretical bot behaviors before they are seen in the wild.

## Model Evaluation Methodology

We evaluate the model using the following metrics:
- **Precision:** Minimizing False Positives (blocking humans). Target > 99.9%.
- **Recall:** Catching True Positives (bots). Target > 95.0%.
- **F1-Score:** Harmonic mean.
- **ROC-AUC:** Area under the receiver operating characteristic curve.

## Ablation Study Setup

The repository includes scripts to perform ablation studies (`tests/ml/ablation.py`). This allows researchers to systematically remove feature categories (e.g., train without Behavioral Features) to quantify their impact on overall detection accuracy.

## Inference API

For standalone python usage:

```python
from aegis_ml.inference import ModelRunner

runner = ModelRunner("models/xgboost_v2.onnx")
score = runner.predict(feature_dict)
if score > 0.85:
    print("Bot detected!")
```

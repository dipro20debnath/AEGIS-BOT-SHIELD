# Aegis Bot Shield - ML Engine

The Machine Learning engine for detecting advanced bot threats. 

## Components
- **Feature Extractor:** Processes network and behavioral signals.
- **Bot Classifier:** Supervised XGBoost/LightGBM models for known bot signatures.
- **Anomaly Detector:** Unsupervised Isolation Forests to detect zero-day bots.
- **Sequence Analyzer:** LSTM-based models for clickstream analysis.
- **Inference Pipeline:** High-speed ONNX runtime integration for <5ms latency.

## Getting Started

1. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

2. Run the ML API Server:
   ```bash
   python -m src.api.server
   ```

3. Generate Synthetic Data for Testing:
   ```bash
   python -m src.data.synthetic_generator
   ```

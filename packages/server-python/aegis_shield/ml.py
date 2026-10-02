"""
ML scoring for telemetry features.

Two backends:
- local: loads a trained BotClassifier (packages/ml-engine) from a pickle file.
  Only load model files you produced yourself: unpickling runs code.
- http:  calls the ML engine service's POST /predict.

Both return the bot probability in [0, 1], or None when no model is
available, in which case the server falls back to rule-based scoring.
"""
import json
import logging
import urllib.request
from typing import Dict, Optional

logger = logging.getLogger("aegis_shield")

Features = Dict[str, Dict[str, float]]


class MLScorer:
    def score(self, features: Features) -> Optional[float]:
        raise NotImplementedError

    @property
    def available(self) -> bool:
        return False

    @property
    def threshold(self) -> float:
        """Decision threshold the model was tuned with (probability >= threshold -> bot)."""
        return 0.5


class NoModel(MLScorer):
    def score(self, features: Features) -> Optional[float]:
        return None


class LocalModelScorer(MLScorer):
    def __init__(self, model_path: str):
        from aegis_ml.features.extractor import FeatureExtractor
        from aegis_ml.models.classifier import BotClassifier

        self._extractor = FeatureExtractor()
        self._classifier = BotClassifier()
        self._classifier.load(model_path)

    @property
    def available(self) -> bool:
        return True

    @property
    def threshold(self) -> float:
        return float(getattr(self._classifier, "threshold", 0.5))

    def score(self, features: Features) -> Optional[float]:
        X = self._extractor.extract_batch([features])
        return float(self._classifier.predict_proba(X)[0])


class HttpModelScorer(MLScorer):
    def __init__(self, url: str, timeout: float = 0.5):
        self.url = url.rstrip("/") + "/predict"
        self.timeout = timeout

    @property
    def available(self) -> bool:
        return True

    def score(self, features: Features) -> Optional[float]:
        body = json.dumps({"client_id": "aegis-server", "behavioral_data": features}).encode("utf-8")
        request = urllib.request.Request(self.url, data=body, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return float(json.load(response)["confidence_score"])
        except Exception as exc:  # network errors, 503 when no model is loaded
            logger.warning("ML service unavailable: %s", exc)
            return None


def make_scorer(model_path: Optional[str] = None, ml_url: Optional[str] = None) -> MLScorer:
    if model_path:
        return LocalModelScorer(model_path)
    if ml_url:
        return HttpModelScorer(ml_url)
    return NoModel()

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from typing import Dict, Any

class AnomalyDetector:
    """Unsupervised anomaly detection for novel bot patterns"""
    def __init__(self, contamination: float = 0.05):
        self.model = IsolationForest(
            n_estimators=100,
            contamination=contamination,
            random_state=42
        )
        self.is_fitted = False
        
    def train(self, X: pd.DataFrame) -> None:
        self.model.fit(X)
        self.is_fitted = True
        
    def score_samples(self, X: pd.DataFrame) -> np.ndarray:
        """Returns anomaly score (higher = more anomalous)"""
        if not self.is_fitted:
            raise RuntimeError("Model must be trained before scoring")
            
        # IsolationForest returns negative anomaly score where lower is more anomalous
        # We invert it so higher is more anomalous (range approx 0 to 1)
        scores = -self.model.score_samples(X)
        
        # Min-max normalize roughly to 0-1 range based on expected bounds
        min_score, max_score = 0.3, 0.8  # Typical bounds for IF
        normalized = (scores - min_score) / (max_score - min_score)
        return np.clip(normalized, 0, 1)
        
    def predict(self, X: pd.DataFrame) -> np.ndarray:
        """Returns 1 for anomaly (bot), 0 for normal (human)"""
        if not self.is_fitted:
            raise RuntimeError("Model must be trained before predicting")
            
        # IF returns -1 for anomaly, 1 for normal
        preds = self.model.predict(X)
        return np.where(preds == -1, 1, 0)

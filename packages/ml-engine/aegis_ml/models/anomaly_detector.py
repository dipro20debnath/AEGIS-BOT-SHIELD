"""
Anomaly Detection Pipeline

Zero-day bot detection using Isolation Forest and Local Outlier Factor.
"""
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.neighbors import LocalOutlierFactor
from sklearn.preprocessing import StandardScaler
from typing import Dict, Any, List

class BotAnomalyDetector:
    """Unsupervised anomaly detector for zero-day bots."""

    def __init__(self, contamination: float = 0.05):
        self.contamination = contamination
        self.scaler = StandardScaler()
        self.iso_forest = IsolationForest(
            n_estimators=100, 
            contamination=self.contamination,
            random_state=42
        )
        self.lof = LocalOutlierFactor(
            n_neighbors=20, 
            contamination=self.contamination,
            novelty=True
        )
        self.is_fitted = False

    def train(self, X: np.ndarray) -> Dict[str, Any]:
        """Fit unsupervised models on baseline (human) data."""
        X_scaled = self.scaler.fit_transform(X)
        self.iso_forest.fit(X_scaled)
        self.lof.fit(X_scaled)
        self.is_fitted = True
        return {'status': 'trained', 'samples': len(X)}

    def predict(self, X: np.ndarray) -> np.ndarray:
        """Predict if samples are anomalous (bot). 1 = bot, 0 = human."""
        if not self.is_fitted:
            raise ValueError("Model not fitted.")
        
        X_scaled = self.scaler.transform(X)
        
        iso_preds = self.iso_forest.predict(X_scaled)
        lof_preds = self.lof.predict(X_scaled)
        
        # Convert: -1 -> 1, 1 -> 0
        iso_anomalies = (iso_preds == -1).astype(int)
        lof_anomalies = (lof_preds == -1).astype(int)
        
        # Ensemble: flagged if either model flags it
        ensemble_anomalies = np.logical_or(iso_anomalies, lof_anomalies).astype(int)
        return ensemble_anomalies

    def score_samples(self, X: np.ndarray) -> np.ndarray:
        """Get anomaly scores."""
        if not self.is_fitted:
            raise ValueError("Model not fitted.")
            
        X_scaled = self.scaler.transform(X)
        
        iso_scores = -self.iso_forest.score_samples(X_scaled)
        lof_scores = -self.lof.score_samples(X_scaled)
        
        combined = (iso_scores + lof_scores) / 2.0
        return combined

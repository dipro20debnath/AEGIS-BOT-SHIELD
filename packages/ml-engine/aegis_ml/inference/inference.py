"""
Real-Time Inference Engine

Handles loading the trained model, feature extraction, 
and providing predictions with low latency.
"""
import os
import time
from typing import Dict, Any, List, Optional, Tuple
import numpy as np

from ..features.extractor import FeatureExtractor
from ..models.classifier import BotClassifier

class InferenceEngine:
    def __init__(self, model_path: str = './models/bot_classifier.pkl'):
        self.model_path = model_path
        self.extractor = FeatureExtractor()
        self.classifier = BotClassifier()
        
        self.is_loaded = False
        self._load_model()
        
        # Simple caching for repeat clients (in memory for demo)
        self.cache = {}
        self.latency_stats = []
        self._explainer = None

    def _load_model(self):
        """Loads the saved classifier model if it exists."""
        if os.path.exists(self.model_path):
            try:
                self.classifier.load(self.model_path)
                self.is_loaded = True
                print(f"Loaded model from {self.model_path}")
            except Exception as e:
                print(f"Failed to load model: {e}")
        else:
            print(f"Model file not found at {self.model_path}")

    def predict(self, client_id: str, request_data: Dict[str, Any]) -> Tuple[float, bool]:
        """
        Predict whether a request is from a bot or human.
        Returns:
            Tuple of (confidence_score, is_bot)
        """
        start_time = time.time()
        
        # 1. Check cache (simplified caching strategy)
        if client_id in self.cache:
            cache_entry = self.cache[client_id]
            # Simple TTL check (e.g., 60 seconds)
            if start_time - cache_entry['timestamp'] < 60:
                self._record_latency(start_time)
                return cache_entry['score'], cache_entry['is_bot']

        # 2. Extract Features
        if not self.is_loaded:
            # Fallback if model not loaded
            return 0.5, False
            
        try:
            features = self.extractor.extract_batch([request_data])
            
            # 3. Predict: one ensemble pass gives the bot probability and the label
            score = self.classifier.predict_proba(features)[0]
            is_bot = score >= self.classifier.threshold
                
            # 5. Cache Result
            self.cache[client_id] = {
                'score': score,
                'is_bot': bool(is_bot),
                'timestamp': start_time
            }
            
            self._record_latency(start_time)
            return float(score), bool(is_bot)
            
        except Exception as e:
            print(f"Inference error: {e}")
            self._record_latency(start_time)
            return 0.5, False

    def explain(self, request_data: Dict[str, Any], top_k: int = 5) -> Optional[List[Dict[str, float]]]:
        """Top features behind the score of one request (SHAP values of the XGBoost
        component, see aegis_ml.evaluation.explain). None without a model or its XGBoost component."""
        if not self.is_loaded:
            return None
        if self._explainer is None:
            from ..evaluation.explain import try_explainer
            self._explainer = try_explainer(self.classifier) or False
        if not self._explainer:
            return None
        return self._explainer.explain(self.extractor.extract_batch([request_data])[0], top_k)

    def _record_latency(self, start_time: float):
        latency_ms = (time.time() - start_time) * 1000
        self.latency_stats.append(latency_ms)
        # Keep only recent stats
        if len(self.latency_stats) > 1000:
            self.latency_stats.pop(0)

    def get_metrics(self) -> Dict[str, Any]:
        """Return inference latency and health metrics."""
        if not self.latency_stats:
            avg_lat = 0.0
        else:
            avg_lat = sum(self.latency_stats) / len(self.latency_stats)
            
        return {
            'is_loaded': self.is_loaded,
            'cache_size': len(self.cache),
            'avg_latency_ms': avg_lat,
            'requests_processed': len(self.latency_stats)
        }

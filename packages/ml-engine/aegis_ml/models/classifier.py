"""
Bot Detection Classifier — Ensemble Model

Uses a stacked ensemble of:
1. XGBoost Gradient Boosted Trees (primary)
2. Random Forest (diversity)
3. Logistic Regression (interpretable baseline)
"""
import numpy as np
from typing import Dict, Optional, Tuple, List, Any
import pickle
import json
import os

try:
    from xgboost import XGBClassifier
except ImportError:
    XGBClassifier = None

from sklearn.ensemble import RandomForestClassifier, VotingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import cross_val_score, StratifiedKFold
from sklearn.metrics import (accuracy_score, precision_score, recall_score,
                             f1_score, roc_auc_score, confusion_matrix,
                             classification_report)


class BotClassifier:
    """Ensemble bot detection classifier."""

    def __init__(self, model_type: str = 'ensemble'):
        self.model_type = model_type
        self.scaler = StandardScaler()
        self.models = {}
        self.meta_model = None
        self.is_fitted = False
        self.feature_names: List[str] = []
        self._init_models()

    def _init_models(self):
        """Initialize all base models."""
        self.models['xgboost'] = XGBClassifier(
            n_estimators=200,
            max_depth=6,
            learning_rate=0.1,
            subsample=0.8,
            colsample_bytree=0.8,
            eval_metric='logloss',
            random_state=42,
        ) if XGBClassifier else None

        self.models['random_forest'] = RandomForestClassifier(
            n_estimators=200,
            max_depth=10,
            min_samples_split=5,
            random_state=42,
            n_jobs=-1,
        )

        self.models['logistic'] = LogisticRegression(
            max_iter=1000,
            random_state=42,
        )

        self.meta_model = LogisticRegression(max_iter=500, random_state=42)

    def _get_base_predictions(self, X: np.ndarray) -> np.ndarray:
        preds = []
        for name, model in self.models.items():
            if model is not None:
                preds.append(model.predict_proba(X)[:, 1])
        return np.column_stack(preds)

    def train(self, X: np.ndarray, y: np.ndarray, feature_names: List[str] = None) -> Dict[str, Any]:
        """Train all models and return evaluation metrics."""
        self.feature_names = feature_names or []
        X_scaled = self.scaler.fit_transform(X)

        for name, model in self.models.items():
            if model is not None:
                model.fit(X_scaled, y)

        base_preds = self._get_base_predictions(X_scaled)
        self.meta_model.fit(base_preds, y)
        self.is_fitted = True
        
        return self.evaluate(X, y)

    def predict(self, X: np.ndarray) -> np.ndarray:
        """Predict bot (1) or human (0)."""
        if not self.is_fitted:
            raise ValueError("Model not fitted.")
        X_scaled = self.scaler.transform(X)
        base_preds = self._get_base_predictions(X_scaled)
        return self.meta_model.predict(base_preds)

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        """Return probability of being a bot."""
        if not self.is_fitted:
            raise ValueError("Model not fitted.")
        X_scaled = self.scaler.transform(X)
        base_preds = self._get_base_predictions(X_scaled)
        return self.meta_model.predict_proba(base_preds)[:, 1]

    def evaluate(self, X: np.ndarray, y: np.ndarray) -> Dict[str, Any]:
        """Full evaluation: accuracy, precision, recall, F1, AUC-ROC, confusion matrix."""
        preds = self.predict(X)
        probs = self.predict_proba(X)
        
        return {
            'accuracy': accuracy_score(y, preds),
            'precision': precision_score(y, preds),
            'recall': recall_score(y, preds),
            'f1': f1_score(y, preds),
            'auc_roc': roc_auc_score(y, probs),
            'confusion_matrix': confusion_matrix(y, preds).tolist(),
        }

    def get_feature_importances(self) -> Dict[str, float]:
        """Get feature importances from XGBoost/RandomForest."""
        importances = {}
        if self.models.get('random_forest') and self.is_fitted:
            rf_imp = self.models['random_forest'].feature_importances_
            if self.feature_names and len(self.feature_names) == len(rf_imp):
                for name, imp in zip(self.feature_names, rf_imp):
                    importances[name] = float(imp)
        return importances

    def cross_validate(self, X: np.ndarray, y: np.ndarray, cv=5) -> Dict:
        """K-fold cross validation with multiple metrics."""
        X_scaled = self.scaler.fit_transform(X)
        main_model = self.models.get('xgboost') or self.models.get('random_forest')
            
        scoring = ['accuracy', 'precision', 'recall', 'f1', 'roc_auc']
        results = {}
        skf = StratifiedKFold(n_splits=cv, shuffle=True, random_state=42)
        
        for metric in scoring:
            try:
                scores = cross_val_score(main_model, X_scaled, y, cv=skf, scoring=metric)
                results[metric] = {
                    'mean': float(np.mean(scores)),
                    'std': float(np.std(scores))
                }
            except Exception as e:
                pass
        return results

    def save(self, path: str):
        if not os.path.exists(os.path.dirname(path)):
            os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'wb') as f:
            pickle.dump({
                'models': self.models,
                'meta_model': self.meta_model,
                'scaler': self.scaler,
                'is_fitted': self.is_fitted,
                'feature_names': self.feature_names
            }, f)

    def load(self, path: str):
        with open(path, 'rb') as f:
            data = pickle.load(f)
            self.models = data['models']
            self.meta_model = data['meta_model']
            self.scaler = data['scaler']
            self.is_fitted = data['is_fitted']
            self.feature_names = data['feature_names']

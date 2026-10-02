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
                             classification_report, roc_curve)


class FlatForest:
    """Vectorized evaluator for a fitted sklearn RandomForestClassifier.

    sklearn walks the trees one Python call at a time, which costs ~10ms for a
    single sample with 200 trees. Here every tree is flattened into shared node
    arrays and all trees are traversed together with numpy, giving the same
    bot probability as RandomForestClassifier.predict_proba(X)[:, 1] in a
    fraction of the time.
    """

    def __init__(self, forest: RandomForestClassifier):
        features, thresholds, lefts, rights, probs, roots = [], [], [], [], [], []
        offset = 0
        max_depth = 0
        bot_col = list(forest.classes_).index(1)
        for est in forest.estimators_:
            tree = est.tree_
            leaf = tree.children_left == -1
            left = np.where(leaf, np.arange(tree.node_count), tree.children_left) + offset
            right = np.where(leaf, np.arange(tree.node_count), tree.children_right) + offset
            value = tree.value[:, 0, :]
            totals = value.sum(axis=1)
            totals[totals == 0] = 1.0
            features.append(np.where(leaf, 0, tree.feature))
            thresholds.append(np.where(leaf, np.inf, tree.threshold))
            lefts.append(left)
            rights.append(right)
            probs.append(value[:, bot_col] / totals)
            roots.append(offset)
            offset += tree.node_count
            max_depth = max(max_depth, tree.max_depth)
        self.feature = np.concatenate(features).astype(np.intp)
        self.threshold = np.concatenate(thresholds)
        self.left = np.concatenate(lefts).astype(np.intp)
        self.right = np.concatenate(rights).astype(np.intp)
        self.prob = np.concatenate(probs)
        self.roots = np.array(roots, dtype=np.intp)
        self.max_depth = max_depth

    def predict_bot_proba(self, X: np.ndarray) -> np.ndarray:
        # sklearn trees compare float32 inputs against float64 thresholds
        X = np.asarray(X, dtype=np.float32)
        rows = np.arange(X.shape[0])[:, None]
        nodes = np.broadcast_to(self.roots, (X.shape[0], len(self.roots)))
        for _ in range(self.max_depth):
            go_left = X[rows, self.feature[nodes]] <= self.threshold[nodes]
            nodes = np.where(go_left, self.left[nodes], self.right[nodes])
        return self.prob[nodes].mean(axis=1)


class BotClassifier:
    """Ensemble bot detection classifier."""

    def __init__(self, model_type: str = 'ensemble'):
        self.model_type = model_type
        self.scaler = StandardScaler()
        self.models = {}
        self.meta_model = None
        self.is_fitted = False
        self.feature_names: List[str] = []
        self._fast_forest: Optional[FlatForest] = None
        # Decision threshold on the bot probability; tune_threshold() sets it
        # from a validation set to meet a false-positive-rate budget.
        self.threshold = 0.5
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
            if model is None:
                continue
            if name == 'random_forest' and self._fast_forest is not None:
                preds.append(self._fast_forest.predict_bot_proba(X))
            else:
                preds.append(model.predict_proba(X)[:, 1])
        return np.column_stack(preds)

    def train(self, X: np.ndarray, y: np.ndarray, feature_names: List[str] = None) -> Dict[str, Any]:
        """Train all models and return evaluation metrics."""
        self.feature_names = feature_names or []
        X_scaled = self.scaler.fit_transform(X)

        for name, model in self.models.items():
            if model is not None:
                model.fit(X_scaled, y)

        self._build_fast_forest()
        base_preds = self._get_base_predictions(X_scaled)
        self.meta_model.fit(base_preds, y)
        self.is_fitted = True
        
        return self.evaluate(X, y)

    def _build_fast_forest(self):
        rf = self.models.get('random_forest')
        self._fast_forest = FlatForest(rf) if rf is not None else None

    def predict(self, X: np.ndarray) -> np.ndarray:
        """Predict bot (1) or human (0)."""
        return (self.predict_proba(X) >= self.threshold).astype(int)

    def tune_threshold(self, X_val: np.ndarray, y_val: np.ndarray,
                       max_fpr: float = 0.02) -> Dict[str, float]:
        """Pick the threshold with the highest bot recall whose false-positive
        rate on the validation set stays within max_fpr.

        Use a validation split that the model was not trained on, and report
        final metrics on a separate test split.
        """
        return self.tune_threshold_from_probs(self.predict_proba(X_val), y_val, max_fpr)

    def tune_threshold_from_probs(self, probs: np.ndarray, y: np.ndarray,
                                  max_fpr: float = 0.02) -> Dict[str, float]:
        """Same as tune_threshold, from held-out bot probabilities (e.g.
        out-of-fold predictions, which give many more human samples than a
        single small validation split)."""
        fpr, tpr, thresholds = roc_curve(y, probs)
        allowed = np.where((fpr <= max_fpr) & np.isfinite(thresholds))[0]
        if len(allowed) == 0:
            self.threshold = 1.0
            return {'threshold': self.threshold, 'val_fpr': 0.0, 'val_recall': 0.0}
        best = allowed[np.argmax(tpr[allowed])]
        self.threshold = float(min(thresholds[best], 1.0))
        return {'threshold': self.threshold, 'val_fpr': float(fpr[best]),
                'val_recall': float(tpr[best])}

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        """Return probability of being a bot."""
        if not self.is_fitted:
            raise ValueError("Model not fitted.")
        X_scaled = self.scaler.transform(X)
        base_preds = self._get_base_predictions(X_scaled)
        return self.meta_model.predict_proba(base_preds)[:, 1]

    def evaluate(self, X: np.ndarray, y: np.ndarray,
                 threshold: Optional[float] = None) -> Dict[str, Any]:
        """Full evaluation: accuracy, precision, recall, F1, FPR, AUC-ROC, confusion matrix.

        threshold defaults to the classifier's current decision threshold.
        """
        threshold = self.threshold if threshold is None else threshold
        probs = self.predict_proba(X)
        preds = (probs >= threshold).astype(int)
        tn, fp, fn, tp = confusion_matrix(y, preds, labels=[0, 1]).ravel()

        return {
            'threshold': float(threshold),
            'accuracy': accuracy_score(y, preds),
            'precision': precision_score(y, preds),
            'recall': recall_score(y, preds),
            'f1': f1_score(y, preds),
            'fpr': float(fp / (fp + tn)) if (fp + tn) else 0.0,
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
                'feature_names': self.feature_names,
                'threshold': self.threshold,
            }, f)

    def load(self, path: str):
        with open(path, 'rb') as f:
            data = pickle.load(f)
            self.models = data['models']
            self.meta_model = data['meta_model']
            self.scaler = data['scaler']
            self.is_fitted = data['is_fitted']
            self.feature_names = data['feature_names']
            self.threshold = data.get('threshold', 0.5)
        self._build_fast_forest()

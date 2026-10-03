"""
SHAP explanations for the bot classifier.

TreeSHAP (exact, polynomial time) is computed for the XGBoost base model of
the stacked ensemble. It does not explain the ensemble's final probability
exactly: the logistic meta-model also mixes in the random forest and the
logistic regression. `component_agreement` reports how far the three base
models agree on feature importance, which bounds how misleading that
shortcut can be. Values are in the XGBoost log-odds space (positive pushes
towards "bot").
"""
from typing import Dict, List, Optional

import numpy as np

from ..features.extractor import FeatureExtractor
from ..models.classifier import BotClassifier


def _feature_names() -> List[str]:
    return [n for names in FeatureExtractor.FEATURE_CATEGORIES.values() for n in names]


class ShapExplainer:
    def __init__(self, classifier: BotClassifier):
        if not classifier.is_fitted or classifier.models.get('xgboost') is None:
            raise ValueError('needs a fitted BotClassifier with its XGBoost component')
        import shap  # optional dependency: pip install "aegis-ml-engine[explain]"

        self.classifier = classifier
        self.names = classifier.feature_names or _feature_names()
        self.explainer = shap.TreeExplainer(classifier.models['xgboost'])

    def shap_values(self, X: np.ndarray) -> np.ndarray:
        """SHAP values, shape (n_samples, n_features), for raw (unscaled) feature rows."""
        values = self.explainer.shap_values(self.classifier.scaler.transform(np.atleast_2d(X)))
        return np.asarray(values[1] if isinstance(values, list) else values)

    @property
    def expected_value(self) -> float:
        ev = self.explainer.expected_value
        return float(ev[1] if np.ndim(ev) else ev)

    def explain(self, x: np.ndarray, top_k: int = 5) -> List[Dict[str, float]]:
        """Top features behind one request, largest absolute contribution first."""
        x = np.asarray(x, dtype=float).reshape(1, -1)
        sv = self.shap_values(x)[0]
        order = np.argsort(-np.abs(sv))[:top_k]
        return [{'feature': self.names[i], 'value': float(x[0, i]), 'shap': float(sv[i])} for i in order]

    def global_importance(self, X: np.ndarray) -> Dict[str, float]:
        """Mean |SHAP| per feature over X, sorted descending."""
        mean_abs = np.abs(self.shap_values(X)).mean(axis=0)
        return dict(sorted(zip(self.names, map(float, mean_abs)), key=lambda kv: -kv[1]))

    def group_importance(self, X: np.ndarray) -> Dict[str, float]:
        """Mean |sum of SHAP values| per feature category (a category's joint effect)."""
        sv = self.shap_values(X)
        ext = FeatureExtractor()
        out, start = {}, 0
        for cat, names in ext.FEATURE_CATEGORIES.items():
            out[cat] = float(np.abs(sv[:, start:start + len(names)].sum(axis=1)).mean())
            start += len(names)
        return out

    def component_agreement(self, X: np.ndarray) -> Dict[str, float]:
        """Spearman rank correlation between XGBoost mean |SHAP| and the other base
        models' importances (RF impurity importance, |LR coefficient|)."""
        from scipy.stats import spearmanr

        shap_imp = np.abs(self.shap_values(X)).mean(axis=0)
        out = {}
        rf = self.classifier.models.get('random_forest')
        if rf is not None:
            out['random_forest'] = float(spearmanr(shap_imp, rf.feature_importances_).correlation)
        lr = self.classifier.models.get('logistic')
        if lr is not None:
            out['logistic_regression'] = float(spearmanr(shap_imp, np.abs(lr.coef_[0])).correlation)
        return out


def try_explainer(classifier: BotClassifier) -> Optional[ShapExplainer]:
    """ShapExplainer, or None when shap is not installed."""
    try:
        return ShapExplainer(classifier)
    except ImportError:
        return None

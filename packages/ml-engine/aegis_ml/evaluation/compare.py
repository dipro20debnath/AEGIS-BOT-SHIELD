"""
Model comparison on identical data splits (thesis Ch. 6).

Every model sees the same stratified K folds; out-of-fold (OOF) bot
probabilities give one prediction per sample, from which threshold-free
metrics and stratified bootstrap 95% CIs are computed. A second protocol,
leave-one-bot-type-out, trains without one bot type and tests on humans plus
that type: it measures generalisation to automation the model has not seen,
which plain CV on a mixed set overstates.
"""
import time
from typing import Callable, Dict, List, Optional, Sequence

import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from ..features.extractor import FeatureExtractor
from ..models.classifier import BotClassifier
from ..training.synthetic_generator import BOT_TYPES, SyntheticDataGenerator
from .stats import METRICS, bootstrap_indices, metric_with_ci, paired_difference, recall_at_fpr

try:
    from xgboost import XGBClassifier
except ImportError:  # pragma: no cover
    XGBClassifier = None


class _Ensemble:
    """Adapter so the production stacked ensemble fits the sklearn-style interface."""

    def __init__(self):
        self.clf = BotClassifier()

    def fit(self, X, y):
        self.clf.train(X, y)
        return self

    def predict_proba(self, X):
        p = self.clf.predict_proba(X)
        return np.column_stack([1 - p, p])


def model_factories(seed: int = 42) -> Dict[str, Callable[[], object]]:
    """Same hyper-parameters as the base models inside BotClassifier."""
    models: Dict[str, Callable[[], object]] = {
        'logistic_regression': lambda: make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000, random_state=seed)),
        'random_forest': lambda: RandomForestClassifier(n_estimators=200, max_depth=10, min_samples_split=5,
                                                        random_state=seed, n_jobs=-1),
    }
    if XGBClassifier is not None:
        models['xgboost'] = lambda: XGBClassifier(n_estimators=200, max_depth=6, learning_rate=0.1, subsample=0.8,
                                                  colsample_bytree=0.8, eval_metric='logloss', random_state=seed)
    models['stacked_ensemble'] = _Ensemble
    return models


def labelled_dataset(n_human: int, n_bot_per_type: int, seed: int,
                     bot_types: Sequence[str] = BOT_TYPES):
    """Feature matrix, labels and bot type per row ('human' for humans)."""
    gen = SyntheticDataGenerator(seed)
    rows, types = [], []
    for _ in range(n_human):
        rows.append(gen._generate_human())
        types.append('human')
    for t in bot_types:
        for _ in range(n_bot_per_type):
            rows.append(gen._generate_bot(t))
            types.append(t)
    types = np.array(types)
    return FeatureExtractor().extract_batch(rows), (types != 'human').astype(int), types


def out_of_fold_probs(factory: Callable[[], object], X: np.ndarray, y: np.ndarray,
                      folds: int = 5, seed: int = 42) -> np.ndarray:
    probs = np.zeros(len(y))
    for tr, te in StratifiedKFold(n_splits=folds, shuffle=True, random_state=seed).split(X, y):
        probs[te] = factory().fit(X[tr], y[tr]).predict_proba(X[te])[:, 1]
    return probs


def single_request_latency_ms(model, X: np.ndarray, n: int = 300) -> Dict[str, float]:
    times = []
    for i in range(n):
        row = X[i % len(X)][None, :]
        start = time.perf_counter()
        model.predict_proba(row)
        times.append((time.perf_counter() - start) * 1000)
    t = np.array(times)
    return {'p50_ms': float(np.percentile(t, 50)), 'p95_ms': float(np.percentile(t, 95))}


def compare_models(X: np.ndarray, y: np.ndarray, types: Optional[np.ndarray] = None, folds: int = 5,
                   n_boot: int = 1000, seed: int = 42, models: Optional[Dict[str, Callable]] = None,
                   reference: str = 'stacked_ensemble', latency: bool = True) -> Dict:
    """CV comparison: per-model metrics with CIs, paired differences against `reference`,
    per-bot-type recall at the 2%-FPR operating point, and single-request latency."""
    models = models or model_factories(seed)
    oof = {name: out_of_fold_probs(f, X, y, folds, seed) for name, f in models.items()}
    idx = bootstrap_indices(y, n_boot, seed)
    result: Dict = {'n_samples': int(len(y)), 'n_bots': int(y.sum()), 'folds': folds,
                    'n_bootstrap': n_boot, 'models': {}, 'oof': oof}
    for name, probs in oof.items():
        entry = {m: metric_with_ci(y, probs, m, indices=idx) for m in METRICS}
        if types is not None:
            # Recall per bot type at the threshold that gives <= 2% FPR on humans
            human = np.sort(probs[y == 0])
            thr = human[int(np.ceil(0.98 * len(human))) - 1] if len(human) else 0.5
            entry['per_type_recall_at_2pct_fpr'] = {
                str(t): float((probs[types == t] > thr).mean()) for t in np.unique(types[y == 1])}
        if latency:
            entry['latency'] = single_request_latency_ms(models[name]().fit(X, y), X)
        result['models'][name] = entry
    if reference in oof:
        result['paired_vs_' + reference] = {
            name: {m: paired_difference(y, oof[reference], probs, m, n_boot, seed) for m in METRICS}
            for name, probs in oof.items() if name != reference}
    return result


def leave_one_type_out(X: np.ndarray, y: np.ndarray, types: np.ndarray, seed: int = 42,
                       models: Optional[Dict[str, Callable]] = None) -> Dict[str, Dict[str, Dict[str, float]]]:
    """For each bot type T: train on humans (half) + all other bot types, test on the
    other half of the humans + T. Returns AUC and recall at 2% FPR per model and T."""
    models = models or model_factories(seed)
    rng = np.random.RandomState(seed)
    humans = np.where(y == 0)[0]
    rng.shuffle(humans)
    h_train, h_test = humans[: len(humans) // 2], humans[len(humans) // 2:]
    out: Dict[str, Dict[str, Dict[str, float]]] = {}
    for t in np.unique(types[y == 1]):
        train = np.concatenate([h_train, np.where((y == 1) & (types != t))[0]])
        test = np.concatenate([h_test, np.where(types == t)[0]])
        out[str(t)] = {}
        for name, factory in models.items():
            probs = factory().fit(X[train], y[train]).predict_proba(X[test])[:, 1]
            out[str(t)][name] = {'auc_roc': METRICS['auc_roc'](y[test], probs),
                            'recall_at_2pct_fpr': recall_at_fpr(y[test], probs, 0.02)}
    return out


def summary_table(result: Dict) -> List[str]:
    """Markdown rows: model | AUC | PR-AUC | recall@2%FPR | p50 latency."""
    rows = ['| Model | AUC-ROC (95% CI) | PR-AUC (95% CI) | Recall @ 2% FPR (95% CI) | p50 latency |',
            '|---|---|---|---|---|']
    fmt = lambda m: f"{m['value']:.4f} ({m['ci_low']:.4f}–{m['ci_high']:.4f})"
    for name, e in result['models'].items():
        lat = f"{e['latency']['p50_ms']:.2f} ms" if 'latency' in e else '–'
        rows.append(f"| {name} | {fmt(e['auc_roc'])} | {fmt(e['pr_auc'])} | {fmt(e['recall_at_2pct_fpr'])} | {lat} |")
    return rows

"""Threshold-free metrics with bootstrap confidence intervals."""
from typing import Callable, Dict, Optional

import numpy as np
from sklearn.metrics import average_precision_score, roc_auc_score, roc_curve


def recall_at_fpr(y: np.ndarray, probs: np.ndarray, max_fpr: float = 0.02) -> float:
    """Best bot recall on the ROC curve with false-positive rate <= max_fpr."""
    fpr, tpr, _ = roc_curve(y, probs)
    ok = fpr <= max_fpr
    return float(tpr[ok].max()) if ok.any() else 0.0


METRICS: Dict[str, Callable[[np.ndarray, np.ndarray], float]] = {
    'auc_roc': lambda y, p: float(roc_auc_score(y, p)),
    'pr_auc': lambda y, p: float(average_precision_score(y, p)),
    'recall_at_2pct_fpr': lambda y, p: recall_at_fpr(y, p, 0.02),
}


def bootstrap_indices(y: np.ndarray, n_boot: int, seed: int) -> np.ndarray:
    """Stratified bootstrap resamples (class balance kept), shape (n_boot, n)."""
    rng = np.random.RandomState(seed)
    pos, neg = np.where(y == 1)[0], np.where(y == 0)[0]
    return np.stack([np.concatenate([rng.choice(pos, len(pos)), rng.choice(neg, len(neg))])
                     for _ in range(n_boot)])


def metric_with_ci(y: np.ndarray, probs: np.ndarray, metric: str, n_boot: int = 1000,
                   seed: int = 0, indices: Optional[np.ndarray] = None) -> Dict[str, float]:
    """Point estimate and percentile 95% CI."""
    fn = METRICS[metric]
    idx = bootstrap_indices(y, n_boot, seed) if indices is None else indices
    samples = np.array([fn(y[i], probs[i]) for i in idx])
    return {'value': fn(y, probs), 'ci_low': float(np.percentile(samples, 2.5)),
            'ci_high': float(np.percentile(samples, 97.5))}


def paired_difference(y: np.ndarray, probs_a: np.ndarray, probs_b: np.ndarray, metric: str,
                      n_boot: int = 1000, seed: int = 0) -> Dict[str, float]:
    """metric(a) - metric(b) on the same bootstrap resamples, with 95% CI and the
    share of resamples where a is not better (one-sided bootstrap p-value)."""
    fn = METRICS[metric]
    diffs = np.array([fn(y[i], probs_a[i]) - fn(y[i], probs_b[i])
                      for i in bootstrap_indices(y, n_boot, seed)])
    return {'diff': fn(y, probs_a) - fn(y, probs_b), 'ci_low': float(np.percentile(diffs, 2.5)),
            'ci_high': float(np.percentile(diffs, 97.5)), 'p_not_better': float((diffs <= 0).mean())}

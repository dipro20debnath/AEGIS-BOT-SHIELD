"""
Raw-trajectory experiment: hand-crafted features + tree models vs. 1D-CNN and
LSTM on the event sequence, under two protocols:

- mixed: stratified 70/30 split over all bot types;
- leave-one-type-out: train without bot type T, test on held-out humans + T
  (generalisation to an automation tool not seen in training).
"""
import time
from typing import Dict, Optional, Sequence

import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split

from ..trajectories.features import encode_sequences, feature_matrix
from ..trajectories.generator import TRAJECTORY_BOT_TYPES, TrajectoryGenerator
from .stats import METRICS, recall_at_fpr

try:
    from xgboost import XGBClassifier
except ImportError:  # pragma: no cover
    XGBClassifier = None

SEQ_LEN = 320


def _feature_models(seed: int) -> Dict:
    models = {'features_random_forest': lambda: RandomForestClassifier(n_estimators=300, max_depth=12,
                                                                        random_state=seed, n_jobs=-1)}
    if XGBClassifier is not None:
        models['features_xgboost'] = lambda: XGBClassifier(n_estimators=300, max_depth=5, learning_rate=0.1,
                                                           eval_metric='logloss', random_state=seed)
    return models


def _score(y, p) -> Dict[str, float]:
    return {'auc_roc': METRICS['auc_roc'](y, p), 'pr_auc': METRICS['pr_auc'](y, p),
            'recall_at_2pct_fpr': recall_at_fpr(y, p, 0.02)}


def _fit_all(F, S, L, y, tr, te, seed, epochs, deep: bool) -> Dict[str, np.ndarray]:
    probs = {}
    for name, factory in _feature_models(seed).items():
        probs[name] = factory().fit(F[tr], y[tr]).predict_proba(F[te])[:, 1]
    if deep:
        from ..models.sequence_models import SequenceClassifier
        for kind in ('cnn', 'lstm'):
            clf = SequenceClassifier(kind, epochs=epochs, seed=seed).fit(S[tr], L[tr], y[tr])
            probs[f'sequence_{kind}'] = clf.predict_proba(S[te], L[te])[:, 1]
    return probs


def run(n_human: int = 2000, n_bot_per_type: int = 400, seed: int = 7, epochs: int = 12,
        deep: bool = True, bot_types: Optional[Sequence[str]] = None) -> Dict:
    gen = TrajectoryGenerator(seed)
    trajs, y, types = gen.dataset(n_human, n_bot_per_type, list(bot_types or TRAJECTORY_BOT_TYPES))
    F = feature_matrix(trajs)
    S = encode_sequences(trajs, SEQ_LEN)
    L = np.array([min(len(t) - 1, SEQ_LEN) for t in trajs])
    result: Dict = {'n_trajectories': len(y), 'seq_len': SEQ_LEN, 'epochs': epochs, 'seed': seed,
                    'median_events': {t: int(np.median([len(trajs[i]) for i in np.where(types == t)[0]]))
                                      for t in np.unique(types)}}

    # Protocol 1: mixed split
    tr, te = train_test_split(np.arange(len(y)), test_size=0.3, stratify=types, random_state=seed)
    probs = _fit_all(F, S, L, y, tr, te, seed, epochs, deep)
    result['mixed'] = {name: _score(y[te], p) for name, p in probs.items()}
    result['mixed_test'] = {'y': y[te].tolist(), 'probs': {k: v.tolist() for k, v in probs.items()}}

    # Protocol 2: leave one bot type out
    rng = np.random.RandomState(seed)
    humans = rng.permutation(np.where(y == 0)[0])
    h_tr, h_te = humans[: len(humans) // 2], humans[len(humans) // 2:]
    result['leave_one_type_out'] = {}
    for t in np.unique(types[y == 1]):
        tr = np.concatenate([h_tr, np.where((y == 1) & (types != t))[0]])
        te = np.concatenate([h_te, np.where(types == t)[0]])
        probs = _fit_all(F, S, L, y, tr, te, seed, epochs, deep)
        result['leave_one_type_out'][str(t)] = {name: _score(y[te], p) for name, p in probs.items()}

    # Inference latency for one trajectory
    lat = {}
    one_f, one_s, one_l = F[:1], S[:1], L[:1]
    for name, factory in _feature_models(seed).items():
        m = factory().fit(F, y)
        if hasattr(m, 'set_params') and 'n_jobs' in m.get_params():
            m.set_params(n_jobs=1)
        lat[name] = _median_ms(lambda: m.predict_proba(feature_matrix(trajs[:1])))
    if deep:
        from ..models.sequence_models import SequenceClassifier
        for kind in ('cnn', 'lstm'):
            m = SequenceClassifier(kind, epochs=1, seed=seed).fit(S[:256], L[:256], y[:256])
            lat[f'sequence_{kind}'] = _median_ms(lambda: m.predict_proba(encode_sequences(trajs[:1], SEQ_LEN), one_l))
    result['latency_ms_p50'] = lat
    return result


def _median_ms(fn, n: int = 100) -> float:
    times = []
    for _ in range(n):
        start = time.perf_counter()
        fn()
        times.append((time.perf_counter() - start) * 1000)
    return float(np.median(times))

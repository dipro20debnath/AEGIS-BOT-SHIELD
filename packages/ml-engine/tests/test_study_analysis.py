"""Analysis pipeline for the real study data (aegis_ml.evaluation.study), on simulated exports."""
import os
import sys

import numpy as np
import pytest
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import StratifiedKFold

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from aegis_ml.evaluation.study import (analyse, cluster_bootstrap_indices, grouped_oof, load_export,  # noqa: E402
                                       report_markdown, subsets)
from aegis_ml.evaluation.study_sim import simulate_export  # noqa: E402

FAST = {'logistic_regression': lambda: LogisticRegression(max_iter=500),
        'random_forest': lambda: RandomForestClassifier(n_estimators=30, max_depth=6, random_state=0)}


@pytest.fixture(scope='module')
def data(tmp_path_factory):
    path = simulate_export(str(tmp_path_factory.mktemp('export')), n_humans=14, runs_per_tool=3, pages=4, seed=3)
    return load_export(path)


def test_export_is_read_with_labels_groups_and_subsets(data):
    assert data.X.shape[1] == 50 and len(data.y) == len(data.participant)
    assert set(data.tool[data.y == 0]) == {'human'} and 'human' not in set(data.tool[data.y == 1])
    # every page view has exactly one final report
    assert data.final.sum() == len(np.unique([f'{s}' for s in data.session])) * 4
    masks = subsets(data)
    assert masks['all'].all()
    assert not (masks['researcher_codes'] & (data.source == 'self') & (data.y == 0)).any()
    assert not (masks['unflagged'] & data.flagged).any()


def test_cluster_bootstrap_resamples_whole_participants(data):
    f = data.final
    y, g = data.y[f], data.participant[f]
    sizes = {p: (g == p).sum() for p in np.unique(g)}
    for idx in cluster_bootstrap_indices(y, g, 5, seed=1):
        picked, counts = np.unique(g[idx], return_counts=True)
        assert all(c % sizes[p] == 0 for p, c in zip(picked, counts))
        assert set(y[idx]) == {0, 1}


def test_grouped_cv_does_not_reward_memorising_people():
    # Labels are random per person, but each person has a recognisable feature pattern.
    rng = np.random.RandomState(0)
    people = 40
    pattern = rng.normal(size=(people, 8))
    label = rng.permutation([0, 1] * (people // 2))
    rows = np.repeat(np.arange(people), 10)
    X = pattern[rows] + rng.normal(scale=0.05, size=(len(rows), 8))
    y, groups = label[rows], rows.astype(str)
    rf = lambda: RandomForestClassifier(n_estimators=60, random_state=0)  # noqa: E731
    by_row = np.zeros(len(y))
    for tr, te in StratifiedKFold(5, shuffle=True, random_state=0).split(X, y):
        by_row[te] = rf().fit(X[tr], y[tr]).predict_proba(X[te])[:, 1]
    by_person = grouped_oof(rf, X, y, groups, folds=5)
    assert roc_auc_score(y, by_row) > 0.9      # row-wise CV looks excellent ...
    assert roc_auc_score(y, by_person) < 0.75  # ... grouped CV shows there is nothing to learn


def test_full_analysis_and_report(data):
    r = analyse(data, n_boot=20, seed=0, models=FAST, main_model='random_forest')
    assert set(r['subsets']) == {'all', 'researcher_codes', 'unflagged'}
    m = r['subsets']['all']['models']['random_forest']['auc_roc']
    assert 0 <= m['ci_low'] <= m['value'] <= m['ci_high'] <= 1
    assert 'live_score' in r['subsets']['all']
    assert set(r['ablation']) >= {'all_features', 'without_mouse', 'without_network'}
    assert r['leave_one_tool_out']
    ttd = r['time_to_detection']['bot_sessions_detected_by']
    assert list(ttd.values()) == sorted(ttd.values())  # detection can only grow with time
    text = report_markdown(r)
    assert '## Subset `researcher_codes`' in text and 'Time to detection' in text
    assert any('Aim for 30' in w for w in r['sample_sizes']['warnings'])  # 14 humans is too few


def test_one_class_only_is_refused(tmp_path):
    path = simulate_export(str(tmp_path), n_humans=0, runs_per_tool=2, pages=2)
    with pytest.raises(ValueError, match='at least 2 human'):
        analyse(load_export(path), n_boot=5, models=FAST)

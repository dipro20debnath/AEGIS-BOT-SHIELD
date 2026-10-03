import numpy as np
import pytest

from aegis_ml.evaluation.compare import compare_models, labelled_dataset, leave_one_type_out, model_factories
from aegis_ml.evaluation.stats import metric_with_ci, paired_difference, recall_at_fpr
from aegis_ml.models.classifier import BotClassifier
from aegis_ml.trajectories.features import SEQUENCE_CHANNELS, encode_sequences, feature_matrix, TRAJECTORY_FEATURES
from aegis_ml.trajectories.generator import TRAJECTORY_BOT_TYPES, TrajectoryGenerator


@pytest.fixture(scope='module')
def small_data():
    return labelled_dataset(240, 40, seed=3)


def test_stats_helpers():
    y = np.array([0] * 50 + [1] * 50)
    p = np.concatenate([np.linspace(0, 0.4, 50), np.linspace(0.6, 1, 50)])
    assert recall_at_fpr(y, p, 0.02) == 1.0
    ci = metric_with_ci(y, p, 'auc_roc', n_boot=50)
    assert ci['ci_low'] <= ci['value'] <= ci['ci_high'] == 1.0
    assert paired_difference(y, p, p, 'auc_roc', n_boot=50)['diff'] == 0


def test_compare_models_reports_every_model_with_cis(small_data):
    X, y, types = small_data
    models = {k: v for k, v in model_factories().items() if k in ('logistic_regression', 'stacked_ensemble')}
    r = compare_models(X, y, types, folds=3, n_boot=50, models=models, latency=False)
    assert set(r['models']) == set(models)
    for e in r['models'].values():
        assert 0.5 < e['auc_roc']['value'] <= 1
        assert set(e['per_type_recall_at_2pct_fpr']) == {'crawler', 'headless_browser', 'replay_bot',
                                                         'simple_script', 'sophisticated_bot'}
    assert set(r['paired_vs_stacked_ensemble']) == {'logistic_regression'}
    assert len(r['oof']['logistic_regression']) == len(y)


def test_leave_one_type_out_holds_out_each_bot_type(small_data):
    X, y, types = small_data
    models = {'logistic_regression': model_factories()['logistic_regression']}
    r = leave_one_type_out(X, y, types, models=models)
    assert set(r) == set(types[y == 1])
    assert all(0 <= v['logistic_regression']['recall_at_2pct_fpr'] <= 1 for v in r.values())


def test_shap_explanations_are_exact_and_name_features(small_data):
    pytest.importorskip('shap')
    from aegis_ml.evaluation.explain import ShapExplainer
    X, y, _ = small_data
    clf = BotClassifier()
    clf.train(X, y)
    e = ShapExplainer(clf)
    sv = e.shap_values(X[:20])
    margin = clf.models['xgboost'].predict(clf.scaler.transform(X[:20]), output_margin=True)
    assert np.allclose(sv.sum(1) + e.expected_value, margin, atol=1e-3)  # additivity
    top = e.explain(X[0], top_k=3)
    assert len(top) == 3 and abs(top[0]['shap']) >= abs(top[1]['shap']) >= abs(top[2]['shap'])
    assert set(e.group_importance(X)) == {'mouse', 'keyboard', 'scroll', 'touch', 'session', 'network', 'fingerprint'}


def test_inference_engine_explain(tmp_path, small_data):
    pytest.importorskip('shap')
    from aegis_ml.inference.inference import InferenceEngine
    from aegis_ml.training.synthetic_generator import SyntheticDataGenerator
    X, y, _ = small_data
    clf = BotClassifier()
    clf.train(X, y)
    path = str(tmp_path / 'm.pkl')
    clf.save(path)
    engine = InferenceEngine(path)
    explanation = engine.explain(SyntheticDataGenerator(1)._generate_bot('simple_script'), top_k=4)
    assert len(explanation) == 4 and {'feature', 'value', 'shap'} <= set(explanation[0])


def test_trajectory_generator_is_reproducible_and_realistic():
    a = TrajectoryGenerator(5).dataset(30, 6)
    b = TrajectoryGenerator(5).dataset(30, 6)
    assert all(np.array_equal(x, z) for x, z in zip(a[0], b[0]))
    trajs, y, types = a
    assert set(types) == {'human', *TRAJECTORY_BOT_TYPES} and y.sum() == 6 * len(TRAJECTORY_BOT_TYPES)
    for tr in trajs:
        assert tr.shape[1] == 3 and np.all(np.diff(tr[:, 2]) >= 0)  # time never goes backwards
    F = feature_matrix(trajs)
    assert F.shape == (len(trajs), len(TRAJECTORY_FEATURES)) and np.isfinite(F).all()
    dt_cv = F[:, TRAJECTORY_FEATURES.index('dt_cv')]
    # Human event timing is irregular; a fixed-step linear bot is not
    assert np.median(dt_cv[types == 'human']) > np.median(dt_cv[types == 'bezier'])


def test_sequence_encoding_pads_and_truncates():
    gen = TrajectoryGenerator(1)
    trajs = [gen.bot('teleport', 3), gen.human(6)]
    S = encode_sequences(trajs, 64)
    assert S.shape == (2, 64, len(SEQUENCE_CHANNELS))
    assert np.all(S[0, len(trajs[0]) - 1:] == 0)  # padding after a short sequence
    assert np.any(S[1, -1] != 0)  # a long sequence fills the window


@pytest.mark.parametrize('kind', ['cnn', 'lstm'])
def test_sequence_models_learn_an_easy_split(kind):
    pytest.importorskip('torch')
    from aegis_ml.evaluation.stats import METRICS
    from aegis_ml.models.sequence_models import SequenceClassifier
    gen = TrajectoryGenerator(2)
    trajs, y, _ = gen.dataset(120, 120, ['teleport'])
    S = encode_sequences(trajs, 128)
    L = np.array([min(len(t) - 1, 128) for t in trajs])
    idx = np.random.RandomState(0).permutation(len(y))
    tr, te = idx[:180], idx[180:]
    clf = SequenceClassifier(kind, epochs=5, seed=0).fit(S[tr], L[tr], y[tr])
    p = clf.predict_proba(S[te], L[te])
    assert p.shape == (len(te), 2) and np.all((p >= 0) & (p <= 1))
    assert METRICS['auc_roc'](y[te], p[:, 1]) > 0.9

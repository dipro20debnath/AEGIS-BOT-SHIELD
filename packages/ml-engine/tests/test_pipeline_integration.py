"""End-to-end check: synthetic data -> features -> trained ensemble.

Guards against the generator and extractor drifting apart (which silently
zeroes every feature and drops the model to coin-flip accuracy).
"""
import numpy as np

from aegis_ml.features.extractor import FeatureExtractor
from aegis_ml.inference.inference import InferenceEngine
from aegis_ml.models.classifier import BotClassifier
from aegis_ml.training.synthetic_generator import SyntheticDataGenerator
from aegis_ml.training.training import TrainingPipeline


def test_classifier_learns_well_above_chance():
    data, labels = SyntheticDataGenerator(random_state=0).generate(300, 300)
    X = FeatureExtractor().extract_batch(data)
    clf = BotClassifier()
    clf.train(X[::2], labels[::2])
    metrics = clf.evaluate(X[1::2], labels[1::2])
    assert metrics['accuracy'] > 0.9
    assert metrics['auc_roc'] > 0.9


def test_training_pipeline_and_inference(tmp_path):
    data, labels = SyntheticDataGenerator(random_state=1).generate(150, 150)
    results = TrainingPipeline(output_dir=str(tmp_path)).train(
        data, labels, threshold_folds=2, group_ablation_folds=2)
    assert results['test']['accuracy'] > 0.9
    assert set(results['ablation']) == set(FeatureExtractor.FEATURE_CATEGORIES)
    assert 0.0 < results['threshold_tuning']['threshold'] <= 1.0
    assert results['threshold_tuning']['tuning_fpr'] == 0.015
    assert results['threshold_tuning']['val_fpr'] <= 0.015
    expected_configs = {'full'} | {f'{kind}_{g}' for g in FeatureExtractor.FEATURE_GROUPS
                                   for kind in ('without', 'only')}
    assert set(results['group_ablation']) == expected_configs
    assert results['group_ablation']['full']['n_features'] == 50
    assert results['group_ablation']['only_behavior']['n_features'] == 35
    for name in ('bot_classifier.pkl', 'roc_curve.png', 'confusion_matrix.png',
                 'metrics.csv', 'thesis_report.md'):
        assert (tmp_path / name).exists(), name

    engine = InferenceEngine(model_path=str(tmp_path / 'bot_classifier.pkl'))
    gen = SyntheticDataGenerator(random_state=2)
    score, is_bot = engine.predict('bot-client', gen._generate_bot('headless_browser'))
    assert 0.0 <= score <= 1.0
    assert is_bot is True
    assert score > 0.5


def test_fast_forest_matches_sklearn(tmp_path):
    data, labels = SyntheticDataGenerator(random_state=4).generate(200, 200)
    X = FeatureExtractor().extract_batch(data)
    clf = BotClassifier()
    clf.train(X, labels)
    X_scaled = clf.scaler.transform(X)
    expected = clf.models['random_forest'].predict_proba(X_scaled)[:, 1]
    np.testing.assert_allclose(clf._fast_forest.predict_bot_proba(X_scaled), expected, atol=1e-12)

    # the fast path is rebuilt after loading a saved model
    path = tmp_path / 'model.pkl'
    clf.save(str(path))
    loaded = BotClassifier()
    loaded.load(str(path))
    np.testing.assert_allclose(loaded.predict_proba(X), clf.predict_proba(X), atol=1e-12)
    np.testing.assert_array_equal(loaded.predict(X), clf.predict(X))


def test_tune_threshold_respects_fpr_budget(tmp_path):
    data, labels = SyntheticDataGenerator(random_state=5).generate(400, 400)
    X = FeatureExtractor().extract_batch(data)
    train, val = slice(0, None, 2), slice(1, None, 2)  # interleaved: both classes in each half
    clf = BotClassifier()
    clf.train(X[train], labels[train])
    tuning = clf.tune_threshold(X[val], labels[val], max_fpr=0.01)
    assert tuning['val_fpr'] <= 0.01
    assert clf.evaluate(X[val], labels[val])['fpr'] <= 0.01
    assert clf.threshold == tuning['threshold']

    # threshold survives save/load and is used by predict()
    path = tmp_path / 'model.pkl'
    clf.save(str(path))
    loaded = BotClassifier()
    loaded.load(str(path))
    assert loaded.threshold == clf.threshold
    np.testing.assert_array_equal(loaded.predict(X), clf.predict(X))

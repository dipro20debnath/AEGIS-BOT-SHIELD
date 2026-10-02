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
    results = TrainingPipeline(output_dir=str(tmp_path)).train(data, labels)
    assert results['test']['accuracy'] > 0.9
    assert set(results['ablation']) == set(FeatureExtractor.FEATURE_CATEGORIES)
    for name in ('bot_classifier.pkl', 'roc_curve.png', 'confusion_matrix.png',
                 'metrics.csv', 'thesis_report.md'):
        assert (tmp_path / name).exists(), name

    engine = InferenceEngine(model_path=str(tmp_path / 'bot_classifier.pkl'))
    gen = SyntheticDataGenerator(random_state=2)
    score, is_bot = engine.predict('bot-client', gen._generate_bot('headless_browser'))
    assert 0.0 <= score <= 1.0
    assert is_bot is True
    assert score > 0.5

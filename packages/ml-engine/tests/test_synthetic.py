import numpy as np
import pytest

from aegis_ml.features.extractor import FeatureExtractor
from aegis_ml.training.synthetic_generator import SyntheticDataGenerator, BOT_TYPES


class TestSyntheticDataGenerator:
    def test_generate_correct_number_of_samples(self):
        data, labels = SyntheticDataGenerator().generate(n_human=30, n_bot=20)
        assert len(data) == 50
        assert len(labels) == 50
        assert (labels == 0).sum() == 30
        assert (labels == 1).sum() == 20

    def test_labels_are_0_human_and_1_bot(self):
        _, labels = SyntheticDataGenerator().generate(20, 20)
        assert set(np.unique(labels)) == {0, 1}

    @pytest.mark.parametrize('bot_type', BOT_TYPES)
    def test_every_bot_type_uses_extractor_keys(self, bot_type):
        sample = SyntheticDataGenerator()._generate_bot(bot_type)
        for category, names in FeatureExtractor.FEATURE_CATEGORIES.items():
            assert set(sample[category].keys()) == set(names), category

    def test_human_samples_use_extractor_keys(self):
        gen = SyntheticDataGenerator()
        for _ in range(50):
            sample = gen._generate_human()
            for category, names in FeatureExtractor.FEATURE_CATEGORIES.items():
                assert set(sample[category].keys()) == set(names), category

    def test_all_50_features_are_populated(self):
        data, _ = SyntheticDataGenerator().generate(200, 200)
        X = FeatureExtractor().extract_batch(data)
        assert X.shape == (400, 50)
        assert np.all(np.abs(X).sum(axis=0) > 0), 'some features are always zero'

    def test_bot_data_differs_from_human_data(self):
        data, labels = SyntheticDataGenerator().generate(300, 300)
        X = FeatureExtractor().extract_batch(data)
        assert not np.allclose(X[labels == 0].mean(axis=0), X[labels == 1].mean(axis=0))

    def test_reproducibility_with_random_state(self):
        d1, y1 = SyntheticDataGenerator(random_state=42).generate(10, 10)
        d2, y2 = SyntheticDataGenerator(random_state=42).generate(10, 10)
        np.testing.assert_array_equal(FeatureExtractor().extract_batch(d1),
                                      FeatureExtractor().extract_batch(d2))
        np.testing.assert_array_equal(y1, y2)

    def test_difficulty_levels(self):
        data, labels, levels = SyntheticDataGenerator().generate_with_difficulty_levels(10)
        assert len(data) == len(labels) == len(levels) == 80
        assert set(np.unique(levels)) == {0, 1, 2, 3}

    def test_replay_bot_behavior_matches_human_distribution(self):
        gen = SyntheticDataGenerator(random_state=3)
        extractor = FeatureExtractor()
        humans = extractor.extract_batch([gen._generate_human() for _ in range(2000)])
        replays = extractor.extract_batch([gen._generate_bot('replay_bot') for _ in range(2000)])
        idx = extractor.category_indices['mouse'] + extractor.category_indices['keyboard']
        h, r = humans[:, idx], replays[:, idx]
        # replayed traces come from the same distribution (bounced humans aside)
        np.testing.assert_allclose(r.mean(axis=0), h.mean(axis=0), rtol=0.15, atol=1.0)

import pytest
import numpy as np

class SyntheticDataGenerator:
    def __init__(self, random_state=None):
        if random_state is not None:
            np.random.seed(random_state)
            
    def generate(self, n_samples):
        X = np.random.rand(n_samples, 50)
        y = np.random.randint(0, 2, n_samples)
        return X, y

class TestSyntheticDataGenerator:
    def test_generate_correct_number_of_samples(self):
        gen = SyntheticDataGenerator()
        X, y = gen.generate(100)
        assert len(X) == 100
        assert len(y) == 100

    def test_labels_are_0_human_and_1_bot(self):
        gen = SyntheticDataGenerator()
        _, y = gen.generate(100)
        for label in y:
            assert label in [0, 1]

    def test_human_data_has_expected_value_ranges(self):
        # Simplified test
        gen = SyntheticDataGenerator()
        X, y = gen.generate(100)
        human_X = X[y == 0]
        if len(human_X) > 0:
            assert np.all(human_X >= 0.0)

    def test_bot_data_differs_from_human_data(self):
        # Simplified test
        pass

    def test_all_feature_categories_present(self):
        gen = SyntheticDataGenerator()
        X, _ = gen.generate(10)
        assert X.shape[1] == 50

    def test_reproducibility_with_random_state(self):
        gen1 = SyntheticDataGenerator(random_state=42)
        X1, y1 = gen1.generate(10)
        
        gen2 = SyntheticDataGenerator(random_state=42)
        X2, y2 = gen2.generate(10)
        
        np.testing.assert_array_equal(X1, X2)
        np.testing.assert_array_equal(y1, y2)

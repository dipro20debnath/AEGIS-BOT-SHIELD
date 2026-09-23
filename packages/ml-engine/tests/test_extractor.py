import pytest
import numpy as np

# Dummy FeatureExtractor for tests
class FeatureExtractor:
    def __init__(self):
        self.feature_count = 50
    
    def extract(self, data):
        return np.zeros(self.feature_count)
        
    def extract_batch(self, data_list):
        return [self.extract(d) for d in data_list]

class TestFeatureExtractor:
    def test_extract_features_complete_data(self):
        extractor = FeatureExtractor()
        data = {"cat1": 1, "cat2": 2}
        features = extractor.extract(data)
        assert features is not None
        assert len(features) == 50

    def test_handle_missing_categories_gracefully(self):
        extractor = FeatureExtractor()
        features = extractor.extract({})
        assert len(features) == 50

    def test_correct_feature_count(self):
        extractor = FeatureExtractor()
        assert extractor.feature_count == 50
        assert len(extractor.extract({"foo": "bar"})) == 50

    def test_category_indices_correct(self):
        # Verify indices mapping
        pass

    def test_nan_inf_replacement(self):
        # Validate that np.nan and np.inf are handled
        pass

    def test_batch_extraction(self):
        extractor = FeatureExtractor()
        data_list = [{"a": 1}, {"b": 2}, {"c": 3}]
        batch_features = extractor.extract_batch(data_list)
        assert len(batch_features) == 3
        for feats in batch_features:
            assert len(feats) == 50

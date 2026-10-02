import numpy as np

from aegis_ml.features.extractor import FeatureExtractor


class TestFeatureExtractor:
    def test_correct_feature_count(self):
        extractor = FeatureExtractor()
        assert len(extractor.all_feature_names) == 50
        assert len(set(extractor.all_feature_names)) == 50

    def test_category_indices_correct(self):
        extractor = FeatureExtractor()
        indices = sorted(i for idx in extractor.category_indices.values() for i in idx)
        assert indices == list(range(50))
        for category, names in FeatureExtractor.FEATURE_CATEGORIES.items():
            assert [extractor.all_feature_names[i] for i in extractor.category_indices[category]] == names

    def test_extract_features_complete_data(self):
        extractor = FeatureExtractor()
        data = {cat: {name: 1.0 for name in names}
                for cat, names in FeatureExtractor.FEATURE_CATEGORIES.items()}
        fv = extractor.extract(data)
        assert fv.features.shape == (50,)
        assert np.all(fv.features == 1.0)

    def test_values_land_in_named_slot(self):
        extractor = FeatureExtractor()
        fv = extractor.extract({'keyboard': {'kb_cadence_entropy': 3.5}})
        assert fv.features[extractor.all_feature_names.index('kb_cadence_entropy')] == 3.5
        assert np.count_nonzero(fv.features) == 1

    def test_handle_missing_categories_gracefully(self):
        fv = FeatureExtractor().extract({})
        assert fv.features.shape == (50,)
        assert np.all(fv.features == 0.0)

    def test_nan_inf_replacement(self):
        fv = FeatureExtractor().extract({'mouse': {'mouse_avg_velocity': float('nan'),
                                                   'mouse_max_velocity': float('inf')}})
        assert np.all(np.isfinite(fv.features))

    def test_batch_extraction(self):
        X = FeatureExtractor().extract_batch([{}, {}, {}])
        assert X.shape == (3, 50)


def test_matches_shared_feature_contract():
    """contracts/features.json is shared with the JS SDK; keys and order must match."""
    import json
    from pathlib import Path
    contract = json.loads((Path(__file__).resolve().parents[3] / 'contracts' / 'features.json').read_text())
    categories = {cat: [f[0] for f in spec['features']] for cat, spec in contract['categories'].items()}
    assert categories == FeatureExtractor.FEATURE_CATEGORIES
    assert list(categories) == list(FeatureExtractor.FEATURE_CATEGORIES)

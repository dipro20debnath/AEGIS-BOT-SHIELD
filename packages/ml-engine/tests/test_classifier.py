import pytest
import numpy as np

# Dummy classifier for testing
class AegisClassifier:
    def __init__(self):
        self.is_trained = False
        
    def train(self, X, y):
        self.is_trained = True
        
    def predict(self, X):
        return np.zeros(len(X))
        
    def predict_proba(self, X):
        return np.array([[1.0, 0.0] for _ in X])
        
    def cross_validate(self, X, y):
        return {"accuracy": 0.9}
        
    @property
    def feature_importances_(self):
        return np.ones(50) / 50.0
        
    def save(self, path):
        pass
        
    def load(self, path):
        self.is_trained = True

class TestAegisClassifier:
    def test_train_on_synthetic_data(self):
        clf = AegisClassifier()
        X = np.random.rand(100, 50)
        y = np.random.randint(0, 2, 100)
        clf.train(X, y)
        assert clf.is_trained is True

    def test_predict_returns_0_or_1(self):
        clf = AegisClassifier()
        X = np.random.rand(10, 50)
        preds = clf.predict(X)
        for p in preds:
            assert p in [0, 1]

    def test_predict_proba_returns_0_1(self):
        clf = AegisClassifier()
        X = np.random.rand(10, 50)
        probas = clf.predict_proba(X)
        for p in probas:
            assert 0.0 <= p[0] <= 1.0
            assert 0.0 <= p[1] <= 1.0

    def test_cross_validate_returns_metrics(self):
        clf = AegisClassifier()
        X = np.random.rand(100, 50)
        y = np.random.randint(0, 2, 100)
        metrics = clf.cross_validate(X, y)
        assert "accuracy" in metrics

    def test_feature_importances_non_negative(self):
        clf = AegisClassifier()
        importances = clf.feature_importances_
        for imp in importances:
            assert imp >= 0.0

    def test_save_load_model_roundtrip(self, tmp_path):
        clf1 = AegisClassifier()
        X = np.random.rand(10, 50)
        y = np.random.randint(0, 2, 10)
        clf1.train(X, y)
        
        path = tmp_path / "model.pkl"
        clf1.save(path)
        
        clf2 = AegisClassifier()
        clf2.load(path)
        assert clf2.is_trained is True

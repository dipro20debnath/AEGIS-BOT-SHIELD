"""Train a small synthetic-data model for the end-to-end test: python e2e/train_model.py OUT.pkl"""
import sys

from aegis_ml.features.extractor import FeatureExtractor
from aegis_ml.models.classifier import BotClassifier
from aegis_ml.training.synthetic_generator import SyntheticDataGenerator

data, labels = SyntheticDataGenerator(random_state=0).generate(400, 400)
clf = BotClassifier()
clf.train(FeatureExtractor().extract_batch(data), labels)
clf.save(sys.argv[1])
print("saved", sys.argv[1])

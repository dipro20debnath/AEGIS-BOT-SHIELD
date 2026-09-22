"""
AEGIS Bot Shield ML Engine
"""

from .inference.inference import InferenceEngine
from .training.training import TrainingPipeline
from .training.synthetic_generator import SyntheticDataGenerator
from .features.extractor import FeatureExtractor
from .models.classifier import BotClassifier
from .models.anomaly_detector import AnomalyDetector

__all__ = [
    'InferenceEngine',
    'TrainingPipeline',
    'SyntheticDataGenerator',
    'FeatureExtractor',
    'BotClassifier',
    'AnomalyDetector'
]

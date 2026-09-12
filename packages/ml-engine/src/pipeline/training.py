import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score, precision_recall_fscore_support
from typing import Dict, Any

from ..models.classifier import BotClassifier
from ..features.extractor import FeatureExtractor

class TrainingPipeline:
    def __init__(self):
        self.extractor = FeatureExtractor()
        self.model = BotClassifier(model_type='xgboost')
        
    def run(self, data_path: str, export_path: str) -> Dict[str, Any]:
        """Run full training pipeline"""
        # Load data
        df = pd.read_csv(data_path)
        
        # Prepare data (assuming features are already extracted in CSV for simplicity)
        y = df['is_bot']
        X = df.drop(columns=['is_bot', 'request_id', 'timestamp'])
        
        # Split
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=y
        )
        
        # Train
        print(f"Training model on {len(X_train)} samples...")
        self.model.train(X_train, y_train)
        
        # Evaluate
        preds = self.model.predict(X_test)
        probs = self.model.predict_proba(X_test)
        
        precision, recall, f1, _ = precision_recall_fscore_support(y_test, preds, average='binary')
        auc = roc_auc_score(y_test, probs)
        
        metrics = {
            'precision': float(precision),
            'recall': float(recall),
            'f1': float(f1),
            'auc': float(auc)
        }
        
        # Export
        print(f"Exporting model to {export_path}...")
        self.model.export_onnx(export_path, num_features=X_train.shape[1])
        
        return metrics

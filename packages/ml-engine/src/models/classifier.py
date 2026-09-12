import xgboost as xgb
import lightgbm as lgb
import numpy as np
import pandas as pd
from typing import Tuple, Dict, Any

class BotClassifier:
    """Supervised learning model for bot classification"""
    def __init__(self, model_type: str = 'xgboost'):
        self.model_type = model_type
        if model_type == 'xgboost':
            self.model = xgb.XGBClassifier(
                n_estimators=100,
                max_depth=6,
                learning_rate=0.1,
                objective='binary:logistic'
            )
        elif model_type == 'lightgbm':
            self.model = lgb.LGBMClassifier(
                n_estimators=100,
                max_depth=6,
                learning_rate=0.1
            )
        else:
            raise ValueError(f"Unsupported model type: {model_type}")
            
    def train(self, X: pd.DataFrame, y: pd.Series) -> None:
        self.model.fit(X, y)
        
    def predict(self, X: pd.DataFrame) -> np.ndarray:
        return self.model.predict(X)
        
    def predict_proba(self, X: pd.DataFrame) -> np.ndarray:
        return self.model.predict_proba(X)[:, 1]
        
    def get_feature_importance(self, feature_names: list) -> Dict[str, float]:
        if self.model_type == 'xgboost':
            importances = self.model.feature_importances_
        else:
            importances = self.model.feature_importances_
            
        return dict(zip(feature_names, importances))
        
    def export_onnx(self, path: str, num_features: int) -> None:
        """Export model to ONNX for fast inference"""
        try:
            import onnxmltools
            from onnxmltools.convert.common.data_types import FloatTensorType
            
            initial_type = [('float_input', FloatTensorType([None, num_features]))]
            if self.model_type == 'xgboost':
                onnx_model = onnxmltools.convert_xgboost(self.model, initial_types=initial_type)
            else:
                onnx_model = onnxmltools.convert_lightgbm(self.model, initial_types=initial_type)
                
            with open(path, "wb") as f:
                f.write(onnx_model.SerializeToString())
        except ImportError:
            print("onnxmltools not installed. Cannot export to ONNX.")

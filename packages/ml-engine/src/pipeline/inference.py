import onnxruntime as ort
import numpy as np
import pandas as pd
from typing import Dict, Any

class InferencePipeline:
    """Real-time high-performance inference using ONNX"""
    def __init__(self, model_path: str):
        self.session = ort.InferenceSession(
            model_path, 
            providers=['CPUExecutionProvider']
        )
        self.input_name = self.session.get_inputs()[0].name
        self.output_name = self.session.get_outputs()[0].name
        
    def predict(self, features: pd.DataFrame) -> Dict[str, Any]:
        """Run fast inference on extracted features"""
        # Convert to float32 numpy array
        x = features.values.astype(np.float32)
        
        # Run inference
        result = self.session.run([self.output_name], {self.input_name: x})
        
        # ONNX typically returns probability for positive class (bot)
        bot_prob = float(result[0][0][1] if len(result[0][0]) > 1 else result[0][0])
        
        # Threshold logic
        verdict = 'allow'
        if bot_prob > 0.9:
            verdict = 'block'
        elif bot_prob > 0.6:
            verdict = 'challenge'
            
        return {
            'risk_score': bot_prob,
            'verdict': verdict,
            'model_version': '1.0'
        }

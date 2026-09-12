from flask import Flask, request, jsonify
from ..pipeline.inference import InferencePipeline
from ..features.extractor import FeatureExtractor
import os
import traceback

app = Flask(__name__)

# Load model lazily
_pipeline = None
_extractor = FeatureExtractor()

def get_pipeline():
    global _pipeline
    if _pipeline is None:
        model_path = os.environ.get('AEGIS_MODEL_PATH', 'model.onnx')
        if os.path.exists(model_path):
            _pipeline = InferencePipeline(model_path)
        else:
            print(f"Warning: Model not found at {model_path}. Running without ML.")
    return _pipeline

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({"status": "healthy"})

@app.route('/predict', methods=['POST'])
def predict():
    try:
        data = request.json
        if not data:
            return jsonify({"error": "No data provided"}), 400
            
        pipeline = get_pipeline()
        if not pipeline:
            # Fallback if model not loaded
            return jsonify({
                "risk_score": 0.0,
                "verdict": "allow",
                "fallback": True
            })
            
        # Extract features
        features = _extractor.extract(data)
        
        # Predict
        result = pipeline.predict(features)
        return jsonify(result)
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)

"""
FastAPI Inference Server for AEGIS BOT SHIELD

Exposes the ML Engine capabilities over HTTP.
- Real-time prediction endpoint
- Training trigger endpoint
- Health and metrics endpoints
"""
from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field
from typing import Dict, Any, List, Optional
import uvicorn
import os

from .inference.inference import InferenceEngine
from .training.training import TrainingPipeline
from .training.synthetic_generator import SyntheticDataGenerator

app = FastAPI(title="AEGIS ML Engine", version="1.0.0")

# Initialize engines
inference_engine = InferenceEngine(model_path=os.getenv('MODEL_PATH', './models/bot_classifier.pkl'))
training_pipeline = TrainingPipeline(output_dir=os.getenv('MODEL_OUTPUT_DIR', './models'))
is_training = False

class PredictRequest(BaseModel):
    client_id: str
    behavioral_data: Dict[str, Any] = Field(..., description="Raw behavioral event payload")
    explain: bool = Field(False, description="Also return the top SHAP feature contributions")

class PredictResponse(BaseModel):
    is_bot: bool
    confidence_score: float
    client_id: str
    explanation: Optional[List[Dict[str, Any]]] = None

class TrainRequest(BaseModel):
    use_synthetic: bool = True
    n_human: int = 1000
    n_bot: int = 1000

@app.post("/predict", response_model=PredictResponse)
async def predict(request: PredictRequest):
    """Predict whether a given behavioral payload is from a bot."""
    if not inference_engine.is_loaded:
        raise HTTPException(status_code=503, detail="Model is not loaded")
        
    score, is_bot = inference_engine.predict(request.client_id, request.behavioral_data)
    
    return PredictResponse(
        is_bot=is_bot,
        confidence_score=score,
        client_id=request.client_id,
        explanation=inference_engine.explain(request.behavioral_data) if request.explain else None,
    )

def _background_train(req: TrainRequest):
    global is_training
    is_training = True
    try:
        if req.use_synthetic:
            gen = SyntheticDataGenerator()
            data, labels = gen.generate(n_human=req.n_human, n_bot=req.n_bot)
        else:
            # Here you would load real data from DB
            data, labels = [], [] # Placeholder
            
        results = training_pipeline.train(data, labels)
        print("Training completed successfully")
        
        # Reload model for inference
        inference_engine._load_model()
    except Exception as e:
        print(f"Training failed: {e}")
    finally:
        is_training = False

@app.post("/train")
async def trigger_training(req: TrainRequest, background_tasks: BackgroundTasks):
    """Trigger model training in the background."""
    global is_training
    if is_training:
        return {"status": "Training already in progress"}
        
    background_tasks.add_task(_background_train, req)
    return {"status": "Training job accepted and started in background"}

@app.get("/health")
async def health_check():
    """Service health check."""
    return {
        "status": "healthy",
        "model_loaded": inference_engine.is_loaded,
        "is_training": is_training
    }

@app.get("/metrics")
async def get_metrics():
    """Get operational and inference metrics."""
    return inference_engine.get_metrics()

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)

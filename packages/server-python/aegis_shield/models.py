from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any

class AegisConfig(BaseModel):
    site_key: str
    secret_key: str
    protected_paths: Optional[List[str]] = None
    excluded_paths: List[str] = ['/health', '/favicon.ico']
    block_threshold: int = 80
    challenge_threshold: int = 50
    fail_open: bool = True
    logging_enabled: bool = True

class AegisResult(BaseModel):
    action: str = Field(..., description="allow, challenge, or block")
    score: float = Field(..., description="0-100 risk score")
    reason: str = Field(..., description="Reason for the decision")
    payload: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    is_bot: bool = False

class AnalysisResult(BaseModel):
    score: float
    reason: str

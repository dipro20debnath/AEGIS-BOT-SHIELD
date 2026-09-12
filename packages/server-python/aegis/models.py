from enum import Enum
from typing import Optional, Dict, Any
from pydantic import BaseModel, Field

class ProtectionMode(str, Enum):
    MONITOR = "monitor"
    ENFORCE = "enforce"

class AegisVerdict(str, Enum):
    ALLOW = "allow"
    BLOCK = "block"
    CHALLENGE = "challenge"

class VerificationResult(BaseModel):
    valid: bool
    verdict: AegisVerdict
    risk_score: float = 0.0
    reason: Optional[str] = None

class AegisRequest(BaseModel):
    ip: str
    headers: Dict[str, str]
    path: str
    method: str
    token: Optional[str] = None

class RiskScore(BaseModel):
    score: float = Field(ge=0.0, le=1.0)
    factors: Dict[str, float]

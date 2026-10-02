from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator


class AegisConfig(BaseModel):
    site_key: str
    secret_key: str
    mode: Literal["monitor", "enforce"] = "enforce"
    #: Paths analysed (prefixes); None = every path not excluded
    protected_paths: Optional[List[str]] = None
    excluded_paths: List[str] = ["/health", "/favicon.ico"]
    #: Paths (prefixes) where a request without a valid token is challenged
    require_token_paths: List[str] = []
    block_threshold: int = 80
    challenge_threshold: int = 50
    fail_open: bool = True
    logging_enabled: bool = True
    telemetry_path: str = "/aegis/telemetry"
    #: Lifetime of tokens issued for telemetry, seconds
    token_ttl: int = 300
    #: Trained BotClassifier pickle (packages/ml-engine) or URL of the ML service
    ml_model_path: Optional[str] = None
    ml_url: Optional[str] = None
    #: Proxies (IPs or CIDRs) whose X-Forwarded-For is trusted
    trusted_proxies: List[str] = []
    #: Confirm Googlebot/Bingbot claims with reverse DNS (blocking lookups)
    verify_search_engines: bool = False
    max_telemetry_bytes: int = 64 * 1024
    #: Check path and query string for XSS / SQLi / path traversal / CRLF payloads
    input_validation: bool = True

    @field_validator("secret_key")
    @classmethod
    def _secret_long_enough(cls, value: str) -> str:
        if len(value) < 16:
            raise ValueError("secret_key must be at least 16 characters")
        return value


class AegisResult(BaseModel):
    action: str = Field(..., description="allow, monitor, challenge, or block")
    score: float = Field(..., description="0-100 risk score")
    reason: str = Field(..., description="Reason for the decision")
    payload: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    is_bot: bool = False


class AnalysisResult(BaseModel):
    score: float
    reason: str


FeatureGroup = Dict[str, float]


class TelemetryFeatures(BaseModel):
    mouse: FeatureGroup = {}
    keyboard: FeatureGroup = {}
    scroll: FeatureGroup = {}
    touch: FeatureGroup = {}
    fingerprint: FeatureGroup = {}


class TelemetryPayload(BaseModel):
    """Body of POST /aegis/telemetry, built by packages/js-sdk/src/telemetry.ts."""
    v: int
    siteKey: str
    streamId: str = Field(..., max_length=64)
    timestamp: float
    features: TelemetryFeatures
    behavioral: Dict[str, Any] = {}
    headlessChecks: List[str] = Field(default_factory=list, max_length=32)

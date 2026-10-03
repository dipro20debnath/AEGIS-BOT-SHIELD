"""
AEGIS BOT SHIELD - Python Server SDK
"""

from .middleware import (
    AegisDjangoMiddleware,
    AegisFlaskMiddleware,
    AegisFastAPIMiddleware,
    AegisMiddlewareBase,
)
from .verifier import TokenVerifier, generate_token
from .detector import RequestAnalyzer, noisy_or
from .models import AegisResult, AegisConfig
from .config import get_config
from .ml import MLScorer, make_scorer
from .security import InputValidator, SecurityHeadersMiddleware, security_headers
from .antitamper import AntiTamper, sign_request, SIGNATURE_HEADER
from .store import MemoryStore, RedisStore, Store, create_redis_store

__all__ = [
    "AegisDjangoMiddleware",
    "AegisFlaskMiddleware",
    "AegisFastAPIMiddleware",
    "AegisMiddlewareBase",
    "TokenVerifier",
    "generate_token",
    "RequestAnalyzer",
    "noisy_or",
    "AegisResult",
    "AegisConfig",
    "get_config",
    "MLScorer",
    "make_scorer",
    "InputValidator",
    "SecurityHeadersMiddleware",
    "security_headers",
    "AntiTamper",
    "sign_request",
    "SIGNATURE_HEADER",
    "MemoryStore",
    "RedisStore",
    "Store",
    "create_redis_store",
]

__version__ = "1.0.0"

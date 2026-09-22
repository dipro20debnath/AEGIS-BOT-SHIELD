"""
AEGIS BOT SHIELD - Python Server SDK
"""

from .middleware import (
    AegisDjangoMiddleware,
    AegisFlaskMiddleware,
    AegisFastAPIMiddleware,
    AegisMiddlewareBase
)
from .verifier import TokenVerifier
from .detector import RequestAnalyzer
from .models import AegisResult, AegisConfig
from .config import get_config

__all__ = [
    "AegisDjangoMiddleware",
    "AegisFlaskMiddleware",
    "AegisFastAPIMiddleware",
    "AegisMiddlewareBase",
    "TokenVerifier",
    "RequestAnalyzer",
    "AegisResult",
    "AegisConfig",
    "get_config",
]

__version__ = "1.0.0"

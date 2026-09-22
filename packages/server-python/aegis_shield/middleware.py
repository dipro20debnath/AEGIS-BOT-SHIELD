"""
AEGIS BOT SHIELD — Python Middleware

Provides middleware for Django, Flask, and FastAPI frameworks.
Each middleware:
- Extracts the AEGIS token from X-Aegis-Token header
- Verifies token signature and decrypts behavioral payload
- Calculates risk score
- Makes verdict decision (allow/block/challenge)
- Attaches result to request context
- Supports fail-open error handling
"""
import time
import logging
from typing import Optional, List, Callable, Any

from .verifier import TokenVerifier
from .models import AegisResult, AegisConfig
from .detector import RequestAnalyzer

logger = logging.getLogger('aegis_shield')

class AegisMiddlewareBase:
    """Base middleware with shared logic."""
    def __init__(self, site_key: str, secret_key: str, **kwargs):
        self.config = AegisConfig(
            site_key=site_key,
            secret_key=secret_key,
            protected_paths=kwargs.get('protected_paths'),
            excluded_paths=kwargs.get('excluded_paths', ['/health', '/favicon.ico']),
            block_threshold=kwargs.get('block_threshold', 80),
            challenge_threshold=kwargs.get('challenge_threshold', 50),
            fail_open=kwargs.get('fail_open', True),
            logging_enabled=kwargs.get('logging_enabled', True),
        )
        self.verifier = TokenVerifier(secret_key)
        self.analyzer = RequestAnalyzer()

    def _should_protect(self, path: str) -> bool:
        if self.config.excluded_paths and any(path.startswith(p) for p in self.config.excluded_paths):
            return False
        if self.config.protected_paths:
            return any(path.startswith(p) for p in self.config.protected_paths)
        return True

    def _analyze_request(self, ip: str, headers: dict, method: str, path: str, token: Optional[str]) -> AegisResult:
        payload = None
        error = None
        if token:
            try:
                payload = self.verifier.verify(token)
            except Exception as e:
                error = str(e)
                if self.config.logging_enabled:
                    logger.error(f"AEGIS token verification failed: {e}")
        
        analysis = self.analyzer.analyze(ip, headers, method, path, payload)
        
        action = "allow"
        if analysis.score >= self.config.block_threshold:
            action = "block"
        elif analysis.score >= self.config.challenge_threshold:
            action = "challenge"
            
        if error and self.config.fail_open:
            action = "allow"
            
        return AegisResult(
            action=action,
            score=analysis.score,
            reason=analysis.reason,
            payload=payload,
            error=error,
            is_bot=action == "block"
        )


class AegisDjangoMiddleware(AegisMiddlewareBase):
    """Django middleware."""
    def __init__(self, get_response, **kwargs):
        self.get_response = get_response
        cfg = kwargs.get('config', {})
        site_key = cfg.get('site_key', '')
        secret_key = cfg.get('secret_key', '')
        super().__init__(site_key=site_key, secret_key=secret_key, **cfg)

    def __call__(self, request):
        path = request.path
        if not self._should_protect(path):
            return self.get_response(request)
            
        token = request.headers.get('X-Aegis-Token')
        ip = request.META.get('REMOTE_ADDR', '')
        headers = dict(request.headers)
        
        result = self._analyze_request(ip, headers, request.method, path, token)
        request.aegis = result
        
        if result.action == "block":
            from django.http import HttpResponseForbidden
            return HttpResponseForbidden("Blocked by AEGIS")
        elif result.action == "challenge":
            from django.http import HttpResponse
            return HttpResponse("Challenge required", status=403)
            
        return self.get_response(request)


class AegisFlaskMiddleware(AegisMiddlewareBase):
    """Flask middleware using before_request hook."""
    def __init__(self, app=None, **kwargs):
        super().__init__(**kwargs)
        if app:
            self.init_app(app)

    def init_app(self, app):
        app.before_request(self._before_request)
        app.after_request(self._after_request)

    def _before_request(self):
        from flask import request, g, abort
        if not self._should_protect(request.path):
            return
            
        token = request.headers.get('X-Aegis-Token')
        ip = request.remote_addr or ""
        headers = dict(request.headers)
        
        result = self._analyze_request(ip, headers, request.method, request.path, token)
        g.aegis = result
        
        if result.action == "block":
            abort(403, "Blocked by AEGIS")
        elif result.action == "challenge":
            abort(403, "Challenge required")

    def _after_request(self, response):
        return response


class AegisFastAPIMiddleware:
    """FastAPI/Starlette ASGI middleware."""
    def __init__(self, app, site_key: str, secret_key: str, **kwargs):
        self.app = app
        self.base = AegisMiddlewareBase(site_key, secret_key, **kwargs)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
            
        path = scope.get("path", "")
        if not self.base._should_protect(path):
            return await self.app(scope, receive, send)
            
        headers = {k.decode("latin1").lower(): v.decode("latin1") for k, v in scope.get("headers", [])}
        token = headers.get('x-aegis-token')
        client = scope.get("client")
        ip = client[0] if client else ""
        method = scope.get("method", "")
        
        result = self.base._analyze_request(ip, headers, method, path, token)
        scope["aegis"] = result
        
        if result.action == "block":
            from starlette.responses import PlainTextResponse
            response = PlainTextResponse("Blocked by AEGIS", status_code=403)
            return await response(scope, receive, send)
        elif result.action == "challenge":
            from starlette.responses import PlainTextResponse
            response = PlainTextResponse("Challenge required", status_code=403)
            return await response(scope, receive, send)
            
        await self.app(scope, receive, send)

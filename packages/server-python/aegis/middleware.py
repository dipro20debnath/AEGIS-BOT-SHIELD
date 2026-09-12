from typing import Optional, Callable
from .config import AegisConfig
from .verifier import TokenVerifier
from .models import AegisVerdict, ProtectionMode

class AegisMiddlewareBase:
    def __init__(self, config: AegisConfig):
        self.config = config
        self.verifier = TokenVerifier(config.secret_key)
        
    def _get_client_ip(self, request) -> str:
        raise NotImplementedError
        
    def _get_token(self, request) -> Optional[str]:
        raise NotImplementedError
        
    def _build_error_response(self, status: int, error: str, reason: str = None):
        raise NotImplementedError
        
    def process_request(self, request) -> Optional[Any]:
        try:
            token = self._get_token(request)
            
            if not token:
                if self.config.protection_mode == ProtectionMode.ENFORCE:
                    return self._build_error_response(403, "Missing Aegis token")
                return None
                
            client_ip = self._get_client_ip(request)
            result = self.verifier.verify(token, client_ip)
            
            # Attach to request for downstream handlers
            request.aegis = result
            
            if self.config.protection_mode == ProtectionMode.ENFORCE:
                if result.verdict == AegisVerdict.BLOCK:
                    return self._build_error_response(403, "Access denied by Aegis Bot Shield", result.reason)
                elif result.verdict == AegisVerdict.CHALLENGE:
                    return self._build_error_response(401, "Challenge required by Aegis Bot Shield")
                    
            return None
            
        except Exception as e:
            if self.config.fail_open:
                return None
            return self._build_error_response(500, "Aegis Bot Shield encountered an error")


try:
    from django.http import JsonResponse
    class AegisDjangoMiddleware(AegisMiddlewareBase):
        def __init__(self, get_response, config: AegisConfig):
            super().__init__(config)
            self.get_response = get_response
            
        def __call__(self, request):
            response = self.process_request(request)
            if response:
                return response
            return self.get_response(request)
            
        def _get_client_ip(self, request) -> str:
            x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
            if x_forwarded_for:
                ip = x_forwarded_for.split(',')[0]
            else:
                ip = request.META.get('REMOTE_ADDR')
            return ip or "unknown"
            
        def _get_token(self, request) -> Optional[str]:
            header_name = f"HTTP_{self.config.token_header_name.upper().replace('-', '_')}"
            token = request.META.get(header_name)
            if not token:
                token = request.COOKIES.get(self.config.token_cookie_name)
            return token
            
        def _build_error_response(self, status: int, error: str, reason: str = None):
            data = {"error": error}
            if reason:
                data["reason"] = reason
            return JsonResponse(data, status=status)
except ImportError:
    pass


try:
    from flask import request as flask_request, jsonify
    
    class AegisFlaskMiddleware:
        def __init__(self, app, config: AegisConfig):
            self.app = app
            self.config = config
            self.verifier = TokenVerifier(config.secret_key)
            self.app.before_request(self._before_request)
            
        def _before_request(self):
            try:
                token = flask_request.headers.get(self.config.token_header_name)
                if not token:
                    token = flask_request.cookies.get(self.config.token_cookie_name)
                    
                if not token:
                    if self.config.protection_mode == ProtectionMode.ENFORCE:
                        return jsonify({"error": "Missing Aegis token"}), 403
                    return None
                    
                client_ip = flask_request.headers.get('X-Forwarded-For', flask_request.remote_addr)
                if client_ip and ',' in client_ip:
                    client_ip = client_ip.split(',')[0]
                    
                result = self.verifier.verify(token, client_ip or "unknown")
                flask_request.aegis = result
                
                if self.config.protection_mode == ProtectionMode.ENFORCE:
                    if result.verdict == AegisVerdict.BLOCK:
                        return jsonify({"error": "Access denied", "reason": result.reason}), 403
                    elif result.verdict == AegisVerdict.CHALLENGE:
                        return jsonify({"error": "Challenge required"}), 401
                        
            except Exception as e:
                if not self.config.fail_open:
                    return jsonify({"error": "Aegis encountered an error"}), 500
                
except ImportError:
    pass

try:
    from fastapi import Request, Response
    from starlette.middleware.base import BaseHTTPMiddleware
    from starlette.responses import JSONResponse
    
    class AegisFastAPIMiddleware(BaseHTTPMiddleware):
        def __init__(self, app, config: AegisConfig):
            super().__init__(app)
            self.config = config
            self.verifier = TokenVerifier(config.secret_key)
            
        async def dispatch(self, request: Request, call_next):
            try:
                token = request.headers.get(self.config.token_header_name.lower())
                if not token:
                    token = request.cookies.get(self.config.token_cookie_name)
                    
                if not token:
                    if self.config.protection_mode == ProtectionMode.ENFORCE:
                        return JSONResponse(status_code=403, content={"error": "Missing Aegis token"})
                    return await call_next(request)
                    
                client_ip = request.client.host if request.client else "unknown"
                x_forwarded_for = request.headers.get("x-forwarded-for")
                if x_forwarded_for:
                    client_ip = x_forwarded_for.split(',')[0]
                    
                result = self.verifier.verify(token, client_ip)
                request.state.aegis = result
                
                if self.config.protection_mode == ProtectionMode.ENFORCE:
                    if result.verdict == AegisVerdict.BLOCK:
                        return JSONResponse(status_code=403, content={"error": "Access denied", "reason": result.reason})
                    elif result.verdict == AegisVerdict.CHALLENGE:
                        return JSONResponse(status_code=401, content={"error": "Challenge required"})
                        
                response = await call_next(request)
                return response
                
            except Exception as e:
                if self.config.fail_open:
                    return await call_next(request)
                return JSONResponse(status_code=500, content={"error": "Aegis encountered an error"})
except ImportError:
    pass

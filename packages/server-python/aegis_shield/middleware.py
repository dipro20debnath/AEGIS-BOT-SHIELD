"""
AEGIS BOT SHIELD — Python Middleware

Provides middleware for Django, Flask, and FastAPI/Starlette. Each adapter:
- answers the SDK's telemetry endpoint (POST /aegis/telemetry) itself,
  returning a signed token scored by rules and the ML model
- keeps a server-side session (HttpOnly `aegis_sid` cookie)
- on other requests verifies the X-Aegis-Token header, combines the token's
  telemetry score with request-level signals and decides
  allow / monitor / challenge / block
- fails open on internal errors when `fail_open` is set
"""
import json
import time
import logging
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Tuple, Union

from .detector import RequestAnalyzer, Signal, noisy_or
from .challenge import MemoryHardChallenger
from .feeds import FEED_SEVERITY, IPReputation
from .ml import MLScorer, make_scorer
from .security import InputValidator
from .session_patterns import session_signals
from .models import AegisConfig, AegisResult
from .sessions import SESSION_COOKIE, Session, SessionTracker
from .telemetry import TelemetryError, TelemetryService, decide, user_agent_hash
from .verifier import generate_token
from .utils import get_client_ip
from .verifier import TokenVerifier

logger = logging.getLogger("aegis_shield")

TOKEN_HEADER = "x-aegis-token"


@dataclass
class HandlerResponse:
    status: int
    body: Dict[str, Any]
    headers: Dict[str, str]


class AegisMiddlewareBase:
    """Framework-independent request handling shared by the adapters."""

    def __init__(self, site_key: str, secret_key: str, *, scorer: Optional[MLScorer] = None,
                 on_record: Optional[Callable[[Dict[str, Any]], None]] = None,
                 reputation: Optional[IPReputation] = None, **kwargs: Any):
        self.config = AegisConfig(site_key=site_key, secret_key=secret_key, **kwargs)
        self.verifier = TokenVerifier(secret_key, max_token_age=self.config.token_ttl)
        self.analyzer = RequestAnalyzer(self.config.verify_search_engines)
        self.sessions = SessionTracker()
        self.scorer = scorer or make_scorer(self.config.ml_model_path, self.config.ml_url)
        self.reputation: Optional[IPReputation] = reputation
        if self.reputation is None and self.config.live_feeds:
            self.reputation = IPReputation(self.config.feeds, cache_dir=self.config.feed_cache_dir,
                                           abuseipdb_key=self.config.abuseipdb_key)
            self.reputation.start()
        self.telemetry = TelemetryService(self.config, self.sessions, self.scorer, self.analyzer, on_record,
                                          self.reputation)
        self.input_validator = InputValidator() if self.config.input_validation else None
        self.challenger = MemoryHardChallenger(secret_key, self.config.pow_n, self.config.pow_r, self.config.pow_bits)

    # --- helpers -------------------------------------------------------------

    def _should_protect(self, path: str) -> bool:
        if any(path.startswith(p) for p in self.config.excluded_paths):
            return False
        if self.config.protected_paths:
            return any(path.startswith(p) for p in self.config.protected_paths)
        return True

    def client_ip(self, remote_addr: str, headers: Dict[str, str]) -> str:
        return get_client_ip(headers, remote_addr, self.config.trusted_proxies)

    def _session(self, cookies: Dict[str, str]) -> Tuple[Session, Dict[str, str]]:
        sid = cookies.get(SESSION_COOKIE)
        session = self.sessions.get_or_create(sid)
        if session.id == sid:
            return session, {}
        return session, {"Set-Cookie": f"{SESSION_COOKIE}={session.id}; Path=/; HttpOnly; SameSite=Lax"}

    def is_telemetry_request(self, method: str, path: str) -> bool:
        return method.upper() == "POST" and path == self.config.telemetry_path

    def is_aegis_endpoint(self, method: str, path: str) -> bool:
        """Requests the middleware answers itself: telemetry and the proof-of-work challenge."""
        return self.is_telemetry_request(method, path) or (
            path == self.config.challenge_path and method.upper() in ("GET", "POST"))

    def handle_endpoint(self, method: str, path: str, body: bytes, remote_addr: str, headers: Dict[str, str],
                        cookies: Dict[str, str]) -> HandlerResponse:
        if path == self.config.challenge_path:
            return self.handle_challenge(method, body, headers, cookies)
        return self.handle_telemetry(body, remote_addr, headers, cookies)

    # --- proof-of-work challenge ---------------------------------------------

    def handle_challenge(self, method: str, body: bytes, headers: Dict[str, str],
                         cookies: Dict[str, str]) -> HandlerResponse:
        """GET: issue a challenge. POST {challenge, nonce}: verify it and return a token."""
        session, cookie_headers = self._session(cookies)
        no_store = {**cookie_headers, "Cache-Control": "no-store"}
        if method.upper() == "GET":
            return HandlerResponse(200, self.challenger.issue(), no_store)
        try:
            data = json.loads(body or b"{}")
            ok, reason = self.challenger.verify(data.get("challenge"), data.get("nonce"))
        except (ValueError, AttributeError):
            ok, reason = False, "malformed"
        if not ok:
            return HandlerResponse(403, {"error": "challenge failed", "reason": reason}, no_store)
        ua = next((v for k, v in headers.items() if k.lower() == "user-agent"), "")
        # Carry the behavioural (telemetry) score so the work does not erase that evidence. Request
        # signals are not carried: every request recomputes them, and carrying them would count them twice.
        # "tel" marks that the session sent telemetry, which token-required paths need.
        token = generate_token({"sid": session.id, "score": session.telemetry_score or 0, "verdict": "allow", "pow": 1,
                                "tel": int(session.telemetry_score is not None),
                                "uah": user_agent_hash(ua), "exp": int(time.time()) + self.config.token_ttl},
                               self.config.secret_key)
        return HandlerResponse(200, {"token": token, "expiresIn": self.config.token_ttl, "verdict": "allow"}, no_store)

    # --- telemetry endpoint --------------------------------------------------

    def handle_telemetry(self, body: bytes, remote_addr: str, headers: Dict[str, str],
                         cookies: Dict[str, str]) -> HandlerResponse:
        ip = self.client_ip(remote_addr, headers)
        session, cookie_headers = self._session(cookies)
        self.sessions.record_request(session, self.config.telemetry_path, "POST")
        try:
            result, _ = self.telemetry.process(body, ip, headers, session)
            return HandlerResponse(200, result, {**cookie_headers, "Cache-Control": "no-store"})
        except TelemetryError as exc:
            return HandlerResponse(exc.status, {"error": str(exc)}, cookie_headers)
        except Exception as exc:  # never let scoring bugs take the endpoint down
            logger.exception("AEGIS telemetry processing failed")
            return HandlerResponse(500, {"error": "telemetry processing failed"}, cookie_headers)

    # --- protected requests --------------------------------------------------

    def evaluate(self, method: str, path: str, remote_addr: str, headers: Dict[str, str],
                 cookies: Dict[str, str], query: Union[str, bytes, None] = None) -> Tuple[AegisResult, Dict[str, str]]:
        """Decide on a request. Returns the result and headers to add to the response.

        `query` is the raw query string; it and the path are checked for injection
        payloads. Request bodies are not read here (that would consume the stream).
        """
        session, cookie_headers = self._session(cookies)
        try:
            self.sessions.record_request(session, path, method, headers)
            ip = self.client_ip(remote_addr, headers)
            h = {k.lower(): v for k, v in headers.items()}
            signals: List[Signal] = list(self.analyzer.signals(ip, h, method, path))
            if self.input_validator:
                signals.extend(self.input_validator.analyze(path, query, headers=h)[1])
            if self.config.session_patterns:
                signals += session_signals(session.requests)
            if self.reputation is not None:
                found = self.reputation.lookup(ip)
                if found["is_tor"]:
                    signals.append(("tor_exit", 70))
                signals += [(f"threat_list:{name}", FEED_SEVERITY[name]) for name in found["lists"]]

            claims = None
            token = h.get(TOKEN_HEADER)
            if token:
                claims = self.verifier.verify(token)
                if claims and claims.get("uah") != user_agent_hash(h.get("user-agent", "")):
                    claims = None
                    signals.append(("token_user_agent_mismatch", 60))
                elif claims and claims.get("pow"):
                    signals.append(("pow_solved", float(claims.get("score", 0))))
                elif claims:
                    signals.append(("telemetry_score", float(claims.get("score", 0))))
                else:
                    signals.append(("invalid_token", 40))

            requires_token = any(path.startswith(p) for p in self.config.require_token_paths)
            score = round(noisy_or(s for _, s in signals), 1)
            action = decide(score, self.config)
            reasons = [name for name, _ in signals]
            # A solved challenge answers "challenge"; it never lifts a block
            if action == "challenge" and claims and claims.get("pow"):
                action = "allow"
            # Proof of work alone does not replace the behavioural evidence a token-required path asks for
            has_telemetry = claims is not None and (not claims.get("pow") or bool(claims.get("tel")))
            if requires_token and not has_telemetry and action == "allow":
                action = "monitor" if self.config.mode == "monitor" else "challenge"
                reasons.append("token_required")

            self.sessions.record_risk(session, score)
            return AegisResult(action=action, score=score, reason=",".join(reasons), payload=claims,
                               is_bot=action == "block", session_id=session.id), cookie_headers
        except Exception as exc:
            logger.exception("AEGIS request analysis failed")
            action = "allow" if self.config.fail_open else "challenge"
            return AegisResult(action=action, score=0.0, reason="analysis_error", error=str(exc)), cookie_headers

    def record_response(self, result: Optional[AegisResult], status: int) -> None:
        """Report the response status of an evaluated request (feeds the 4xx-probing check)."""
        if result is not None and result.session_id:
            session = self.sessions.get(result.session_id)
            if session is not None:
                self.sessions.record_response(session, status)

    # Backwards-compatible entry point
    def _analyze_request(self, ip: str, headers: dict, method: str, path: str, token: Optional[str]) -> AegisResult:
        hdrs = dict(headers)
        if token:
            hdrs[TOKEN_HEADER] = token
        return self.evaluate(method, path, ip, hdrs, {})[0]

    def denial(self, result: AegisResult) -> HandlerResponse:
        """Response for a blocked or challenged request."""
        body: Dict[str, Any] = {"aegis": result.action}
        if result.action == "challenge":
            body["telemetry"] = self.config.telemetry_path
            body["challenge"] = self.config.challenge_path
        return HandlerResponse(403, body, {"X-Aegis-Action": result.action, "Cache-Control": "no-store"})


def _blocks(result: AegisResult) -> bool:
    return result.action in ("block", "challenge")


class AegisDjangoMiddleware(AegisMiddlewareBase):
    """Django middleware. Configure with settings.AEGIS = {"site_key": ..., "secret_key": ..., ...}."""

    def __init__(self, get_response, **kwargs):
        self.get_response = get_response
        if not kwargs:
            from django.conf import settings
            kwargs = dict(getattr(settings, "AEGIS", {}))
        super().__init__(**kwargs)

    def __call__(self, request):
        from django.http import JsonResponse

        path = request.path
        headers = dict(request.headers)
        remote = request.META.get("REMOTE_ADDR", "")

        if self.is_aegis_endpoint(request.method, path):
            r = self.handle_endpoint(request.method, path, request.body, remote, headers, request.COOKIES)
            return self._to_django(JsonResponse(r.body, status=r.status), r.headers)
        if not self._should_protect(path):
            return self.get_response(request)

        result, extra = self.evaluate(request.method, path, remote, headers, request.COOKIES,
                                      request.META.get("QUERY_STRING", ""))
        request.aegis = result
        if _blocks(result):
            r = self.denial(result)
            return self._to_django(JsonResponse(r.body, status=r.status), {**extra, **r.headers})
        response = self.get_response(request)
        self.record_response(result, response.status_code)
        return self._to_django(response, extra)

    @staticmethod
    def _to_django(response, headers: Dict[str, str]):
        for name, value in headers.items():
            if name == "Set-Cookie":
                sid = value.split(";", 1)[0].split("=", 1)[1]
                response.set_cookie(SESSION_COOKIE, sid, httponly=True, samesite="Lax")
            else:
                response[name] = value
        return response


class AegisFlaskMiddleware(AegisMiddlewareBase):
    """Flask extension using before_request/after_request hooks."""

    def __init__(self, app=None, **kwargs):
        super().__init__(**kwargs)
        if app is not None:
            self.init_app(app)

    def init_app(self, app):
        app.before_request(self._before_request)
        app.after_request(self._after_request)

    def _before_request(self):
        from flask import g, jsonify, request

        g.aegis_headers = {}
        headers = dict(request.headers)
        remote = request.remote_addr or ""
        if self.is_aegis_endpoint(request.method, request.path):
            r = self.handle_endpoint(request.method, request.path, request.get_data(), remote, headers,
                                     request.cookies)
            g.aegis_headers = r.headers
            return jsonify(r.body), r.status
        if not self._should_protect(request.path):
            return None

        result, extra = self.evaluate(request.method, request.path, remote, headers, request.cookies,
                                      request.query_string)
        g.aegis = result
        g.aegis_headers = extra
        if _blocks(result):
            r = self.denial(result)
            g.aegis_headers = {**extra, **r.headers}
            return jsonify(r.body), r.status
        return None

    def _after_request(self, response):
        from flask import g

        self.record_response(g.get("aegis"), response.status_code)

        for name, value in getattr(g, "aegis_headers", {}).items():
            if name == "Set-Cookie":
                response.headers.add("Set-Cookie", value)
            else:
                response.headers[name] = value
        return response


class AegisFastAPIMiddleware:
    """FastAPI/Starlette ASGI middleware: app.add_middleware(AegisFastAPIMiddleware, site_key=..., secret_key=...)."""

    def __init__(self, app, site_key: str, secret_key: str, **kwargs):
        self.app = app
        self.base = AegisMiddlewareBase(site_key, secret_key, **kwargs)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        from starlette.requests import Request
        from starlette.responses import JSONResponse

        request = Request(scope, receive)
        path = scope.get("path", "")
        method = scope.get("method", "")
        headers = {k.lower(): v for k, v in request.headers.items()}
        remote = scope["client"][0] if scope.get("client") else ""

        if self.base.is_aegis_endpoint(method, path):
            body = await request.body()
            r = self.base.handle_endpoint(method, path, body, remote, headers, request.cookies)
            return await JSONResponse(r.body, status_code=r.status, headers=r.headers)(scope, receive, send)
        if not self.base._should_protect(path):
            return await self.app(scope, receive, send)

        result, extra = self.base.evaluate(method, path, remote, headers, request.cookies,
                                           scope.get("query_string", b""))
        scope.setdefault("state", {})["aegis"] = result
        if _blocks(result):
            r = self.base.denial(result)
            return await JSONResponse(r.body, status_code=r.status, headers={**extra, **r.headers})(scope, receive, send)

        raw_extra = [(k.lower().encode("latin-1"), v.encode("latin-1")) for k, v in extra.items()]

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                self.base.record_response(result, message.get("status", 200))
                if raw_extra:
                    message = {**message, "headers": list(message.get("headers", [])) + raw_extra}
            await send(message)

        await self.app(scope, receive, send_with_headers)

"""
Input validation and security response headers; the Python counterparts of
packages/core/src/security/InputValidator.ts and SecurityHeaders.ts.

The input rules are the same patterns as the Node core. They flag typical
scanner/fuzzer payloads; they are not a WAF and do not replace output
encoding or parameterised queries.
"""
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qsl, unquote

RULES: List[Tuple[str, str, "re.Pattern[str]"]] = [
    ("xss", "script_tag", re.compile(r"<\s*script\b", re.I)),
    ("xss", "javascript_uri", re.compile(r"\bjavascript\s*:", re.I)),
    ("xss", "event_handler", re.compile(r"<[^>]*\bon[a-z]+\s*=", re.I)),
    ("xss", "dangerous_tag", re.compile(r"<\s*(iframe|object|embed|svg|math|base)\b", re.I)),
    ("xss", "srcdoc_or_data_html", re.compile(r"\bsrcdoc\s*=|data\s*:\s*text/html", re.I)),
    ("sqli", "tautology", re.compile(r"['\"`]\s*(or|and)\s+['\"`]?\w+['\"`]?\s*(=|like)\s*['\"`]?\w+", re.I)),
    ("sqli", "union_select", re.compile(r"\bunion\b[\s\S]{0,40}\bselect\b", re.I)),
    ("sqli", "stacked_query", re.compile(r";\s*(drop|delete|insert|update|alter|create|truncate|exec)\s", re.I)),
    ("sqli", "comment_after_quote", re.compile(r"['\"`]\s*(--|#|/\*)")),
    ("sqli", "time_based", re.compile(r"\b(sleep|benchmark|pg_sleep|waitfor\s+delay)\s*\(", re.I)),
    ("sqli", "schema_probe", re.compile(r"\binformation_schema\b|\bxp_cmdshell\b", re.I)),
    ("path_traversal", "dot_dot_slash", re.compile(r"(^|[\\/])\.\.([\\/]|$)")),
    ("path_traversal", "sensitive_file", re.compile(r"/etc/passwd|\\windows\\win\.ini|/proc/self/", re.I)),
]
CRLF = re.compile(r"[\r\n]")
POLLUTION_KEYS = {"__proto__", "constructor", "prototype"}
SIGNAL_VALUES = {"xss": 85, "sqli": 85, "crlf": 70, "prototype_pollution": 90, "path_traversal": 75}
DEFAULT_SKIP_FIELDS = re.compile(r"pass(word)?|pwd|secret|token|api[_-]?key|otp|cvv|card", re.I)
_BRACKET_KEY = re.compile(r"\[([^\]]*)\]")
_ESCAPE = re.compile(r"%[0-9a-f]{2}", re.I)


@dataclass(frozen=True)
class InputFinding:
    threat: str
    location: str
    rule: str


def _decode(value: str) -> str:
    """Decode %xx escapes up to twice (double encoding); stops at invalid UTF-8."""
    current = value
    for _ in range(2):
        if not _ESCAPE.search(current):
            break
        try:
            current = unquote(current, errors="strict")
        except UnicodeDecodeError:
            break
    return current


class InputValidator:
    def __init__(self, skip_fields: "re.Pattern[str]" = DEFAULT_SKIP_FIELDS, max_depth: int = 8, max_values: int = 500):
        self.skip_fields = skip_fields
        self.max_depth = max_depth
        self.max_values = max_values

    def inspect_string(self, value: str, location: str, is_header: bool = False) -> List[InputFinding]:
        findings: List[InputFinding] = []
        decoded = _decode(value)
        for candidate in ([value] if decoded == value else [value, decoded]):
            for threat, rule, pattern in RULES:
                if pattern.search(candidate) and not any(f.rule == rule for f in findings):
                    findings.append(InputFinding(threat, location, rule))
        if is_header and (CRLF.search(value) or CRLF.search(decoded)):
            findings.append(InputFinding("crlf", location, "crlf_in_header"))
        return findings

    def inspect(self, value: Any, location: str) -> List[InputFinding]:
        findings: List[InputFinding] = []
        visited = 0

        def walk(v: Any, path: str, depth: int) -> None:
            nonlocal visited
            if visited >= self.max_values or depth > self.max_depth:
                return
            visited += 1
            if isinstance(v, str):
                findings.extend(self.inspect_string(v, path))
            elif isinstance(v, (list, tuple)):
                for i, item in enumerate(v):
                    walk(item, f"{path}[{i}]", depth + 1)
            elif isinstance(v, dict):
                for key, item in v.items():
                    key = str(key)
                    key_path = f"{path}.{key}"
                    if key in POLLUTION_KEYS or any(k in POLLUTION_KEYS for k in _BRACKET_KEY.findall(key)):
                        findings.append(InputFinding("prototype_pollution", key_path, "pollution_key"))
                    if self.skip_fields.search(key):
                        continue
                    walk(item, key_path, depth + 1)

        walk(value, location, 0)
        return findings

    def analyze(self, path: str, query: Optional[Any] = None, body: Any = None,
                headers: Optional[Dict[str, str]] = None) -> Tuple[List[InputFinding], List[Tuple[str, float]]]:
        """Inspect a request; `query` may be a raw query string or a dict. Returns findings and (name, score) signals."""
        if isinstance(query, (bytes, str)):
            raw = query.decode("latin-1") if isinstance(query, bytes) else query
            query = _query_dict(raw)
        findings = self.inspect_string(path, "path")
        if query:
            findings += self.inspect(query, "query")
        if body is not None:
            findings += self.inspect(body, "body")
        for name, value in (headers or {}).items():
            if isinstance(value, str) and CRLF.search(value):
                findings.append(InputFinding("crlf", f"headers.{name}", "crlf_in_header"))

        by_threat: Dict[str, List[InputFinding]] = {}
        for f in findings:
            by_threat.setdefault(f.threat, []).append(f)
        # Same value x confidence as the Node signal (confidence grows with independent matches)
        signals = [(f"input:{threat}", SIGNAL_VALUES[threat] * min(0.95, 0.6 + 0.1 * len(items)))
                   for threat, items in by_threat.items()]
        return findings, signals


def _query_dict(raw: str) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    # parse_qsl decodes one level; inspect_string decodes double-encoded payloads
    for key, value in parse_qsl(raw, keep_blank_values=True):
        out.setdefault(key, []).append(value)
    return {k: v[0] if len(v) == 1 else v for k, v in out.items()}


DEFAULT_CSP = "; ".join([
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
])


def security_headers(content_security_policy: Optional[str] = DEFAULT_CSP, hsts: bool = True,
                     hsts_max_age: int = 31_536_000, hsts_include_subdomains: bool = True,
                     frame_options: Optional[str] = "DENY",
                     referrer_policy: str = "strict-origin-when-cross-origin",
                     permissions_policy: Optional[str] = "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
                     cross_origin_opener_policy: Optional[str] = "same-origin") -> Dict[str, str]:
    """OWASP-recommended response headers; pass None to omit one (same defaults as the Node core)."""
    headers = {"X-Content-Type-Options": "nosniff", "Referrer-Policy": referrer_policy}
    if content_security_policy:
        headers["Content-Security-Policy"] = content_security_policy
    if hsts:
        headers["Strict-Transport-Security"] = f"max-age={hsts_max_age}" + ("; includeSubDomains" if hsts_include_subdomains else "")
    if frame_options:
        headers["X-Frame-Options"] = frame_options
    if permissions_policy:
        headers["Permissions-Policy"] = permissions_policy
    if cross_origin_opener_policy:
        headers["Cross-Origin-Opener-Policy"] = cross_origin_opener_policy
    return headers


class SecurityHeadersMiddleware:
    """ASGI middleware (FastAPI/Starlette): app.add_middleware(SecurityHeadersMiddleware, hsts=False)."""

    def __init__(self, app, **options):
        self.app = app
        self.headers: List[Tuple[bytes, bytes]] = [
            (k.lower().encode("latin-1"), v.encode("latin-1")) for k, v in security_headers(**options).items()
        ]

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                existing = {k.lower() for k, _ in message.get("headers", [])}
                extra = [(k, v) for k, v in self.headers if k not in existing]
                message = {**message, "headers": list(message.get("headers", [])) + extra}
            await send(message)

        await self.app(scope, receive, send_with_headers)

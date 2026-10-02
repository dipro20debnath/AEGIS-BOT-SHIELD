"""
Request signing and replay protection; byte-compatible with the Node core
(packages/core/src/security/AntiTamper.ts).

Header  X-Aegis-Signature: t=<unix seconds>,n=<hex nonce>,s=<base64url HMAC-SHA256>
Signed  METHOD \\n path-with-query \\n t \\n n \\n hex(SHA-256(body))
"""
import base64
import hashlib
import hmac
import re
import secrets
import threading
import time
from typing import Dict, Optional, Tuple, Union

SIGNATURE_HEADER = "x-aegis-signature"
_NONCE = re.compile(r"^[0-9a-fA-F]{8,64}$")
Body = Union[bytes, str, None]


def _body_bytes(body: Body) -> bytes:
    if body is None:
        return b""
    return body.encode("utf-8") if isinstance(body, str) else body


def canonical_string(method: str, path: str, body: Body, timestamp: int, nonce: str) -> str:
    body_hash = hashlib.sha256(_body_bytes(body)).hexdigest()
    return "\n".join([method.upper(), path, str(timestamp), nonce, body_hash])


def _hmac(data: str, secret: str) -> str:
    digest = hmac.new(secret.encode("utf-8"), data.encode("utf-8"), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def sign_request(method: str, path: str, body: Body, secret: str, now: Optional[float] = None) -> str:
    t = int(time.time() if now is None else now)
    n = secrets.token_hex(12)
    return f"t={t},n={n},s={_hmac(canonical_string(method, path, body, t, n), secret)}"


def parse_signature_header(header: str) -> Optional[Tuple[int, str, str]]:
    parts: Dict[str, str] = {}
    for item in header.split(","):
        key, sep, value = item.partition("=")
        if sep:
            parts[key.strip()] = value.strip()
    try:
        t = int(parts.get("t", ""))
    except ValueError:
        return None
    n, s = parts.get("n", ""), parts.get("s", "")
    if not _NONCE.match(n) or not s:
        return None
    return t, n, s


class AntiTamper:
    """Verifies signed requests; nonces are remembered for twice the allowed clock skew."""

    def __init__(self, secret: str, max_skew_seconds: int = 300, max_nonces: int = 100_000):
        if not secret:
            raise ValueError("AntiTamper requires a secret")
        self.secret = secret
        self.max_skew = max_skew_seconds
        self.max_nonces = max_nonces
        self._nonces: Dict[str, float] = {}
        self._lock = threading.Lock()

    def sign(self, method: str, path: str, body: Body = None, now: Optional[float] = None) -> str:
        return sign_request(method, path, body, self.secret, now)

    def verify(self, method: str, path: str, body: Body, header: Optional[str],
               now: Optional[float] = None) -> Tuple[bool, Optional[str]]:
        """Returns (True, None) or (False, reason): missing, malformed, expired, bad_signature, replay."""
        if not header:
            return False, "missing"
        parsed = parse_signature_header(header)
        if not parsed:
            return False, "malformed"
        t, n, s = parsed
        current = time.time() if now is None else now
        if abs(int(current) - t) > self.max_skew:
            return False, "expired"
        if not hmac.compare_digest(_hmac(canonical_string(method, path, body, t, n), self.secret), s):
            return False, "bad_signature"
        # Checked last so unsigned requests cannot burn nonces
        with self._lock:
            self._evict(current)
            if n in self._nonces:
                return False, "replay"
            self._nonces[n] = current
        return True, None

    def _evict(self, now: float) -> None:
        horizon = now - 2 * self.max_skew
        if len(self._nonces) > self.max_nonces or (self._nonces and next(iter(self._nonces.values())) < horizon):
            self._nonces = {k: v for k, v in self._nonces.items() if v >= horizon}

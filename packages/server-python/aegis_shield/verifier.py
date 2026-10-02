"""
AEGIS BOT SHIELD — Tokens

Issues and verifies AEGIS tokens. The format is shared with the Node core
(packages/core/src/utils/crypto.ts generateToken/verifyToken):

    AEGIS.v1.{base64url(json(EncryptedPayload))}.{base64url(HMAC-SHA256)}

EncryptedPayload is {iv, ciphertext, tag} from AES-256-GCM over the JSON
claims; the key is the secret itself if it is exactly 32 bytes, otherwise
SHA-256(secret). Claims carry `iat` (seconds) and a random `nonce`.

Tokens are issued by the server after it scores browser telemetry and are
then sent with every request until they expire, so by default a nonce may be
seen many times. `single_use=True` is for one-shot tokens such as challenge
solutions.
"""
import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Any, Dict, Optional

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def _derive_key(secret_key: str) -> bytes:
    key_bytes = secret_key.encode("utf-8")
    return key_bytes if len(key_bytes) == 32 else hashlib.sha256(key_bytes).digest()


def _sign(data: str, secret_key: str) -> str:
    return _b64url(hmac.new(secret_key.encode("utf-8"), data.encode("utf-8"), hashlib.sha256).digest())


def generate_token(claims: Dict[str, Any], secret_key: str) -> str:
    """Encrypt and sign `claims` (adds iat and nonce)."""
    body = json.dumps({**claims, "iat": int(time.time()), "nonce": secrets.token_hex(16)},
                      separators=(",", ":"))
    iv = secrets.token_bytes(12)
    sealed = AESGCM(_derive_key(secret_key)).encrypt(iv, body.encode("utf-8"), None)
    ciphertext, tag = sealed[:-16], sealed[-16:]
    encoded = _b64url(json.dumps({
        "ciphertext": _b64url(ciphertext), "iv": _b64url(iv), "tag": _b64url(tag),
    }, separators=(",", ":")).encode("utf-8"))
    return f"AEGIS.v1.{encoded}.{_sign(encoded, secret_key)}"


class TokenVerifier:
    """Verifies AEGIS tokens issued by this server (or the Node core)."""

    def __init__(self, secret_key: str, max_token_age: int = 300, single_use: bool = False):
        if not secret_key:
            raise ValueError("TokenVerifier requires a secret key")
        self.secret_key = secret_key
        self.max_token_age = max_token_age
        self.single_use = single_use
        self._used_nonces: Dict[str, float] = {}
        self._last_cleanup = time.time()

    def verify(self, token: str) -> Optional[Dict[str, Any]]:
        """Return the claims if the token is authentic, unexpired (and unused), else None."""
        try:
            parts = token.split(".")
            if len(parts) != 4 or parts[0] != "AEGIS" or parts[1] != "v1":
                return None
            encoded, signature = parts[2], parts[3]

            if not hmac.compare_digest(_sign(encoded, self.secret_key), signature):
                return None

            sealed = json.loads(_b64url_decode(encoded))
            plaintext = AESGCM(_derive_key(self.secret_key)).decrypt(
                _b64url_decode(sealed["iv"]),
                _b64url_decode(sealed["ciphertext"]) + _b64url_decode(sealed["tag"]),
                None,
            )
            claims = json.loads(plaintext)

            now = int(time.time())
            if now - int(claims.get("iat", 0)) > self.max_token_age:
                return None
            if "exp" in claims and now > int(claims["exp"]):
                return None

            if self.single_use:
                nonce = claims.get("nonce", "")
                if not nonce or nonce in self._used_nonces:
                    return None
                self._used_nonces[nonce] = time.time()
                self._maybe_cleanup_nonces()

            return claims
        except Exception:
            return None

    def _maybe_cleanup_nonces(self) -> None:
        now = time.time()
        if now - self._last_cleanup < 60:
            return
        self._last_cleanup = now
        cutoff = now - self.max_token_age * 2
        self._used_nonces = {k: v for k, v in self._used_nonces.items() if v > cutoff}

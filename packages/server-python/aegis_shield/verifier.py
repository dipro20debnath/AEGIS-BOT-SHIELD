"""
AEGIS BOT SHIELD — Token Verifier

Verifies AEGIS tokens sent from the client JS SDK.
Uses HMAC-SHA256 for signature verification and AES-256-GCM for decryption.
"""
import hmac
import hashlib
import json
import time
import base64
import os
from typing import Optional, Dict, Any


class TokenVerifier:
    """Verifies AEGIS tokens from the client-side JS SDK."""

    def __init__(self, secret_key: str, max_token_age: int = 120):
        self.secret_key = secret_key
        self.max_token_age = max_token_age
        self._used_nonces: Dict[str, float] = {}
        self._nonce_cleanup_interval = 60
        self._last_cleanup = time.time()

    def verify(self, token: str) -> Optional[Dict[str, Any]]:
        """
        Verify and decode an AEGIS token.

        Token format: AEGIS.v1.{base64url_payload}.{hmac_signature}

        Returns decoded payload dict or None if invalid.
        """
        try:
            parts = token.split(".")
            if len(parts) != 4 or parts[0] != "AEGIS" or parts[1] != "v1":
                return None

            encoded_payload = parts[2]
            signature = parts[3]

            # 1. Verify HMAC-SHA256 signature (timing-safe)
            if not self._hmac_verify(encoded_payload, signature):
                return None

            # 2. Decrypt payload
            payload_json = self._base64url_decode(encoded_payload)
            encrypted_payload = json.loads(payload_json)
            decrypted_json = self._decrypt(encrypted_payload)
            payload = json.loads(decrypted_json)

            # 3. Check token age
            iat = payload.get("iat", 0)
            now = int(time.time())
            if now - iat > self.max_token_age:
                return None

            # 4. Check nonce replay
            nonce = payload.get("nonce", "")
            if nonce and self._is_nonce_used(nonce):
                return None

            # 5. Periodic nonce cleanup
            self._maybe_cleanup_nonces()

            return payload

        except Exception:
            return None

    def _hmac_verify(self, data: str, signature: str) -> bool:
        """Timing-safe HMAC-SHA256 signature verification."""
        expected = hmac.new(
            self.secret_key.encode("utf-8"),
            data.encode("utf-8"),
            hashlib.sha256,
        ).digest()
        expected_b64 = base64.urlsafe_b64encode(expected).rstrip(b"=").decode("utf-8")
        return hmac.compare_digest(expected_b64, signature)

    def _decrypt(self, encrypted_payload: Dict[str, str]) -> str:
        """Decrypt AES-256-GCM encrypted payload."""
        try:
            from cryptography.hazmat.primitives.ciphers.aead import AESGCM

            key = self._derive_key(self.secret_key)
            iv = self._base64url_decode_bytes(encrypted_payload["iv"])
            ciphertext = self._base64url_decode_bytes(encrypted_payload["ciphertext"])
            tag = self._base64url_decode_bytes(encrypted_payload["tag"])

            aesgcm = AESGCM(key)
            plaintext = aesgcm.decrypt(iv, ciphertext + tag, None)
            return plaintext.decode("utf-8")
        except ImportError:
            # Fallback: base64 decode without decryption (dev mode)
            return self._base64url_decode(encrypted_payload.get("ciphertext", ""))

    def _derive_key(self, key_string: str) -> bytes:
        """Derive 32-byte key from string using SHA-256."""
        key_bytes = key_string.encode("utf-8")
        if len(key_bytes) == 32:
            return key_bytes
        return hashlib.sha256(key_bytes).digest()

    def _is_nonce_used(self, nonce: str) -> bool:
        """Check if nonce has been used (replay detection)."""
        if nonce in self._used_nonces:
            return True
        self._used_nonces[nonce] = time.time()
        return False

    def _maybe_cleanup_nonces(self) -> None:
        """Remove expired nonces periodically."""
        now = time.time()
        if now - self._last_cleanup < self._nonce_cleanup_interval:
            return
        self._last_cleanup = now
        cutoff = now - self.max_token_age * 2
        self._used_nonces = {
            k: v for k, v in self._used_nonces.items() if v > cutoff
        }

    @staticmethod
    def _base64url_decode(data: str) -> str:
        """Decode base64url string to UTF-8."""
        padded = data + "=" * (4 - len(data) % 4)
        return base64.urlsafe_b64decode(padded).decode("utf-8")

    @staticmethod
    def _base64url_decode_bytes(data: str) -> bytes:
        """Decode base64url string to bytes."""
        padded = data + "=" * (4 - len(data) % 4)
        return base64.urlsafe_b64decode(padded)

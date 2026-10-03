"""
Memory-hard proof-of-work challenge; same format as the Node core
(packages/core/src/security/MemoryHardChallenge.ts) and the browser solver
(packages/js-sdk/src/challenges/MemoryHardChallenge.ts).

challenge = "AEGIS.pow1." + b64url(JSON {id, seed, n, r, bits, exp}) + "." + b64url(HMAC-SHA256)
solution  = nonce with scrypt(challenge + ":" + nonce, seed, n, r, p=1, 32) having >= bits leading zero bits

A challenge is verified at most once: its id is burnt before the scrypt
check, so guessing or replaying costs the server one scrypt per issued
challenge (~10 ms at n=4096, r=8).
"""
import base64
import hashlib
import hmac
import json
import secrets
import threading
import time
from typing import Dict, Optional, Tuple

POW_PREFIX = "AEGIS.pow1."


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def leading_zero_bits(data: bytes) -> int:
    bits = 0
    for byte in data:
        if byte == 0:
            bits += 8
            continue
        return bits + 8 - byte.bit_length()
    return bits


class MemoryHardChallenger:
    def __init__(self, secret: str, n: int = 4096, r: int = 8, bits: int = 4, ttl_seconds: int = 120):
        if not secret:
            raise ValueError("MemoryHardChallenger requires a secret")
        if n < 2 or n & (n - 1) or n > 1 << 16:
            raise ValueError("n must be a power of two <= 65536")
        if not 1 <= r <= 32 or not 0 <= bits <= 20:
            raise ValueError("r or bits out of range")
        self.secret = secret.encode("utf-8")
        self.n, self.r, self.bits, self.ttl = n, r, bits, ttl_seconds
        self._used: Dict[str, float] = {}
        self._lock = threading.Lock()

    def _sign(self, data: str) -> str:
        return _b64(hmac.new(self.secret, data.encode("utf-8"), hashlib.sha256).digest())

    def issue(self, now: Optional[float] = None) -> Dict:
        now = time.time() if now is None else now
        claims = {"id": secrets.token_hex(12), "seed": secrets.token_hex(16),
                  "n": self.n, "r": self.r, "bits": self.bits, "exp": int(now) + self.ttl}
        body = _b64(json.dumps(claims, separators=(",", ":")).encode("utf-8"))
        challenge = f"{POW_PREFIX}{body}.{self._sign(POW_PREFIX + body)}"
        return {"challenge": challenge, "seed": claims["seed"], "n": self.n, "r": self.r,
                "bits": self.bits, "expiresAt": claims["exp"]}

    def verify(self, challenge, nonce, now: Optional[float] = None) -> Tuple[bool, Optional[str]]:
        """(True, None) or (False, reason): malformed, bad_signature, expired, replay, insufficient_work."""
        if not isinstance(challenge, str) or not challenge.startswith(POW_PREFIX):
            return False, "malformed"
        if isinstance(nonce, bool) or not isinstance(nonce, int) or not 0 <= nonce <= 2 ** 31:
            return False, "malformed"
        body, _, sig = challenge[len(POW_PREFIX):].partition(".")
        if not body or not sig:
            return False, "malformed"
        if not hmac.compare_digest(self._sign(POW_PREFIX + body), sig):
            return False, "bad_signature"
        try:
            claims = json.loads(_unb64(body))
        except ValueError:
            return False, "malformed"
        now = time.time() if now is None else now
        if int(now) > claims["exp"]:
            return False, "expired"
        with self._lock:
            if claims["id"] in self._used:
                return False, "replay"
            self._used = {k: v for k, v in self._used.items() if v >= now} if len(self._used) > 10_000 else self._used
            self._used[claims["id"]] = claims["exp"]
        n, r = claims["n"], claims["r"]
        digest = hashlib.scrypt(f"{challenge}:{nonce}".encode("utf-8"), salt=claims["seed"].encode("utf-8"),
                                n=n, r=r, p=1, dklen=32, maxmem=256 * n * r + 1024 * 1024)
        if leading_zero_bits(digest) < claims["bits"]:
            return False, "insufficient_work"
        return True, None

import hmac
import hashlib
import json
import base64
import time
from typing import Dict, Any, Tuple
from .models import VerificationResult, AegisVerdict

class TokenVerifier:
    def __init__(self, secret_key: str):
        self.secret_key = secret_key.encode('utf-8')

    def _decode_base64url(self, data: str) -> bytes:
        padding = '=' * (4 - (len(data) % 4))
        return base64.urlsafe_b64decode(data + padding)

    def verify(self, token: str, client_ip: str) -> VerificationResult:
        try:
            parts = token.split('.')
            if len(parts) != 3:
                return VerificationResult(valid=False, verdict=AegisVerdict.BLOCK, reason="Invalid token format")
            
            header_b64, payload_b64, signature_b64 = parts
            
            # Verify signature
            message = f"{header_b64}.{payload_b64}".encode('utf-8')
            expected_signature = hmac.new(self.secret_key, message, hashlib.sha256).digest()
            expected_signature_b64 = base64.urlsafe_b64encode(expected_signature).decode('utf-8').rstrip('=')
            
            if signature_b64 != expected_signature_b64:
                return VerificationResult(valid=False, verdict=AegisVerdict.BLOCK, reason="Invalid signature")

            payload = json.loads(self._decode_base64url(payload_b64).decode('utf-8'))
            
            # Expiry check
            if 'exp' in payload and payload['exp'] < int(time.time()):
                return VerificationResult(valid=False, verdict=AegisVerdict.BLOCK, reason="Token expired")
                
            # IP check
            if 'ip' in payload and payload['ip'] != client_ip:
                return VerificationResult(valid=True, verdict=AegisVerdict.CHALLENGE, reason="IP mismatch")
                
            # Get verdict from token if ML Engine provided one
            verdict_str = payload.get('verdict', 'allow')
            try:
                verdict = AegisVerdict(verdict_str)
            except ValueError:
                verdict = AegisVerdict.ALLOW
                
            risk_score = payload.get('risk', 0.0)
            
            return VerificationResult(valid=True, verdict=verdict, risk_score=risk_score)
            
        except Exception as e:
            return VerificationResult(valid=False, verdict=AegisVerdict.BLOCK, reason="Token parsing error")

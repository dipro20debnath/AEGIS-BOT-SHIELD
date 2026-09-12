import hashlib
import os
import base64

def generate_secret_key(length: int = 32) -> str:
    """Generate a secure random secret key"""
    return base64.urlsafe_b64encode(os.urandom(length)).decode('utf-8').rstrip('=')

def hash_ip(ip: str, salt: str) -> str:
    """Anonymize IP address for analytics"""
    return hashlib.sha256(f"{ip}{salt}".encode('utf-8')).hexdigest()

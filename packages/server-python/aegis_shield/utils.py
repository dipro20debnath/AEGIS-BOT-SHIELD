import ipaddress
from typing import Optional

def get_client_ip(headers: dict, remote_addr: str) -> str:
    """Extract client IP handling proxies."""
    forwarded = headers.get('x-forwarded-for')
    if forwarded:
        return forwarded.split(',')[0].strip()
    return remote_addr

def is_private_ip(ip: str) -> bool:
    try:
        ip_obj = ipaddress.ip_address(ip)
        return ip_obj.is_private
    except ValueError:
        return False

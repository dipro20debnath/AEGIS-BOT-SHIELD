import ipaddress
from typing import Dict, Iterable


def _in_any(ip: str, networks: Iterable[str]) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    for net in networks:
        try:
            if addr in ipaddress.ip_network(net, strict=False):
                return True
        except ValueError:
            continue
    return False


def get_client_ip(headers: Dict[str, str], remote_addr: str, trusted_proxies: Iterable[str] = ()) -> str:
    """
    Client IP, honouring X-Forwarded-For only when the direct peer is a trusted
    proxy (otherwise any client could spoof its IP). Walks the chain from the
    right and returns the first address that is not a trusted proxy.
    """
    trusted = list(trusted_proxies)
    if not trusted or not _in_any(remote_addr, trusted):
        return remote_addr
    forwarded = next((v for k, v in headers.items() if k.lower() == "x-forwarded-for"), "")
    hops = [h.strip() for h in forwarded.split(",") if h.strip()]
    for hop in reversed(hops):
        if not _in_any(hop, trusted):
            return hop
    return hops[0] if hops else remote_addr


def is_private_ip(ip: str) -> bool:
    try:
        return ipaddress.ip_address(ip).is_private
    except ValueError:
        return False

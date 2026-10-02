"""
Offline IP classification for the network features of the ML contract.

The datacenter CIDRs mirror packages/core/src/modules/ip-intelligence/
IPAnalyzer.ts (keep them in sync); they are a small static sample. Tor exit
nodes and threat-list membership come from the live lists in feeds.py
(IPReputation); without one, no IP is classified as Tor.
"""
import ipaddress
from functools import lru_cache
from typing import Dict, Optional

from .feeds import IPReputation

DATACENTER_RANGES = {
    "AWS": ["3.0.0.0/8", "13.0.0.0/8", "18.0.0.0/8", "35.0.0.0/8", "52.0.0.0/8", "54.0.0.0/8"],
    "GCP": ["34.0.0.0/8", "35.64.0.0/10"],
    "Azure": ["13.64.0.0/10", "20.0.0.0/8", "40.64.0.0/10"],
    "DigitalOcean": ["104.131.0.0/16", "138.68.0.0/16", "159.65.0.0/16", "167.172.0.0/16"],
    "Hetzner": ["88.198.0.0/16", "136.243.0.0/16", "144.76.0.0/16", "148.251.0.0/16"],
    "OVH": ["51.38.0.0/16", "51.68.0.0/16", "51.75.0.0/16", "51.77.0.0/16"],
    "Vultr": ["45.32.0.0/16", "45.63.0.0/16", "64.176.0.0/16", "108.61.0.0/16"],
    "Linode": ["45.33.0.0/16", "45.56.0.0/16", "50.116.0.0/16", "66.175.0.0/16"],
}
_DATACENTER_NETS = [(name, ipaddress.ip_network(c)) for name, cidrs in DATACENTER_RANGES.items() for c in cidrs]

def normalize_ip(ip: str) -> str:
    if ip.startswith("::ffff:") and "." in ip:
        return ip[7:]
    return ip


def classify_ip(ip: str, reputation: Optional[IPReputation] = None) -> Dict[str, float]:
    """Network features (contracts/features.json, category 'network') for an IP."""
    features = dict(_static_features(normalize_ip(ip)))
    if reputation is not None and features["_public"]:
        found = reputation.lookup(normalize_ip(ip))
        features["is_tor"] = 1.0 if found["is_tor"] else 0.0
        features["ip_reputation"] = max(features["ip_reputation"], 0.85 * features["is_tor"], found["risk"] / 100)
    features.pop("_public")
    return features


@lru_cache(maxsize=65536)
def _static_features(ip: str) -> Dict[str, float]:
    features = {"is_vpn": 0.0, "is_tor": 0.0, "is_datacenter": 0.0,
                "is_residential_proxy": 0.0, "ip_reputation": 0.0, "_public": 0.0}
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return features
    if addr.is_private or addr.is_loopback:
        return features
    features["_public"] = 1.0
    if any(addr in net for _, net in _DATACENTER_NETS if net.version == addr.version):
        features["is_datacenter"] = 1.0
    # Risk 0-1 (0 = clean): datacenter origins are typical for automation
    features["ip_reputation"] = 0.6 * features["is_datacenter"]
    return features


def datacenter_name(ip: str) -> str:
    try:
        addr = ipaddress.ip_address(normalize_ip(ip))
    except ValueError:
        return ""
    for name, net in _DATACENTER_NETS:
        if net.version == addr.version and addr in net:
            return name
    return ""

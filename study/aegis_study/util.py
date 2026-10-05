"""Request metadata kept for the dataset: coarse browser/OS, header shape, route pattern.

The raw user agent, header values, query strings and IP addresses are not stored.
"""
import hashlib
import hmac
import re
from typing import Any, Dict, Optional, Tuple

_BROWSERS = [  # order matters: Edge and Opera also contain "Chrome"
    ("Edge", r"Edg(?:e|A|iOS)?/(\d+)"),
    ("Opera", r"OPR/(\d+)"),
    ("Samsung Internet", r"SamsungBrowser/(\d+)"),
    ("Firefox", r"(?:Firefox|FxiOS)/(\d+)"),
    ("Chrome", r"(?:Chrome|CriOS)/(\d+)"),
    ("Safari", r"Version/(\d+).*Safari/"),
]
_TOOLS = re.compile(r"python-requests|scrapy|curl|wget|httpx|aiohttp|go-http-client|java/|okhttp|headless", re.I)


def parse_user_agent(ua: str) -> Dict[str, Any]:
    """Browser family and major version, OS family and a mobile flag."""
    family: Optional[str] = None
    major: Optional[int] = None
    if _TOOLS.search(ua):
        family = "tool"
    else:
        for name, pattern in _BROWSERS:
            m = re.search(pattern, ua)
            if m:
                family, major = name, int(m.group(1))
                break
    if "Android" in ua:
        os_family = "Android"
    elif re.search(r"iPhone|iPad|iPod", ua):
        os_family = "iOS"
    elif "Windows" in ua:
        os_family = "Windows"
    elif "Mac OS X" in ua or "Macintosh" in ua:
        os_family = "macOS"
    elif "CrOS" in ua:
        os_family = "ChromeOS"
    elif "Linux" in ua:
        os_family = "Linux"
    else:
        os_family = "other" if ua else None
    return {"ua_family": family or ("other" if ua else None), "ua_major": major, "os_family": os_family,
            "mobile": int(bool(re.search(r"Mobi|Android|iPhone", ua))) if ua else None}


_ROUTES = [
    (re.compile(r"^/shop/product/\d+$"), "/shop/product/{id}"),
    (re.compile(r"^/shop/category/[a-z]+$"), "/shop/category/{name}"),
    (re.compile(r"^/shop/review/\d+$"), "/shop/review/{id}"),
    (re.compile(r"^/static/.+$"), "/static/{file}"),
    (re.compile(r"^/sdk/.+$"), "/sdk/{file}"),
]


def route_of(path: str) -> str:
    """Path pattern without identifiers or query string."""
    path = path.split("?", 1)[0] or "/"
    for pattern, name in _ROUTES:
        if pattern.match(path):
            return name
    return path if len(path) <= 64 else path[:64]


def header_shape(raw_headers: Any) -> Tuple[list, Dict[str, Any]]:
    """Header names in received order, and flags about selected headers (no values)."""
    names = [k.decode("latin-1").lower() if isinstance(k, bytes) else str(k).lower() for k, _ in raw_headers]
    values = {}
    for k, v in raw_headers:
        key = k.decode("latin-1").lower() if isinstance(k, bytes) else str(k).lower()
        values[key] = v.decode("latin-1") if isinstance(v, bytes) else str(v)
    accept = values.get("accept", "")
    flags = {
        "client_hints": "sec-ch-ua" in values,
        "fetch_metadata": "sec-fetch-mode" in values,
        "fetch_dest": values.get("sec-fetch-dest"),
        "accept_language": "accept-language" in values,
        "accept_language_count": len([p for p in values.get("accept-language", "").split(",") if p.strip()]),
        "accept_kind": ("html" if "text/html" in accept else "json" if "json" in accept
                        else "any" if accept.strip() == "*/*" else "other" if accept else None),
        "accept_encoding_br": "br" in values.get("accept-encoding", ""),
        "referer": "referer" in values,
        "cookie": "cookie" in values,
        "dnt": "dnt" in values,
        "header_count": len(names),
    }
    return names[:40], flags


def sign(value: str, secret: str) -> str:
    mac = hmac.new(secret.encode(), value.encode(), hashlib.sha256).hexdigest()[:24]
    return f"{value}.{mac}"


def unsign(signed: Optional[str], secret: str) -> Optional[str]:
    if not signed or "." not in signed:
        return None
    value, mac = signed.rsplit(".", 1)
    expected = hmac.new(secret.encode(), value.encode(), hashlib.sha256).hexdigest()[:24]
    return value if hmac.compare_digest(mac, expected) else None

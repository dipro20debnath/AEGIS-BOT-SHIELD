"""
Request-level analysis (headers and user agent) and score fusion.

Signals are (name, score 0-100) pairs combined with noisy-OR, the same rule
as the Node core's RiskScorer: independent evidence can only raise the risk.
"""
import socket
from functools import lru_cache
from typing import Dict, Iterable, List, Optional, Tuple

from .models import AnalysisResult

Signal = Tuple[str, float]

# (substring, score) - mirrors the built-in patterns of packages/core ThreatDatabase
UA_PATTERNS: List[Tuple[str, float]] = [
    ("headlesschrome", 70), ("phantomjs", 85), ("selenium", 80), ("webdriver", 80),
    ("puppeteer", 75), ("playwright", 75),
    ("python-requests", 40), ("python-urllib", 45), ("aiohttp", 45), ("httpx", 40),
    ("go-http-client", 50), ("java/", 40), ("libwww-perl", 60), ("wget/", 55), ("curl/", 35),
    ("scrapy", 75), ("node-fetch", 30), ("axios/", 25), ("httpclient", 45),
    ("sqlmap", 95), ("nikto", 90), ("nmap", 85), ("masscan", 90), ("zmeu", 95),
    ("acunetix", 90), ("dirbuster", 85), ("nessus", 88),
]

# Crawlers that publish reverse-DNS verification: UA token -> allowed rDNS suffixes
SEARCH_ENGINES: Dict[str, Tuple[str, ...]] = {
    "googlebot": (".googlebot.com", ".google.com"),
    "bingbot": (".search.msn.com",),
    "duckduckbot": (".duckduckgo.com",),
}


def noisy_or(scores: Iterable[float]) -> float:
    """Combine independent 0-100 risk scores: 100 * (1 - prod(1 - s/100))."""
    benign = 1.0
    for s in scores:
        benign *= 1.0 - min(1.0, max(0.0, s / 100.0))
    return 100.0 * (1.0 - benign)


@lru_cache(maxsize=4096)
def verify_crawler_ip(ip: str, suffixes: Tuple[str, ...]) -> bool:
    """Reverse DNS must end in an official suffix and resolve back to the same IP."""
    try:
        host = socket.gethostbyaddr(ip)[0].lower()
        if not host.endswith(suffixes):
            return False
        return ip in socket.gethostbyname_ex(host)[2]
    except (OSError, UnicodeError):
        return False


class RequestAnalyzer:
    """Scores a single HTTP request from its headers."""

    def __init__(self, verify_search_engines: bool = False):
        # rDNS lookups block; enable only where that latency is acceptable
        self.verify_search_engines = verify_search_engines

    def signals(self, ip: str, headers: Dict[str, str], method: str = "GET", path: str = "/") -> List[Signal]:
        h = {k.lower(): v for k, v in headers.items()}
        ua = h.get("user-agent", "")
        ua_lower = ua.lower()
        out: List[Signal] = []
        crawler = None

        if not ua:
            out.append(("missing_user_agent", 60))
        else:
            crawler = self._claimed_crawler(ua_lower)
            if crawler:
                if self.verify_search_engines:
                    if verify_crawler_ip(ip, SEARCH_ENGINES[crawler]):
                        return [(f"verified_crawler:{crawler}", 0)]
                    out.append((f"fake_crawler:{crawler}", 80))
                else:
                    out.append((f"unverified_crawler:{crawler}", 30))
            for pattern, score in UA_PATTERNS:
                if pattern in ua_lower:
                    out.append((f"ua:{pattern}", score))
                    break

        if "accept" not in h:
            out.append(("missing_accept", 25))
        # Crawlers send Mozilla-style UAs without Accept-Language; that is normal for them
        if "accept-language" not in h and ua.startswith("Mozilla/") and not crawler:
            out.append(("browser_without_accept_language", 30))
        if "sec-ch-ua" in h and "chrome" not in ua_lower and "chromium" not in ua_lower and "edg" not in ua_lower:
            out.append(("client_hints_ua_mismatch", 50))
        return out

    def analyze(self, ip: str, headers: Dict[str, str], method: str = "GET", path: str = "/") -> AnalysisResult:
        sigs = self.signals(ip, headers, method, path)
        return AnalysisResult(score=noisy_or(s for _, s in sigs), reason=",".join(n for n, _ in sigs))

    @staticmethod
    def _claimed_crawler(ua_lower: str) -> Optional[str]:
        for name in SEARCH_ENGINES:
            if name in ua_lower:
                return name
        return None


def behavior_signals(features: Dict[str, Dict[str, float]], headless_checks: Iterable[str] = ()) -> List[Signal]:
    """
    Rule-based checks on SDK features (contracts/features.json keys); the Python
    counterpart of analyzeBehavior() in the Node core.
    """
    m = features.get("mouse", {})
    k = features.get("keyboard", {})
    s = features.get("scroll", {})
    t = features.get("touch", {})
    fp = features.get("fingerprint", {})
    out: List[Signal] = []

    if fp.get("is_headless"):
        out.append(("headless_browser", 90 * max(0.5, fp.get("headless_confidence", 1.0))))
    if "webdriver" in headless_checks or "cdpLeak" in headless_checks:
        out.append(("automation_flag", 95))

    if m.get("mouse_event_count", 0) >= 10:
        if m.get("mouse_straightness_index", 0) > 0.98:
            out.append(("mouse_linear", 50))
        if m.get("mouse_event_count", 0) >= 20 and m.get("mouse_micro_tremor_freq", 0) < 2:
            out.append(("mouse_no_tremor", 35))
    if k.get("kb_total_events", 0) >= 10:
        if 0 < k.get("kb_avg_dwell_time", 0) < 20:
            out.append(("key_dwell_too_short", 60))
        if k.get("kb_cadence_entropy", 0) < 1.0:
            out.append(("typing_uniform", 45))

    interactions = (m.get("mouse_event_count", 0) + k.get("kb_total_events", 0)
                    + s.get("scroll_event_count", 0) + t.get("touch_tap_count", 0))
    if interactions == 0:
        out.append(("no_interaction", 20))
    return out

"""
Live IP reputation lists: Tor exit nodes, FireHOL level1, Spamhaus DROP and
(with an API key) AbuseIPDB. Python counterpart of packages/core
TorExitNodeChecker / ThreatFeedSync; same URLs, parsers and filtering.

Special-purpose ranges (private, loopback, CGNAT, documentation, multicast)
are dropped: FireHOL level1 contains 10.0.0.0/8, 127.0.0.0/8 and
100.64.0.0/10, which would otherwise mark localhost, reverse proxies and
carrier-NAT users as attackers.

Downloads use only the standard library, run in a daemon thread and fall back
to the last copy on disk; a failed or empty download keeps the previous list.
"""
import bisect
import ipaddress
import json
import logging
import os
import threading
import time
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, Iterable, List, Optional, Sequence, Tuple

logger = logging.getLogger("aegis_shield.feeds")

FEED_URLS = {
    "tor": "https://check.torproject.org/torbulkexitlist",
    "firehol_level1": "https://raw.githubusercontent.com/firehol/blocklist-ipsets/master/firehol_level1.netset",
    "spamhaus_drop": "https://www.spamhaus.org/drop/drop_v4.json",
    "abuseipdb": "https://api.abuseipdb.com/api/v2/blacklist",
}
#: Risk 0-100 when an IP is on the list (same values as the Node core)
FEED_SEVERITY = {"firehol_level1": 80, "spamhaus_drop": 90, "abuseipdb": 75}
#: Minimum seconds between downloads (AbuseIPDB free plan: 5 blacklist calls per day)
FEED_MIN_INTERVAL = {"tor": 15 * 60, "firehol_level1": 15 * 60, "spamhaus_drop": 3600, "abuseipdb": 6 * 3600}

_SPECIAL = [ipaddress.ip_network(c) for c in (
    "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12",
    "192.0.0.0/24", "192.0.2.0/24", "192.88.99.0/24", "192.168.0.0/16", "198.18.0.0/15",
    "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4")]

Fetcher = Callable[[str, Dict[str, str], float], str]


@dataclass
class ParsedFeed:
    entries: List[str] = field(default_factory=list)
    dropped_special: int = 0
    dropped_invalid: int = 0


def _network(value: str) -> Optional[ipaddress.IPv4Network]:
    try:
        net = ipaddress.ip_network(value.strip(), strict=False)
    except ValueError:
        return None
    return net if net.version == 4 else None


def is_special_purpose(value: str) -> bool:
    net = _network(value)
    return bool(net) and any(net.overlaps(s) for s in _SPECIAL)


def _collect(candidates: Iterable[str]) -> ParsedFeed:
    out = ParsedFeed()
    for raw in candidates:
        value = raw.strip()
        if not value:
            continue
        net = _network(value)
        if net is None:
            out.dropped_invalid += 1
        elif any(net.overlaps(s) for s in _SPECIAL):
            out.dropped_special += 1
        else:
            out.entries.append(value[:-3] if value.endswith("/32") else value)
    return out


def parse_plain_list(text: str) -> ParsedFeed:
    """One IP/CIDR per line with '#' or ';' comments (Tor, FireHOL, AbuseIPDB plaintext, drop.txt)."""
    lines = (line.split("#")[0].split(";")[0] for line in text.splitlines())
    return _collect(line for line in lines if line.strip())


def parse_spamhaus_drop(text: str) -> ParsedFeed:
    """Spamhaus DROP v4 NDJSON ({"cidr": ...} lines plus a metadata line); falls back to drop.txt."""
    if not text.lstrip().startswith("{"):
        return parse_plain_list(text)
    cidrs, invalid = [], 0
    for line in text.splitlines():
        if not line.strip():
            continue
        try:
            obj = json.loads(line)
        except ValueError:
            invalid += 1
            continue
        if obj.get("cidr"):
            cidrs.append(obj["cidr"])
    parsed = _collect(cidrs)
    parsed.dropped_invalid += invalid
    return parsed


PARSERS = {"tor": parse_plain_list, "firehol_level1": parse_plain_list,
           "spamhaus_drop": parse_spamhaus_drop, "abuseipdb": parse_plain_list}


def _urllib_fetch(url: str, headers: Dict[str, str], timeout: float) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "aegis-bot-shield-feed-sync", **headers})
    with urllib.request.urlopen(req, timeout=timeout) as res:  # noqa: S310 (fixed https URLs)
        return res.read().decode("utf-8", errors="replace")


class _RangeSet:
    """Merged, sorted IPv4 intervals; membership by binary search."""

    def __init__(self, entries: Sequence[str]):
        ranges = sorted((int(n.network_address), int(n.broadcast_address))
                        for n in (_network(e) for e in entries) if n is not None)
        merged: List[List[int]] = []
        for start, end in ranges:
            if merged and start <= merged[-1][1] + 1:
                merged[-1][1] = max(merged[-1][1], end)
            else:
                merged.append([start, end])
        self.starts = [r[0] for r in merged]
        self.ends = [r[1] for r in merged]
        self.count = len(entries)

    def __contains__(self, addr: int) -> bool:
        i = bisect.bisect_right(self.starts, addr) - 1
        return i >= 0 and addr <= self.ends[i]


class IPReputation:
    """
    Holds the downloaded lists and answers lookups.

    >>> rep = IPReputation(feeds=["tor", "firehol_level1"], cache_dir="/var/cache/aegis")
    >>> rep.start()            # background refresh thread
    >>> rep.lookup("1.2.3.4")  # {"is_tor": False, "lists": [...], "risk": 0}
    """

    def __init__(self, feeds: Sequence[str] = ("tor", "firehol_level1", "spamhaus_drop", "abuseipdb"),
                 cache_dir: Optional[str] = None, abuseipdb_key: Optional[str] = None,
                 abuseipdb_min_confidence: int = 90, interval: float = 6 * 3600, timeout: float = 15,
                 fetcher: Optional[Fetcher] = None, urls: Optional[Dict[str, str]] = None):
        self.feeds = list(feeds)
        self.cache_dir = Path(cache_dir) if cache_dir else None
        self.abuseipdb_key = abuseipdb_key if abuseipdb_key is not None else os.environ.get("ABUSEIPDB_API_KEY", "")
        self.abuseipdb_min_confidence = abuseipdb_min_confidence
        self.interval = interval
        self.timeout = timeout
        self.fetcher = fetcher or _urllib_fetch
        self.urls = {**FEED_URLS, **(urls or {})}
        self._tor: frozenset = frozenset()
        self._lists: Dict[str, _RangeSet] = {}
        self._status: Dict[str, Dict] = {}
        self._last: Dict[str, float] = {}
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        for feed in self.feeds:
            cached = self._read_cache(feed)
            if cached:
                self._apply(feed, cached[0], "cache", cached[1])

    # --- lookups ---------------------------------------------------------------

    def lookup(self, ip: str) -> Dict:
        ip = ip[7:] if ip.startswith("::ffff:") else ip
        net = _network(ip)
        if net is None or net.num_addresses != 1:
            return {"is_tor": False, "lists": [], "risk": 0}
        addr = int(net.network_address)
        lists = [feed for feed, ranges in self._lists.items() if addr in ranges]
        return {"is_tor": ip in self._tor, "lists": lists,
                "risk": max((FEED_SEVERITY[f] for f in lists), default=0)}

    def is_tor(self, ip: str) -> bool:
        return self.lookup(ip)["is_tor"]

    # --- downloads -------------------------------------------------------------

    def refresh(self, feed: str, force: bool = False) -> Dict:
        if feed == "abuseipdb" and not self.abuseipdb_key:
            return self._record(feed, ok=False, count=self._count(feed), skipped="no ABUSEIPDB_API_KEY")
        if not force and time.time() - self._last.get(feed, 0) < FEED_MIN_INTERVAL[feed]:
            return self._status.get(feed) or {"feed": feed, "ok": True, "skipped": "synced recently"}
        self._last[feed] = time.time()
        url, headers = self.urls[feed], {}
        if feed == "abuseipdb":
            url = f"{url}?confidenceMinimum={self.abuseipdb_min_confidence}&plaintext"
            headers = {"Key": self.abuseipdb_key, "Accept": "text/plain"}
        try:
            text = self.fetcher(url, headers, self.timeout)
        except Exception as exc:  # network errors, HTTP errors, timeouts
            logger.warning("feed %s download failed, keeping previous list: %s", feed, exc)
            return self._record(feed, ok=False, count=self._count(feed), error=str(exc))
        result = self._apply(feed, text, "network", time.time())
        if result["ok"]:
            self._write_cache(feed, text)
        return result

    def refresh_all(self, force: bool = False) -> List[Dict]:
        return [self.refresh(feed, force) for feed in self.feeds]

    def start(self) -> None:
        """Download now and then every `interval` seconds in a daemon thread."""
        if self._thread:
            return

        def loop():
            force = True
            while not self._stop.is_set():
                self.refresh_all(force)
                force = False
                self._stop.wait(self.interval)

        self._thread = threading.Thread(target=loop, name="aegis-feeds", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def status(self) -> List[Dict]:
        return [self._status.get(f, {"feed": f, "ok": False, "skipped": "not synced yet"}) for f in self.feeds]

    # --- internals -------------------------------------------------------------

    def _apply(self, feed: str, text: str, source: str, updated_at: float) -> Dict:
        parsed = PARSERS[feed](text)
        if not parsed.entries:
            return self._record(feed, ok=False, count=self._count(feed), error="feed contained no usable entries")
        with self._lock:
            if feed == "tor":
                self._tor = frozenset(e for e in parsed.entries if "/" not in e)
            else:
                self._lists = {**self._lists, feed: _RangeSet(parsed.entries)}
        return self._record(feed, ok=True, count=self._count(feed), dropped_special=parsed.dropped_special,
                            source=source, updated_at=updated_at)

    def _count(self, feed: str) -> int:
        return len(self._tor) if feed == "tor" else (self._lists[feed].count if feed in self._lists else 0)

    def _record(self, feed: str, **result) -> Dict:
        self._status[feed] = {"feed": feed, **result}
        return self._status[feed]

    def _read_cache(self, feed: str) -> Optional[Tuple[str, float]]:
        if not self.cache_dir:
            return None
        path = self.cache_dir / f"{feed}.txt"
        try:
            return path.read_text("utf-8"), path.stat().st_mtime
        except OSError:
            return None

    def _write_cache(self, feed: str, text: str) -> None:
        if not self.cache_dir:
            return
        try:
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            tmp = self.cache_dir / f"{feed}.txt.tmp"
            tmp.write_text(text, "utf-8")
            tmp.replace(self.cache_dir / f"{feed}.txt")
        except OSError as exc:
            logger.warning("could not cache feed %s: %s", feed, exc)

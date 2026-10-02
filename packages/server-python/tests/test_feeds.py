import random
from pathlib import Path

import pytest

from aegis_shield.feeds import IPReputation, is_special_purpose, parse_plain_list, parse_spamhaus_drop
from aegis_shield.ip_intel import classify_ip
from aegis_shield.middleware import AegisMiddlewareBase
from aegis_shield.session_patterns import RequestRecord, longest_sequential_run, session_signals
from conftest import BROWSER_HEADERS, SECRET, SITE_KEY

# Shared with the Node core tests
FIXTURES = Path(__file__).resolve().parents[2] / "core" / "tests" / "fixtures"
FIREHOL = (FIXTURES / "firehol_level1.sample.netset").read_text()
SPAMHAUS = (FIXTURES / "spamhaus_drop_v4.sample.json").read_text()
TOR = (FIXTURES / "torbulkexitlist.sample.txt").read_text()


class FakeFetch:
    def __init__(self, routes):
        self.routes = routes
        self.calls = []

    def __call__(self, url, headers, timeout):
        self.calls.append((url, headers))
        for key, body in self.routes.items():
            if key in url:
                if isinstance(body, Exception):
                    raise body
                return body
        raise OSError("HTTP 404")


def test_parsers_match_the_node_core():
    firehol = parse_plain_list(FIREHOL)
    assert "1.10.16.0/20" in firehol.entries and "50.16.16.211" in firehol.entries
    assert not {"10.0.0.0/8", "127.0.0.0/8", "100.64.0.0/10", "198.51.100.0/24"} & set(firehol.entries)
    assert firehol.dropped_special == 7
    spamhaus = parse_spamhaus_drop(SPAMHAUS)
    assert spamhaus.entries == ["1.10.16.0/20", "1.19.0.0/16", "5.42.92.0/24"]
    assert spamhaus.dropped_special == 1
    assert is_special_purpose("172.20.1.1") and not is_special_purpose("103.230.104.0/24")


def test_reputation_lookup_and_network_features():
    fetch = FakeFetch({"torproject": TOR, "firehol": FIREHOL, "spamhaus": SPAMHAUS})
    rep = IPReputation(fetcher=fetch, abuseipdb_key="")
    results = {r["feed"]: r for r in rep.refresh_all(force=True)}
    assert results["tor"]["count"] == 3 and results["firehol_level1"]["ok"]
    assert results["abuseipdb"]["skipped"] == "no ABUSEIPDB_API_KEY"
    assert not any("abuseipdb" in url for url, _ in fetch.calls)

    assert rep.lookup("::ffff:185.220.101.1")["is_tor"]
    assert rep.lookup("1.10.20.5") == {"is_tor": False, "lists": ["firehol_level1", "spamhaus_drop"], "risk": 90}
    assert rep.lookup("10.0.0.5")["lists"] == [] and rep.lookup("::1")["lists"] == []

    assert classify_ip("185.220.101.1", rep)["is_tor"] == 1
    assert classify_ip("1.10.20.5", rep)["ip_reputation"] == pytest.approx(0.9)
    assert classify_ip("8.8.8.8", rep)["ip_reputation"] == 0


def test_failed_or_empty_download_keeps_previous_list(tmp_path):
    routes = {"firehol": FIREHOL}
    rep = IPReputation(feeds=["firehol_level1"], fetcher=FakeFetch(routes), cache_dir=str(tmp_path))
    rep.refresh("firehol_level1", force=True)
    routes["firehol"] = OSError("HTTP 503")
    assert rep.refresh("firehol_level1", force=True)["ok"] is False
    routes["firehol"] = "<html>maintenance</html>"
    assert rep.refresh("firehol_level1", force=True)["ok"] is False
    assert rep.lookup("1.10.20.5")["lists"] == ["firehol_level1"]
    # A restart without network serves the cached copy
    offline = IPReputation(feeds=["firehol_level1"], fetcher=FakeFetch({}), cache_dir=str(tmp_path))
    assert offline.status()[0]["source"] == "cache"
    assert offline.lookup("1.10.20.5")["lists"] == ["firehol_level1"]


def test_abuseipdb_key_header_and_rate_limit():
    fetch = FakeFetch({"abuseipdb": "45.155.205.1\n45.155.205.2\n"})
    rep = IPReputation(feeds=["abuseipdb"], fetcher=fetch, abuseipdb_key="k-123")
    assert rep.refresh("abuseipdb")["count"] == 2
    url, headers = fetch.calls[0]
    assert "confidenceMinimum=90" in url and headers == {"Key": "k-123", "Accept": "text/plain"}
    rep.refresh("abuseipdb")
    assert len(fetch.calls) == 1


def test_middleware_uses_reputation_for_requests():
    rep = IPReputation(feeds=["tor", "firehol_level1"], fetcher=FakeFetch({"torproject": TOR, "firehol": FIREHOL}))
    rep.refresh_all(force=True)
    base = AegisMiddlewareBase(SITE_KEY, SECRET, reputation=rep, session_patterns=False)
    clean, _ = base.evaluate("GET", "/", "8.8.8.8", BROWSER_HEADERS, {})
    tor, _ = base.evaluate("GET", "/", "185.220.101.1", BROWSER_HEADERS, {})
    listed, _ = base.evaluate("GET", "/", "1.10.20.5", BROWSER_HEADERS, {})
    assert clean.score == 0
    assert "tor_exit" in tor.reason and tor.score >= 70
    assert "threat_list:firehol_level1" in listed.reason and listed.action == "block"


# --- session patterns ------------------------------------------------------------

def _records(paths, gaps, kind="page", referer=False):
    t, out = 0.0, []
    for path, gap in zip(paths, gaps):
        t += gap
        out.append(RequestRecord(t, path, kind, referer))
    return out


def test_scraper_patterns():
    bot = _records([f"/product/{1000 + i}" for i in range(12)], [2.0] * 12)
    names = {n for n, _ in session_signals(bot)}
    assert {"session_timer_regular", "session_sequential_ids", "session_no_referer"} <= names
    assert longest_sequential_run(["/p/10", "/p/20", "/p/30"]) == 3


def test_simulated_humans_are_not_flagged():
    rng = random.Random(42)
    paths = ["/", "/products", "/product/731", "/product/88", "/cart", "/search?q=bag", "/about"]
    flagged = 0
    for _ in range(200):
        n = rng.randint(5, 30)
        history = _records([rng.choice(paths) for _ in range(n)],
                           [3 + rng.lognormvariate(2.5, 1.0) for _ in range(n)], referer=True)
        history[0].has_referer = False
        flagged += bool(session_signals(history, expect_assets=False))
    assert flagged == 0


def test_error_probing_through_the_middleware(base):
    cookies = {}
    for i in range(12):
        result, extra = base.evaluate("GET", f"/wp-admin{i}.php", "198.51.100.10", BROWSER_HEADERS, cookies)
        if "Set-Cookie" in extra:
            cookies = {"aegis_sid": extra["Set-Cookie"].split(";")[0].split("=", 1)[1]}
        base.record_response(result, 404 if i < 10 else 200)
    result, _ = base.evaluate("GET", "/wp-login.php", "198.51.100.10", BROWSER_HEADERS, cookies)
    assert "session_error_probing" in result.reason

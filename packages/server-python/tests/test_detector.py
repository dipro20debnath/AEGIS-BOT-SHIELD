from aegis_shield.detector import RequestAnalyzer, behavior_signals, noisy_or
from aegis_shield.ip_intel import classify_ip
from aegis_shield.utils import get_client_ip
from conftest import BROWSER_HEADERS


def names(signals):
    return [n for n, _ in signals]


def test_noisy_or():
    assert noisy_or([]) == 0
    assert noisy_or([50, 50]) == 75
    assert noisy_or([100, 10]) == 100
    assert noisy_or([98]) <= noisy_or([98, 12])  # extra evidence never lowers risk


def test_browser_request_is_clean():
    assert RequestAnalyzer().signals("1.2.3.4", BROWSER_HEADERS) == []


def test_scripted_clients_and_scanners():
    analyzer = RequestAnalyzer()
    assert "ua:python-requests" in names(analyzer.signals("1.2.3.4", {"user-agent": "python-requests/2.31", "accept": "*/*"}))
    assert analyzer.analyze("1.2.3.4", {"user-agent": "sqlmap/1.7"}).score >= 95
    assert "missing_user_agent" in names(analyzer.signals("1.2.3.4", {}))


def test_unverified_crawler_claim_is_only_weak():
    analyzer = RequestAnalyzer()
    ua = {"user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "accept": "*/*"}
    result = analyzer.analyze("66.249.66.1", ua)
    assert "unverified_crawler:googlebot" in result.reason
    assert result.score < 50  # not challenged or blocked


def test_crawler_verification(monkeypatch):
    import aegis_shield.detector as detector
    ua = {"user-agent": "Googlebot/2.1", "accept": "*/*"}
    monkeypatch.setattr(detector, "verify_crawler_ip", lambda ip, suffixes: ip == "66.249.66.1")
    analyzer = RequestAnalyzer(verify_search_engines=True)
    assert analyzer.analyze("66.249.66.1", ua).score == 0
    assert analyzer.analyze("5.6.7.8", ua).score >= 80


def test_client_hints_mismatch():
    headers = {**BROWSER_HEADERS, "user-agent": "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0"}
    assert "client_hints_ua_mismatch" in names(RequestAnalyzer().signals("1.2.3.4", headers))


def test_behavior_signals():
    human = {"mouse": {"mouse_event_count": 200, "mouse_straightness_index": 0.7, "mouse_micro_tremor_freq": 9},
             "keyboard": {"kb_total_events": 50, "kb_avg_dwell_time": 100, "kb_cadence_entropy": 4}}
    assert behavior_signals(human) == []
    bot = {"mouse": {"mouse_event_count": 50, "mouse_straightness_index": 0.995, "mouse_micro_tremor_freq": 0},
           "keyboard": {"kb_total_events": 30, "kb_avg_dwell_time": 3, "kb_cadence_entropy": 0.1},
           "fingerprint": {"is_headless": 1, "headless_confidence": 0.9}}
    assert set(names(behavior_signals(bot, ["webdriver"]))) >= {
        "headless_browser", "automation_flag", "mouse_linear", "mouse_no_tremor", "key_dwell_too_short", "typing_uniform"}
    assert names(behavior_signals({})) == ["no_interaction"]


def test_classify_ip():
    assert classify_ip("127.0.0.1")["ip_reputation"] == 0
    assert classify_ip("159.65.1.1")["is_datacenter"] == 1
    assert classify_ip("::ffff:185.245.87.182")["is_tor"] == 0  # no live list: nothing is Tor
    assert classify_ip("not-an-ip")["is_tor"] == 0


def test_forwarded_for_only_from_trusted_proxy():
    headers = {"X-Forwarded-For": "203.0.113.7, 10.0.0.2"}
    assert get_client_ip(headers, "198.51.100.1") == "198.51.100.1"            # untrusted peer: ignore XFF
    assert get_client_ip(headers, "10.0.0.1", ["10.0.0.0/8"]) == "203.0.113.7"  # trusted proxy chain

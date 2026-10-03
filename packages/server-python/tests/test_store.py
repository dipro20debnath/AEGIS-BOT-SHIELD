"""Shared store: contract, and two middleware instances (= two worker processes) sharing it.

The Redis cases run against a real server when AEGIS_TEST_REDIS_URL is set
(CI starts a redis service; locally: redis-server & AEGIS_TEST_REDIS_URL=redis://127.0.0.1:6379/15).
"""
import json
import os
import time
import uuid

import pytest

from aegis_shield import AntiTamper, TokenVerifier
from aegis_shield.middleware import AegisMiddlewareBase
from aegis_shield.sessions import SESSION_COOKIE, Session, SessionTracker
from aegis_shield.store import MAX_HITS_PER_KEY, MemoryStore, RedisStore, create_redis_store
from aegis_shield.verifier import generate_token
from conftest import BROWSER_HEADERS, SECRET, SITE_KEY, telemetry_body
from test_challenge import solve

REDIS_URL = os.getenv("AEGIS_TEST_REDIS_URL")


def _memory():
    return MemoryStore()


def _redis():
    return create_redis_store(REDIS_URL, prefix=f"aegis-py-test:{uuid.uuid4().hex[:8]}:")


STORES = [pytest.param(_memory, id="memory"),
          pytest.param(_redis, id="redis", marks=pytest.mark.skipif(not REDIS_URL, reason="AEGIS_TEST_REDIS_URL not set"))]


@pytest.fixture(params=STORES)
def make_store(request):
    stores = []

    def make():
        store = request.param()
        stores.append(store)
        return store
    yield make
    for store in stores:
        store.close()


def test_store_contract(make_store):
    store = make_store()
    assert store.claim_once("a", 0.15) is True
    assert store.claim_once("a", 0.15) is False
    assert store.claim_once("b", 0.15) is True
    assert [store.hit("ip", 0.3) for _ in range(4)] == [1, 2, 3, 4]
    assert store.hit("other", 0.3) == 1
    assert store.get("k") is None
    store.set("k", '{"x":1}', 0.15)
    assert store.get("k") == '{"x":1}'
    time.sleep(0.4)
    assert store.claim_once("a", 0.15) is True
    assert store.hit("ip", 0.3) == 1
    assert store.get("k") is None


def test_memory_window_saturates():
    store = MemoryStore()
    for _ in range(MAX_HITS_PER_KEY + 20):
        count = store.hit("flood", 60)
    assert count == MAX_HITS_PER_KEY


def test_session_json_round_trip():
    tracker = SessionTracker(store=MemoryStore())
    session = tracker.get_or_create(None)
    tracker.record_request(session, "/a", "GET", BROWSER_HEADERS)
    tracker.record_response(session, 404)
    tracker.record_risk(session, 42.0)
    loaded = tracker.get(session.id)
    assert isinstance(loaded, Session) and loaded is not session
    assert loaded.paths == {"/a"} and loaded.risk_history == [42.0]
    assert loaded.requests[0].status == 404 and loaded.requests[0].kind == "page"
    assert tracker.features(loaded) == tracker.features(session)


def _cookie(headers):
    return headers["Set-Cookie"].split(";", 1)[0].split("=", 1)[1]


def test_two_workers_share_replay_sessions_and_limits(make_store):
    store = make_store()
    kwargs = dict(pow_n=1024, pow_bits=2, endpoint_limits={"/login": [2, 60]})
    a = AegisMiddlewareBase(SITE_KEY, SECRET, store=store, **kwargs)
    b = AegisMiddlewareBase(SITE_KEY, SECRET, store=store, **kwargs)

    # Proof of work redeemed at A cannot be replayed at B
    c = a.challenger.issue()
    nonce = solve(c)
    body = json.dumps({"challenge": c["challenge"], "nonce": nonce}).encode()
    assert a.handle_challenge("POST", body, BROWSER_HEADERS, {}).status == 200
    replay = b.handle_challenge("POST", body, BROWSER_HEADERS, {})
    assert replay.status == 403 and replay.body["reason"] == "replay"

    # Telemetry at A, challenge solved at B: B's token carries A's telemetry score
    tel = a.handle_telemetry(telemetry_body(True), "198.51.100.7", BROWSER_HEADERS, {})
    assert tel.status == 200
    sid = _cookie(tel.headers)
    c = b.challenger.issue()
    solved = b.handle_challenge("POST", json.dumps({"challenge": c["challenge"], "nonce": solve(c)}).encode(),
                                BROWSER_HEADERS, {SESSION_COOKIE: sid})
    claims = TokenVerifier(SECRET).verify(solved.body["token"])
    assert claims["sid"] == sid and claims["tel"] == 1 and claims["score"] == tel.body["score"]

    # The endpoint limit counts requests at both workers
    actions = [w.evaluate("POST", "/login", "198.51.100.8", BROWSER_HEADERS, {})[0] for w in (a, b, a)]
    assert "rate_limit.exceeded" not in actions[1].reason
    assert "rate_limit.exceeded" in actions[2].reason and actions[2].action == "block"


def test_single_use_tokens_and_signatures_across_workers(make_store):
    store = make_store()
    token = generate_token({"sid": "s", "score": 1, "nonce": uuid.uuid4().hex}, SECRET)
    assert TokenVerifier(SECRET, single_use=True, store=store).verify(token) is not None
    assert TokenVerifier(SECRET, single_use=True, store=store).verify(token) is None

    header = AntiTamper(SECRET).sign("POST", "/hook", b"{}")
    assert AntiTamper(SECRET, store=store).verify("POST", "/hook", b"{}", header) == (True, None)
    assert AntiTamper(SECRET, store=store).verify("POST", "/hook", b"{}", header) == (False, "replay")


def test_rate_limit_without_shared_store():
    base = AegisMiddlewareBase(SITE_KEY, SECRET, rate_limit=3, rate_limit_window=60)
    results = [base.evaluate("GET", "/", "198.51.100.9", BROWSER_HEADERS, {})[0] for _ in range(4)]
    assert all("rate_limit.exceeded" not in r.reason for r in results[:3])
    assert "rate_limit.exceeded" in results[3].reason
    assert base.handle_telemetry(telemetry_body(True), "198.51.100.9", BROWSER_HEADERS, {}).status == 429


def test_unreachable_redis_fails_at_startup():
    with pytest.raises(RuntimeError, match="cannot connect to Redis"):
        AegisMiddlewareBase(SITE_KEY, SECRET, redis_url="redis://127.0.0.1:1/0")


def test_redis_store_key_layout_matches_node():
    class Fake:
        def __init__(self):
            self.calls = []

        def register_script(self, script):
            return lambda keys, args: self.calls.append(("eval", keys, args)) or 5

        def set(self, *args, **kwargs):
            self.calls.append(("set", args, kwargs))
            return True

    fake = Fake()
    store = RedisStore(fake, prefix="site1:")
    assert store.claim_once("n1", 1) is True
    assert store.hit("ip", 1) == 5
    assert fake.calls[0] == ("set", ("site1:once:n1", "1"), {"px": 1000, "nx": True})
    assert fake.calls[1][1] == ["site1:win:ip"]


def test_one_session_write_per_request():
    class CountingStore(MemoryStore):
        writes = 0

        def set(self, key, value, ttl_seconds):
            if key.startswith("sess:"):
                CountingStore.writes += 1
            super().set(key, value, ttl_seconds)

    store = CountingStore()
    base = AegisMiddlewareBase(SITE_KEY, SECRET, store=store, mode="monitor")
    result, _ = base.evaluate("GET", "/page", "198.51.100.30", BROWSER_HEADERS, {})
    assert CountingStore.writes == 0  # allowed: stored with the response status
    base.record_response(result, 404)
    assert CountingStore.writes == 1
    assert base.sessions.get(result.session_id).requests[-1].status == 404

    enforcing = AegisMiddlewareBase(SITE_KEY, SECRET, store=store)
    denied, _ = enforcing.evaluate("GET", "/page", "198.51.100.31", {"user-agent": "curl/8.0"}, {})
    assert denied.action in ("block", "challenge")
    assert enforcing.sessions.get(denied.session_id) is not None  # denied: stored at once


class _DownStore:
    def _fail(self, *args, **kwargs):
        raise ConnectionError("ECONNREFUSED")

    claim_once = hit = get = set = _fail

    def close(self):
        pass


def test_store_outage_does_not_bypass_analysis():
    base = AegisMiddlewareBase(SITE_KEY, SECRET, store=_DownStore(), require_token_paths=["/login"],
                               rate_limit=10, pow_n=1024, pow_bits=2)
    result, _ = base.evaluate("POST", "/login", "198.51.100.40", BROWSER_HEADERS, {})
    assert result.action == "challenge" and "token_required" in result.reason
    assert result.reason != "analysis_error"
    assert base.handle_telemetry(telemetry_body(True), "198.51.100.40", BROWSER_HEADERS, {}).status == 200
    c = base.challenger.issue()
    body = json.dumps({"challenge": c["challenge"], "nonce": solve(c)}).encode()
    assert base.handle_challenge("POST", body, BROWSER_HEADERS, {}).status == 503

import hashlib
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from aegis_shield.challenge import MemoryHardChallenger, leading_zero_bits
from aegis_shield.middleware import AegisMiddlewareBase
from conftest import BROWSER_HEADERS, SECRET, SITE_KEY, telemetry_body

CORE_POW = Path(__file__).resolve().parents[2] / "core" / "dist" / "security" / "MemoryHardChallenge.js"


def solve(c, valid=True):
    for nonce in range(1 << 16):
        digest = hashlib.scrypt(f"{c['challenge']}:{nonce}".encode(), salt=c["seed"].encode(), n=c["n"], r=c["r"], p=1, dklen=32)
        if (leading_zero_bits(digest) >= c["bits"]) == valid:
            return nonce
    raise AssertionError("no nonce found")


@pytest.fixture
def pow_base():
    return AegisMiddlewareBase(SITE_KEY, SECRET, require_token_paths=["/checkout"], pow_n=1024, pow_bits=3)


def test_challenger_rejects_bad_input():
    ch = MemoryHardChallenger(SECRET, n=1024, bits=3)
    c = ch.issue()
    assert ch.verify(c["challenge"], solve(c, valid=False)) == (False, "insufficient_work")
    assert ch.verify(c["challenge"], solve(c)) == (False, "replay")  # burnt by the failed attempt
    assert ch.verify("junk", 1) == (False, "malformed")
    assert ch.verify(ch.issue()["challenge"], True) == (False, "malformed")
    old = ch.issue(now=0)
    assert ch.verify(old["challenge"], 0) == (False, "expired")
    other = MemoryHardChallenger("another-secret-0123456789", n=1024, bits=3)
    assert other.verify(ch.issue()["challenge"], 0) == (False, "bad_signature")
    with pytest.raises(ValueError):
        MemoryHardChallenger(SECRET, n=1000)


def _pow_token(base, headers, cookies=None):
    """Solve a challenge like a browser: keep the session cookie the first response sets.
    Returns the token, the request body (for replays) and the cookies to send with the token."""
    issued = base.handle_endpoint("GET", "/aegis/challenge", b"", "198.51.100.10", headers, cookies or {})
    if not cookies:
        cookies = {"aegis_sid": issued.headers["Set-Cookie"].split(";")[0].split("=", 1)[1]}
    c = issued.body
    body = json.dumps({"challenge": c["challenge"], "nonce": solve(c)}).encode()
    r = base.handle_endpoint("POST", "/aegis/challenge", body, "198.51.100.10", headers, cookies)
    assert r.status == 200, r.body
    return r.body["token"], body, cookies


def test_solved_challenge_turns_a_challenge_into_allow(pow_base):
    go = {"user-agent": "Go-http-client/1.1"}
    denied, _ = pow_base.evaluate("GET", "/products", "198.51.100.10", go, {})
    assert denied.action == "challenge"
    assert pow_base.denial(denied).body["challenge"] == "/aegis/challenge"

    token, body, cookies = _pow_token(pow_base, go)
    replay = pow_base.handle_endpoint("POST", "/aegis/challenge", body, "198.51.100.10", go, {})
    assert replay.status == 403 and replay.body["reason"] == "replay"

    result, _ = pow_base.evaluate("GET", "/products", "198.51.100.10", {**go, "X-Aegis-Token": token}, cookies)
    assert result.action == "allow" and "pow_solved" in result.reason
    assert result.score == denied.score  # the request signals are not counted twice


def test_proof_of_work_alone_does_not_unlock_token_required_paths(pow_base):
    token, _, cookies = _pow_token(pow_base, BROWSER_HEADERS)
    result, _ = pow_base.evaluate("POST", "/checkout", "198.51.100.10", {**BROWSER_HEADERS, "X-Aegis-Token": token}, cookies)
    assert result.action == "challenge" and "token_required" in result.reason

    # Same flow after the session sent telemetry: the PoW token carries that evidence ("tel")
    r = pow_base.handle_telemetry(telemetry_body(True), "198.51.100.10", BROWSER_HEADERS, {})
    cookies = {"aegis_sid": r.headers["Set-Cookie"].split(";")[0].split("=", 1)[1]}
    token, _, cookies = _pow_token(pow_base, BROWSER_HEADERS, cookies)
    result, _ = pow_base.evaluate("POST", "/checkout", "198.51.100.10", {**BROWSER_HEADERS, "X-Aegis-Token": token}, cookies)
    assert result.action == "allow"


def test_solved_challenge_never_lifts_a_block(pow_base):
    bot = {"user-agent": "sqlmap/1.7"}
    token, _, cookies = _pow_token(pow_base, bot)
    result, _ = pow_base.evaluate("POST", "/checkout", "198.51.100.10", {**bot, "X-Aegis-Token": token}, cookies)
    assert result.action == "block"


def test_anti_detect_summary_raises_the_telemetry_score(base):
    def score(anti):
        body = json.loads(telemetry_body(True))
        if anti is not None:
            body["antiDetect"] = anti
        r = base.handle_telemetry(json.dumps(body).encode(), "198.51.100.10", BROWSER_HEADERS, {})
        assert r.status == 200
        return r.body["score"]

    clean = score(None)
    assert score({"score": 0.3, "checks": ["languageMismatch"]}) == clean  # a single weak check is ignored
    assert score({"score": 0.97, "checks": ["uaPlatformMismatch", "gpuOsMismatch"]}) > clean + 30


@pytest.mark.skipif(not shutil.which("node") or not CORE_POW.exists(),
                    reason="needs node and a built packages/core (npm run build -w packages/core)")
def test_challenges_interoperate_with_node_core():
    # Python issues and Node verifies, then Node issues and Python verifies
    py = MemoryHardChallenger(SECRET, n=1024, bits=2)
    c = py.issue()
    script = (f"const m=require({json.dumps(str(CORE_POW))});"
              f"const ch=new m.MemoryHardChallenger({json.dumps(SECRET)},{{n:1024,r:8,bits:2}});"
              "const [challenge, nonce]=process.argv.slice(1);"
              "ch.verify(challenge, Number(nonce)).then(v=>{console.log(JSON.stringify({verified:v, issued:ch.issue()}));ch.destroy();});")
    out = json.loads(subprocess.run(["node", "-e", script, c["challenge"], str(solve(c))],
                                    capture_output=True, text=True, check=True).stdout)
    assert out["verified"]["valid"] is True
    node_c = out["issued"]
    assert py.verify(node_c["challenge"], solve(node_c)) == (True, None)

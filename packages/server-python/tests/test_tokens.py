import json
import shutil
import subprocess
import time
from pathlib import Path

import pytest

from aegis_shield.verifier import TokenVerifier, generate_token
from conftest import SECRET

CORE_CRYPTO = Path(__file__).resolve().parents[2] / "core" / "dist" / "utils" / "crypto.js"


def test_round_trip_and_reuse():
    token = generate_token({"sid": "s1", "score": 12.5}, SECRET)
    verifier = TokenVerifier(SECRET)
    claims = verifier.verify(token)
    assert claims["sid"] == "s1" and claims["score"] == 12.5
    assert verifier.verify(token)["sid"] == "s1"  # session tokens are reusable until expiry


def test_single_use_rejects_replay():
    token = generate_token({"challenge": "ok"}, SECRET)
    verifier = TokenVerifier(SECRET, single_use=True)
    assert verifier.verify(token) is not None
    assert verifier.verify(token) is None


def test_rejects_tampering_and_wrong_key():
    token = generate_token({"sid": "s1"}, SECRET)
    head, version, payload, sig = token.split(".")
    flipped = sig[:-1] + ("A" if sig[-1] != "A" else "B")
    assert TokenVerifier(SECRET).verify(".".join([head, version, payload, flipped])) is None
    assert TokenVerifier("another-secret-key-0000").verify(token) is None
    assert TokenVerifier(SECRET).verify("garbage") is None


def test_rejects_expired(monkeypatch):
    token = generate_token({"sid": "s1", "exp": int(time.time()) + 10}, SECRET)
    later = time.time() + 11
    monkeypatch.setattr(time, "time", lambda: later)
    assert TokenVerifier(SECRET, max_token_age=300).verify(token) is None


def test_requires_secret():
    with pytest.raises(ValueError):
        TokenVerifier("")


@pytest.mark.skipif(not shutil.which("node") or not CORE_CRYPTO.exists(),
                    reason="needs node and a built packages/core (npm run build -w packages/core)")
def test_compatible_with_node_core():
    script = (f"const c=require({json.dumps(str(CORE_CRYPTO))});"
              f"const t=c.generateToken({{sid:'from-node'}}, {json.dumps(SECRET)});"
              f"const p=c.verifyToken(process.argv[1], {json.dumps(SECRET)});"
              "console.log(JSON.stringify({token:t, decoded:p}));")
    py_token = generate_token({"sid": "from-python"}, SECRET)
    out = json.loads(subprocess.run(["node", "-e", script, py_token], capture_output=True, text=True,
                                    check=True).stdout)
    assert out["decoded"]["sid"] == "from-python"          # Python token verified by Node
    assert TokenVerifier(SECRET).verify(out["token"])["sid"] == "from-node"  # and vice versa

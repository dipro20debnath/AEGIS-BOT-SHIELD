import json
import shutil
import subprocess
from pathlib import Path

import pytest

from aegis_shield.antitamper import AntiTamper, canonical_string, parse_signature_header, sign_request
from aegis_shield.security import InputValidator, SecurityHeadersMiddleware, security_headers
from conftest import BROWSER_HEADERS

CORE_ANTITAMPER = Path(__file__).resolve().parents[2] / "core" / "dist" / "security" / "AntiTamper.js"

validator = InputValidator()


def threats(value):
    return {f.threat for f in validator.inspect({"q": value}, "body")}


@pytest.mark.parametrize("payload,threat", [
    ("<script>alert(1)</script>", "xss"),
    ("<img src=x onerror=alert(1)>", "xss"),
    ("%3Cscript%3Ealert(1)%3C%2Fscript%3E", "xss"),
    ("' OR '1'='1", "sqli"),
    ("1 UNION SELECT username, password FROM users", "sqli"),
    ("1; DROP TABLE users", "sqli"),
    ("1' AND SLEEP(5)--", "sqli"),
    ("../../../../etc/passwd", "path_traversal"),
    ("..%252F..%252Fetc%252Fpasswd", "path_traversal"),
])
def test_detects_payloads(payload, threat):
    assert threat in threats(payload)


@pytest.mark.parametrize("text", [
    "Hello, I would like to order 2 items.",
    "Where can I buy a union jack flag?",
    "Price < 500 and > 100",
    "আমি একটি অর্ডার দিতে চাই",
    "O'Brien",
    "100%",
])
def test_benign_text_is_not_flagged(text):
    assert validator.inspect({"comment": text}, "body") == []


def test_sensitive_fields_and_pollution_keys():
    assert validator.inspect({"password": "' OR '1'='1"}, "body") == []
    found = validator.inspect(json.loads('{"__proto__": {"admin": true}}'), "body")
    assert [f.threat for f in found] == ["prototype_pollution"]


def test_analyze_parses_raw_query_strings():
    _, signals = validator.analyze("/search", b"q=1%27%20UNION%20SELECT%20pw%20FROM%20users--")
    assert dict(signals)["input:sqli"] > 50
    assert validator.analyze("/search", "q=blue+shoes")[1] == []


def test_middleware_scores_injection_in_query(base):
    clean, _ = base.evaluate("GET", "/search", "198.51.100.10", BROWSER_HEADERS, {}, "q=blue+shoes")
    attack, _ = base.evaluate("GET", "/search", "198.51.100.10", BROWSER_HEADERS, {},
                              "q=%27%20UNION%20SELECT%20password%20FROM%20users--")
    assert attack.score > clean.score
    assert "input:sqli" in attack.reason


def test_security_headers_defaults_and_overrides():
    h = security_headers()
    assert h["X-Frame-Options"] == "DENY" and "default-src 'self'" in h["Content-Security-Policy"]
    h = security_headers(hsts=False, content_security_policy=None)
    assert "Strict-Transport-Security" not in h and "Content-Security-Policy" not in h


def test_security_headers_asgi_middleware():
    fastapi = pytest.importorskip("fastapi")
    from fastapi.testclient import TestClient

    app = fastapi.FastAPI()
    app.add_middleware(SecurityHeadersMiddleware)

    @app.get("/")
    def index():
        return {"ok": True}

    res = TestClient(app).get("/")
    assert res.headers["x-content-type-options"] == "nosniff"
    assert res.headers["cross-origin-opener-policy"] == "same-origin"


SECRET = "webhook-shared-secret"


def test_antitamper_accepts_once_and_rejects_tampering():
    at = AntiTamper(SECRET)
    header = at.sign("POST", "/api/orders?id=7", '{"qty":1}')
    assert at.verify("POST", "/api/orders?id=7", '{"qty":1}', header) == (True, None)
    assert at.verify("POST", "/api/orders?id=7", '{"qty":1}', header) == (False, "replay")
    fresh = at.sign("POST", "/api/orders?id=7", '{"qty":1}')
    assert at.verify("POST", "/api/orders?id=7", '{"qty":100}', fresh) == (False, "bad_signature")
    assert at.verify("POST", "/api/orders?id=7", '{"qty":1}', fresh) == (True, None)  # bad tries don't burn nonces
    old = sign_request("POST", "/x", b"", SECRET, now=1_000_000)
    assert at.verify("POST", "/x", b"", old) == (False, "expired")
    assert at.verify("POST", "/x", b"", "garbage") == (False, "malformed")
    assert at.verify("POST", "/x", b"", None) == (False, "missing")


def test_canonical_string_matches_node_fixture():
    assert canonical_string("post", "/p", b"", 1700000000, "abcdef0123456789") == (
        "POST\n/p\n1700000000\nabcdef0123456789\n"
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
    assert parse_signature_header("t=1,n=abcdef01,s=xyz") == (1, "abcdef01", "xyz")


@pytest.mark.skipif(not shutil.which("node") or not CORE_ANTITAMPER.exists(),
                    reason="needs node and a built packages/core (npm run build -w packages/core)")
def test_signatures_interoperate_with_node_core():
    body = '{"order":"বই","qty":2}'
    script = (f"const a=require({json.dumps(str(CORE_ANTITAMPER))});"
              f"const at=new a.AntiTamper({json.dumps(SECRET)});"
              f"const req={{method:'POST',path:'/hook?x=1',body:{json.dumps(body)}}};"
              "const v=at.verify(req, process.argv[1]);"
              f"console.log(JSON.stringify({{verified:v, header:a.signRequest(req, {json.dumps(SECRET)})}}));at.destroy();")
    py_header = sign_request("POST", "/hook?x=1", body, SECRET)
    out = json.loads(subprocess.run(["node", "-e", script, py_header], capture_output=True, text=True,
                                    check=True).stdout)
    assert out["verified"] == {"valid": True}                                  # Python -> Node
    assert AntiTamper(SECRET).verify("POST", "/hook?x=1", body, out["header"]) == (True, None)  # Node -> Python

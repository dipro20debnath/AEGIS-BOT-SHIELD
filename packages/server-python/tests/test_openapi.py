"""Contract test: responses of the Python middleware against contracts/openapi.json
(the same document the Node contract test uses)."""
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

from aegis_shield import add_aegis_openapi, openapi_spec
from aegis_shield.middleware import AegisMiddlewareBase
from conftest import BROWSER_HEADERS, SECRET, SITE_KEY, telemetry_body
from test_challenge import solve

CONTRACT = Path(__file__).resolve().parents[3] / "contracts" / "openapi.json"
SPEC = json.loads(CONTRACT.read_text(encoding="utf-8"))
# Response schemas refer to "#/components/schemas/X"; they are rewritten to point into this resource
REGISTRY = Registry().with_resource(
    "openapi.json", Resource.from_contents({"components": SPEC["components"]}, default_specification=DRAFT202012))


def conforms(method: str, path: str, status: int, body) -> None:
    op = SPEC["paths"][path][method]
    res = op["responses"].get(str(status)) or op["responses"].get(f"{str(status)[0]}XX")
    assert res is not None, f"{method.upper()} {path} does not document status {status}"
    schema = res.get("content", {}).get("application/json", {}).get("schema")
    if schema is None:
        return
    schema = json.loads(json.dumps(schema).replace('"#/components/', '"openapi.json#/components/'))
    errors = sorted(Draft202012Validator(schema, registry=REGISTRY).iter_errors(body), key=str)
    assert not errors, f"{method.upper()} {path} {status}: {[e.message for e in errors]}\n{body}"


@pytest.fixture
def base():
    return AegisMiddlewareBase(SITE_KEY, SECRET, require_token_paths=["/api/login"], pow_n=1024, pow_bits=2)


def test_document_is_valid_openapi_3_1():
    from openapi_spec_validator import validate
    validate(SPEC)  # raises on any violation of the OpenAPI 3.1 specification


def test_packaged_copy_is_current():
    assert openapi_spec() == SPEC, "run: npm run sync:openapi"


def test_telemetry_responses(base):
    p = "/aegis/telemetry"
    ok = base.handle_telemetry(telemetry_body(True), "198.51.100.50", BROWSER_HEADERS, {})
    assert ok.status == 200
    conforms("post", p, ok.status, ok.body)
    for body, status in [(b"not json", 400), (telemetry_body(True, site_key="other"), 403), (b"{" + b" " * 70_000 + b"}", 413)]:
        r = base.handle_telemetry(body, "198.51.100.50", BROWSER_HEADERS, {})
        assert r.status == status
        conforms("post", p, r.status, r.body)
    limited = AegisMiddlewareBase(SITE_KEY, SECRET, rate_limit=1)
    limited.handle_telemetry(telemetry_body(True), "198.51.100.51", BROWSER_HEADERS, {})
    r = limited.handle_telemetry(telemetry_body(True), "198.51.100.51", BROWSER_HEADERS, {})
    assert r.status == 429
    conforms("post", p, r.status, r.body)


def test_challenge_responses(base):
    p = "/aegis/challenge"
    issued = base.handle_challenge("GET", b"", BROWSER_HEADERS, {})
    conforms("get", p, issued.status, issued.body)
    body = json.dumps({"challenge": issued.body["challenge"], "nonce": solve(issued.body)}).encode()
    solved = base.handle_challenge("POST", body, BROWSER_HEADERS, {})
    assert solved.status == 200
    conforms("post", p, solved.status, solved.body)
    replay = base.handle_challenge("POST", body, BROWSER_HEADERS, {})
    assert replay.status == 403
    conforms("post", p, replay.status, replay.body)


def test_denial(base):
    result, _ = base.evaluate("POST", "/api/login", "198.51.100.52", BROWSER_HEADERS, {})
    denial = base.denial(result)
    assert denial.status == 403 and denial.headers["X-Aegis-Action"] in ("block", "challenge")
    conforms("get", "/{protectedPath}", denial.status, denial.body)


def test_checker_rejects_bad_bodies():
    with pytest.raises(AssertionError):
        conforms("post", "/aegis/telemetry", 200, {"token": "x", "expiresIn": 1, "verdict": "allow"})
    with pytest.raises(AssertionError):
        conforms("get", "/aegis/challenge", 418, {})


def test_fastapi_docs_list_middleware_endpoints():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()

    @app.get("/hello")
    def hello():
        return {}

    add_aegis_openapi(app)
    doc = TestClient(app).get("/openapi.json").json()
    assert {"/hello", "/aegis/telemetry", "/aegis/challenge"} <= set(doc["paths"])
    assert "TelemetryPayload" in doc["components"]["schemas"]
    assert "/aegis/stats" not in doc["paths"]  # Node-only status API is not claimed for Python


def test_configuration_doc_lists_every_option():
    from aegis_shield.models import AegisConfig

    doc = (Path(__file__).resolve().parents[3] / "docs" / "configuration.md").read_text(encoding="utf-8")
    missing = [name for name in AegisConfig.model_fields if f"`{name}`" not in doc]
    assert missing == [], f"document these options in docs/configuration.md: {missing}"

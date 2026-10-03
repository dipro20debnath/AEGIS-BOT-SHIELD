import pytest

from aegis_shield.middleware import AegisMiddlewareBase
from conftest import BROWSER_HEADERS, CHROME_UA, SECRET, SITE_KEY, telemetry_body


def token_for(base, human=True, headers=BROWSER_HEADERS):
    """Token and session cookie from a telemetry submission (a browser sends both back)."""
    r = base.handle_telemetry(telemetry_body(human), "198.51.100.10", headers, {})
    return r.body["token"], {"aegis_sid": r.headers["Set-Cookie"].split(";")[0].split("=", 1)[1]}


def test_browser_without_token_is_allowed_on_normal_pages(base):
    result, _ = base.evaluate("GET", "/products", "198.51.100.10", BROWSER_HEADERS, {})
    assert result.action == "allow"


def test_token_required_paths_challenge_without_token(base):
    result, _ = base.evaluate("POST", "/checkout/pay", "198.51.100.10", BROWSER_HEADERS, {})
    assert result.action == "challenge"
    assert "token_required" in result.reason


def test_valid_human_token_passes_required_path(base):
    token, cookies = token_for(base)
    headers = {**BROWSER_HEADERS, "X-Aegis-Token": token}
    result, _ = base.evaluate("POST", "/checkout/pay", "198.51.100.10", headers, cookies)
    assert result.action == "allow"
    assert "telemetry_score" in result.reason
    assert result.payload["verdict"] == "allow"


def test_bot_token_carries_its_score(base):
    token, cookies = token_for(base, human=False)
    headers = {**BROWSER_HEADERS, "X-Aegis-Token": token}
    result, _ = base.evaluate("GET", "/products", "198.51.100.10", headers, cookies)
    assert result.action == "block"


def test_token_bound_to_user_agent(base):
    token, cookies = token_for(base)
    headers = {**BROWSER_HEADERS, "user-agent": CHROME_UA.replace("120.0", "121.0"), "X-Aegis-Token": token}
    result, _ = base.evaluate("POST", "/checkout", "198.51.100.10", headers, cookies)
    assert "token_user_agent_mismatch" in result.reason
    assert result.action == "challenge"


def test_token_bound_to_session(base):
    """A token copied out of one browser session into another client (same UA) is rejected."""
    token, cookies = token_for(base)
    headers = {**BROWSER_HEADERS, "X-Aegis-Token": token}
    own, _ = base.evaluate("POST", "/checkout", "198.51.100.10", headers, cookies)
    assert own.action == "allow"
    stolen, _ = base.evaluate("POST", "/checkout", "203.0.113.5", headers, {})  # no or another session
    assert "token_session_mismatch" in stolen.reason and stolen.action == "challenge"
    other_session = base.sessions.get_or_create(None).id
    stolen, _ = base.evaluate("POST", "/checkout", "203.0.113.5", headers, {"aegis_sid": other_session})
    assert "token_session_mismatch" in stolen.reason


def test_invalid_token_is_a_signal(base):
    result, _ = base.evaluate("GET", "/", "1.2.3.4", {**BROWSER_HEADERS, "X-Aegis-Token": "AEGIS.v1.x.y"}, {})
    assert "invalid_token" in result.reason


def test_monitor_mode_never_blocks():
    base = AegisMiddlewareBase(SITE_KEY, SECRET, mode="monitor", require_token_paths=["/checkout"])
    bot = base.handle_telemetry(telemetry_body(False), "1.2.3.4", BROWSER_HEADERS, {}).body
    assert bot["verdict"] == "monitor"
    result, _ = base.evaluate("POST", "/checkout", "1.2.3.4", {"user-agent": "sqlmap/1.7"}, {})
    assert result.action == "monitor"


def test_excluded_and_protected_paths():
    base = AegisMiddlewareBase(SITE_KEY, SECRET, protected_paths=["/api"])
    assert base._should_protect("/api/cart")
    assert not base._should_protect("/about")
    assert not base._should_protect("/health")


def test_fail_open_on_internal_error(base, monkeypatch):
    monkeypatch.setattr(base.analyzer, "signals", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    result, _ = base.evaluate("GET", "/", "1.2.3.4", BROWSER_HEADERS, {})
    assert result.action == "allow" and result.reason == "analysis_error"


def test_session_cookie_reused(base):
    _, headers = base.evaluate("GET", "/", "1.2.3.4", BROWSER_HEADERS, {})
    sid = headers["Set-Cookie"].split(";")[0].split("=")[1]
    _, again = base.evaluate("GET", "/b", "1.2.3.4", BROWSER_HEADERS, {"aegis_sid": sid})
    assert again == {}
    session = base.sessions.get_or_create(sid)
    assert session.request_times and len(session.paths) == 2


def test_rejects_short_secret():
    with pytest.raises(ValueError):
        AegisMiddlewareBase(SITE_KEY, "short")


# --- framework adapters --------------------------------------------------------

def test_fastapi_adapter(human_pace):
    pytest.importorskip("fastapi")
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from aegis_shield import AegisFastAPIMiddleware

    app = FastAPI()

    @app.get("/products")
    def products():
        return {"ok": True}

    @app.post("/checkout")
    def checkout():
        return {"paid": True}

    app.add_middleware(AegisFastAPIMiddleware, site_key=SITE_KEY, secret_key=SECRET, require_token_paths=["/checkout"])
    client = TestClient(app, headers=BROWSER_HEADERS)

    page = client.get("/products")
    assert page.status_code == 200 and "aegis_sid" in page.cookies
    assert client.post("/checkout").status_code == 403
    token = client.post("/aegis/telemetry", content=telemetry_body()).json()["token"]
    assert client.post("/checkout", headers={"X-Aegis-Token": token}).json() == {"paid": True}
    bot = client.post("/aegis/telemetry", content=telemetry_body(False)).json()
    blocked = client.get("/products", headers={"X-Aegis-Token": bot["token"]})
    assert blocked.status_code == 403 and blocked.json() == {"aegis": "block"}


def test_flask_adapter(human_pace):
    pytest.importorskip("flask")
    from flask import Flask
    from aegis_shield import AegisFlaskMiddleware

    app = Flask(__name__)

    @app.post("/checkout")
    def checkout():
        return {"paid": True}

    AegisFlaskMiddleware(app, site_key=SITE_KEY, secret_key=SECRET, require_token_paths=["/checkout"])
    client = app.test_client()
    denied = client.post("/checkout", headers=BROWSER_HEADERS)
    assert denied.status_code == 403 and "aegis_sid=" in denied.headers.get("Set-Cookie", "")
    r = client.post("/aegis/telemetry", data=telemetry_body(), headers=BROWSER_HEADERS)
    assert r.status_code == 200
    ok = client.post("/checkout", headers={**BROWSER_HEADERS, "X-Aegis-Token": r.get_json()["token"]})
    assert ok.status_code == 200 and ok.get_json() == {"paid": True}


def test_django_adapter(human_pace):
    pytest.importorskip("django")
    import django
    from django.conf import settings

    if not settings.configured:
        settings.configure(
            DEBUG=True, SECRET_KEY="django-test", ROOT_URLCONF=__name__, ALLOWED_HOSTS=["*"],
            MIDDLEWARE=["aegis_shield.AegisDjangoMiddleware"],
            AEGIS={"site_key": SITE_KEY, "secret_key": SECRET, "require_token_paths": ["/checkout"]},
        )
        django.setup()
    from django.test import Client

    client = Client(headers=BROWSER_HEADERS)
    denied = client.post("/checkout")
    assert denied.status_code == 403 and "aegis_sid" in denied.cookies
    r = client.post("/aegis/telemetry", data=telemetry_body(), content_type="application/json")
    assert r.status_code == 200
    ok = client.post("/checkout", headers={"X-Aegis-Token": r.json()["token"]})
    assert ok.status_code == 200 and ok.json() == {"paid": True}


def _checkout_view(request):
    from django.http import JsonResponse
    return JsonResponse({"paid": True})


def _urlpatterns():
    try:
        from django.urls import path
        return [path("checkout", _checkout_view)]
    except Exception:
        return []


urlpatterns = _urlpatterns()

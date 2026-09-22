import pytest
from aegis_shield.middleware import AegisMiddlewareBase
from aegis_shield.models import AegisResult

def test_middleware_base_init():
    middleware = AegisMiddlewareBase(
        site_key="test_site",
        secret_key="test_secret"
    )
    assert middleware.config.site_key == "test_site"
    assert middleware.config.block_threshold == 80

def test_should_protect():
    middleware = AegisMiddlewareBase(
        site_key="test_site",
        secret_key="test_secret",
        excluded_paths=["/api/public"]
    )
    assert middleware._should_protect("/api/private") == True
    assert middleware._should_protect("/api/public/data") == False
    assert middleware._should_protect("/health") == False

def test_analyze_request_missing_token():
    middleware = AegisMiddlewareBase(
        site_key="test_site",
        secret_key="test_secret"
    )
    
    result = middleware._analyze_request(
        ip="127.0.0.1",
        headers={"user-agent": "test-agent", "host": "localhost", "accept": "*/*"},
        method="GET",
        path="/",
        token=None
    )
    
    assert isinstance(result, AegisResult)
    assert result.score >= 50
    assert "missing_aegis_token" in result.reason

def test_analyze_request_bot_ua():
    middleware = AegisMiddlewareBase(
        site_key="test_site",
        secret_key="test_secret"
    )
    
    result = middleware._analyze_request(
        ip="127.0.0.1",
        headers={"user-agent": "googlebot", "host": "localhost", "accept": "*/*"},
        method="GET",
        path="/",
        token=None
    )
    
    assert result.action == "block"
    assert "known_bot:googlebot" in result.reason

import pytest
from aegis.config import AegisConfig
from aegis.verifier import TokenVerifier
from aegis.models import ProtectionMode

def test_config_initialization():
    config = AegisConfig(secret_key="test_secret")
    assert config.secret_key == "test_secret"
    assert config.protection_mode == ProtectionMode.ENFORCE

def test_config_requires_secret():
    with pytest.raises(ValueError):
        AegisConfig(secret_key="")

def test_token_verifier():
    verifier = TokenVerifier("test_secret")
    # Will fail with invalid token
    result = verifier.verify("invalid.token.here", "127.0.0.1")
    assert not result.valid
    assert result.verdict == "block"

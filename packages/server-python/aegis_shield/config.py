import os
from typing import Any, Dict


def get_config() -> Dict[str, Any]:
    """Middleware keyword arguments from AEGIS_* environment variables."""
    config: Dict[str, Any] = {
        "site_key": os.getenv("AEGIS_SITE_KEY", ""),
        "secret_key": os.getenv("AEGIS_SECRET_KEY", ""),
        "mode": os.getenv("AEGIS_MODE", "enforce"),
        "block_threshold": int(os.getenv("AEGIS_BLOCK_THRESHOLD", "80")),
        "challenge_threshold": int(os.getenv("AEGIS_CHALLENGE_THRESHOLD", "50")),
        "fail_open": os.getenv("AEGIS_FAIL_OPEN", "true").lower() == "true",
    }
    if os.getenv("AEGIS_ML_MODEL_PATH"):
        config["ml_model_path"] = os.environ["AEGIS_ML_MODEL_PATH"]
    if os.getenv("AEGIS_ML_URL"):
        config["ml_url"] = os.environ["AEGIS_ML_URL"]
    if os.getenv("AEGIS_TRUSTED_PROXIES"):
        config["trusted_proxies"] = [p.strip() for p in os.environ["AEGIS_TRUSTED_PROXIES"].split(",") if p.strip()]
    return config

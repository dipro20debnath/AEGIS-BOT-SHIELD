"""
FastAPI app for load tests: uvicorn python_server:app --app-dir loadtest --port 3301
Env: AEGIS=on|off, AEGIS_REDIS_URL, AEGIS_ML_MODEL_PATH. Trusts X-Forwarded-For
from localhost so the generator can simulate many clients. Not a deployment template.
"""
import os

from fastapi import FastAPI

from aegis_shield import AegisFastAPIMiddleware

app = FastAPI()
if os.getenv("AEGIS", "on") != "off":
    app.add_middleware(
        AegisFastAPIMiddleware, site_key="load-site", secret_key="load-test-secret-0123456789", mode="monitor",
        trusted_proxies=["127.0.0.1"], redis_url=os.getenv("AEGIS_REDIS_URL"),
        ml_model_path=os.getenv("AEGIS_ML_MODEL_PATH"), rate_limit=600,
    )


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/page")
def page():
    return {"ok": True, "items": [1, 2, 3]}

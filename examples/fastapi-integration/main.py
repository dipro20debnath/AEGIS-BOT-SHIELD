"""
AEGIS BOT SHIELD - FastAPI example.

    npm run build -w packages/js-sdk          # builds packages/js-sdk/dist/aegis.min.js
    pip install -e packages/server-python fastapi uvicorn
    AEGIS_SECRET_KEY=$(python -c "import secrets; print(secrets.token_hex(16))") \
        uvicorn main:app --app-dir examples/fastapi-integration --port 8000

Open http://localhost:8000 and log in with demo / demo. The page loads the
SDK, which posts telemetry to /aegis/telemetry (answered by the middleware)
and adds the returned token to the login request. /api/login requires a
valid token, so a plain `curl -X POST /api/login` is challenged.
Set AEGIS_ML_MODEL_PATH to a trained model to add ML scoring.
"""
import json
import os
import threading
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from aegis_shield import AegisFastAPIMiddleware, add_aegis_openapi, get_config

SDK_DIST = Path(__file__).resolve().parents[2] / "packages" / "js-sdk" / "dist"

config = get_config()
config["site_key"] = config["site_key"] or "demo-site"
config["secret_key"] = config["secret_key"] or os.urandom(16).hex()

# AEGIS_RECORD_FILE=decisions.jsonl: append every scored telemetry record (features,
# signals, score) for analysis, e.g. the bot tests in bots/. No IPs or user agents.
_record_lock = threading.Lock()


def _record(record):
    with _record_lock, open(os.environ["AEGIS_RECORD_FILE"], "a", encoding="utf-8") as f:
        f.write(json.dumps(record) + "\n")


app = FastAPI(title="AEGIS BOT SHIELD - FastAPI Example")
app.add_middleware(
    AegisFastAPIMiddleware,
    **config,
    on_record=_record if os.getenv("AEGIS_RECORD_FILE") else None,
    require_token_paths=["/api/login"],
    excluded_paths=["/health", "/sdk", "/docs", "/openapi.json"],
)
# /docs also lists the endpoints the middleware answers (/aegis/telemetry, /aegis/challenge)
add_aegis_openapi(app)
if SDK_DIST.exists():
    app.mount("/sdk", StaticFiles(directory=SDK_DIST), name="sdk")

PAGE = """<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>AEGIS demo login</title></head>
<body>
  <h1>Demo login</h1>
  <form id="login">
    <label>Username <input name="username" autocomplete="username"></label>
    <label>Password <input name="password" type="password" autocomplete="current-password"></label>
    <button type="submit">Log in</button>
  </form>
  <p id="result" role="status"></p>
  <script src="/sdk/aegis.min.js" data-site-key="{site_key}"></script>
  <script>
    document.getElementById('login').addEventListener('submit', async (event) => {{
      event.preventDefault();
      const form = new FormData(event.target);
      const response = await fetch('/api/login', {{
        method: 'POST',
        headers: {{ 'Content-Type': 'application/json' }},
        body: JSON.stringify({{ username: form.get('username'), password: form.get('password') }}),
      }});
      const body = await response.json();
      document.getElementById('result').textContent = response.status + ' ' + JSON.stringify(body);
    }});
  </script>
</body>
</html>"""


class LoginRequest(BaseModel):
    username: str
    password: str


@app.get("/", response_class=HTMLResponse)
def index():
    return PAGE.format(site_key=config["site_key"])


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/login")
def login(credentials: LoginRequest, request: Request):
    aegis = request.scope["state"]["aegis"]
    if credentials.username == "demo" and credentials.password == "demo":
        return {"success": True, "aegis_score": aegis.score}
    raise HTTPException(status_code=401, detail="Invalid credentials")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)

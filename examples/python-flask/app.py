"""
AEGIS BOT SHIELD - Flask example.

    npm run build -w packages/js-sdk
    pip install -e packages/server-python flask
    AEGIS_SECRET_KEY=... flask --app examples/python-flask/app.py run

The middleware answers /aegis/telemetry for the SDK and requires a valid
token on /login.
"""
import os
from pathlib import Path

from flask import Flask, g, jsonify, request, send_from_directory

from aegis_shield import AegisFlaskMiddleware, get_config

SDK_DIST = Path(__file__).resolve().parents[2] / "packages" / "js-sdk" / "dist"

config = get_config()
config["site_key"] = config["site_key"] or "demo-site"
config["secret_key"] = config["secret_key"] or os.urandom(16).hex()

app = Flask(__name__)
AegisFlaskMiddleware(app, **config, require_token_paths=["/login"], excluded_paths=["/health", "/sdk"])


@app.route("/")
def index():
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>AEGIS Flask demo</title></head>
<body><form id="f"><input name="username"><input name="password" type="password"><button>Log in</button></form>
<p id="out"></p>
<script src="/sdk/aegis.min.js" data-site-key="{config['site_key']}"></script>
<script>
document.getElementById('f').onsubmit = async (e) => {{
  e.preventDefault();
  const r = await fetch('/login', {{method: 'POST', body: new FormData(e.target)}});
  document.getElementById('out').textContent = r.status + ' ' + await r.text();
}};
</script></body></html>"""


@app.route("/sdk/<path:name>")
def sdk(name):
    return send_from_directory(SDK_DIST, name)


@app.route("/health")
def health():
    return jsonify({"status": "healthy"})


@app.route("/login", methods=["POST"])
def login():
    if request.form.get("username") == "demo" and request.form.get("password") == "demo":
        return jsonify({"success": True, "aegis_score": g.aegis.score})
    return jsonify({"success": False}), 401

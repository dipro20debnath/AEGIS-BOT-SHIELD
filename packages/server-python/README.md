# Aegis Bot Shield - Python SDK

Middleware for Django, Flask and FastAPI/Starlette.

## How it works

1. The browser SDK (`packages/js-sdk`, `aegis.min.js`) collects behavioural
   telemetry and POSTs it to `/aegis/telemetry`. The middleware answers this
   endpoint itself: it adds server-side session and network features, scores
   the 50-feature vector (rules, plus the ML model if configured), and returns
   a signed token (`AEGIS.v1...`, AES-256-GCM + HMAC-SHA256, same format as the
   Node core) carrying the score and bound to the user agent.
2. The SDK adds the token as `X-Aegis-Token` to the site's own requests.
3. On every protected request the middleware verifies the token and combines
   its score with request-level signals (user agent, headers) using noisy-OR,
   then allows, challenges (403 `{"aegis": "challenge"}`) or blocks.

Paths in `require_token_paths` (e.g. login, checkout) are challenged when
there is no valid token; elsewhere a missing token is not penalised, so first
page loads, API clients and search engines are not blocked by default.

## Usage (FastAPI)

```python
from fastapi import FastAPI
from aegis_shield import AegisFastAPIMiddleware

app = FastAPI()
app.add_middleware(
    AegisFastAPIMiddleware,
    site_key="your_site_key",
    secret_key="at-least-16-characters-secret",
    require_token_paths=["/api/login", "/api/checkout"],
    ml_model_path="models/bot_classifier.pkl",  # optional
)
```

```html
<script src="/sdk/aegis.min.js" data-site-key="your_site_key"></script>
```

Flask: `AegisFlaskMiddleware(app, site_key=..., secret_key=...)`.
Django: add `"aegis_shield.AegisDjangoMiddleware"` to `MIDDLEWARE` and set
`AEGIS = {"site_key": ..., "secret_key": ...}` in settings.

Full examples: `examples/fastapi-integration`, `examples/python-flask`.

## Options

| Option | Default | Meaning |
|--------|---------|---------|
| `mode` | `enforce` | `monitor` never blocks (verdict `monitor`) |
| `require_token_paths` | `[]` | Path prefixes that need a valid token |
| `protected_paths` / `excluded_paths` | all / `/health`, `/favicon.ico` | Which paths are analysed |
| `block_threshold` / `challenge_threshold` | 80 / 50 | Risk score cut-offs (0-100) |
| `token_ttl` | 300 | Token lifetime (s) |
| `ml_model_path` / `ml_url` | none | Local model pickle or ML service URL |
| `trusted_proxies` | `[]` | Proxies whose `X-Forwarded-For` is trusted |
| `verify_search_engines` | `False` | Confirm Googlebot/Bingbot via reverse DNS (blocking lookups) |
| `on_record` | none | Callback receiving each scored telemetry record (no IP or UA) |

## Tests

```bash
pip install -e "packages/server-python[test]"
pytest packages/server-python/tests
```

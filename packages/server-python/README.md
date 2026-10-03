# aegis-server-python (`aegis_shield`)

Reference server middleware of [AEGIS BOT SHIELD](https://github.com/dipro20debnath/AEGIS-BOT-SHIELD/blob/main/README.md) for
FastAPI/Starlette, Flask and Django.

## How it works

1. The browser SDK (`aegis.min.js`) collects behavioural statistics and posts
   them to `/aegis/telemetry`. The middleware answers this endpoint itself: it
   adds session and network features, scores the 50-feature vector (rules,
   plus the ML model if configured) and returns a token (`AEGIS.v1…`,
   AES-256-GCM + HMAC-SHA256, same format as the Node server) bound to the
   user agent and the `aegis_sid` session.
2. The SDK adds the token as `X-Aegis-Token` to the site's own requests.
3. On every protected request the middleware fuses the token's score with
   request-level signals (headers, IP, input patterns, session patterns,
   rate limits) by noisy-OR, then allows, challenges (`403 {"aegis": "challenge"}`)
   or blocks. A challenge is answered by a memory-hard proof of work.

Paths in `require_token_paths` (login, checkout, …) need a token backed by
telemetry; elsewhere a missing token is not penalised.

## Usage (FastAPI)

```bash
pip install "aegis-server-python[fastapi]"          # [flask], [django]; [redis] for several workers
```

```python
import os
from fastapi import FastAPI
from aegis_shield import AegisFastAPIMiddleware, add_aegis_openapi

app = FastAPI()
app.add_middleware(
    AegisFastAPIMiddleware,
    site_key="my-site",
    secret_key=os.environ["AEGIS_SECRET_KEY"],   # >= 16 characters
    mode="monitor",                              # "enforce" after reviewing decisions
    require_token_paths=["/api/login", "/api/checkout"],
    redis_url=os.environ.get("AEGIS_REDIS_URL"), # shared state for several workers
)
add_aegis_openapi(app)                           # /docs lists the AEGIS endpoints
```

```html
<script src="/static/aegis.min.js" data-site-key="my-site"></script>
```

Flask: `AegisFlaskMiddleware(app, site_key=..., secret_key=...)`.
Django: add `"aegis_shield.AegisDjangoMiddleware"` to `MIDDLEWARE` and set
`AEGIS = {"site_key": ..., "secret_key": ...}`.

## Documentation

- [Getting started](https://github.com/dipro20debnath/AEGIS-BOT-SHIELD/blob/main/docs/getting-started.md)
- [All options](https://github.com/dipro20debnath/AEGIS-BOT-SHIELD/blob/main/docs/configuration.md#python-server-aegis_shield) and environment variables
- [Integration guide](https://github.com/dipro20debnath/AEGIS-BOT-SHIELD/blob/main/docs/INTEGRATION_GUIDE.md) (proxies, CORS, Redis, edge, rollout)
- [HTTP API (OpenAPI)](https://github.com/dipro20debnath/AEGIS-BOT-SHIELD/blob/main/contracts/openapi.json)
- [Security model and limits](https://github.com/dipro20debnath/AEGIS-BOT-SHIELD/blob/main/docs/security-whitepaper.md)

## Tests

```bash
pip install -e "packages/server-python[test]"
pytest packages/server-python/tests        # AEGIS_TEST_REDIS_URL=redis://... adds the live-Redis cases
```

Python ≥ 3.9 (tested on 3.10–3.12). MIT licence.

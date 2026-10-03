# Getting started

AEGIS is self-hosted: there is no account, API key or cloud service. You run
the server middleware in your own backend and serve the browser SDK from your
own site. The packages are not published to npm or PyPI yet; install them
from this repository.

**You need:** Node.js ≥ 22.12 and/or Python ≥ 3.9 (CI tests 3.10–3.12), or
just Docker.

---

## 1. See it working (5 minutes)

### With Docker

```bash
git clone https://github.com/dipro20debnath/AEGIS-BOT-SHIELD.git && cd AEGIS-BOT-SHIELD
cp .env.example .env
python -c "import secrets; print('AEGIS_SECRET_KEY=' + secrets.token_hex(32))" >> .env
docker compose up --build
```

- http://localhost:8000: FastAPI demo, log in with `demo` / `demo`
- http://localhost:3000: Express demo, log in with `admin` / `password`
- http://localhost:8080: dashboard (updates live while you use :3000)
- http://localhost:3000/aegis/docs: API documentation (Swagger UI)

### Without Docker

```bash
npm install && npm run build                     # SDK, Node server, dashboard
pip install -e packages/ml-engine -e "packages/server-python[fastapi]" uvicorn
python e2e/train_model.py model.pkl              # small synthetic-data model (optional)

AEGIS_SECRET_KEY=$(python -c "import secrets; print(secrets.token_hex(32))") \
AEGIS_ML_MODEL_PATH=model.pkl \
  uvicorn main:app --app-dir examples/fastapi-integration --port 8000
```

### Check that it protects

```bash
# A script without a token is challenged on the login API:
curl -s -X POST localhost:8000/api/login -H 'content-type: application/json' -d '{"username":"demo","password":"demo"}'
# → {"aegis":"challenge","telemetry":"/aegis/telemetry","challenge":"/aegis/challenge"}
```

In a normal browser the login works: the SDK on the page sends telemetry,
receives a token and adds it to the login request. A default headless
browser is denied already at the first page load.

---

## 2. Protect your own site

### Step 1: add the SDK to your pages

Build it once (`npm run build -w packages/js-sdk`) and serve
`packages/js-sdk/dist/aegis.min.js` from your site:

```html
<script src="/sdk/aegis.min.js" data-site-key="my-site"></script>
```

The SDK starts collecting, posts telemetry to `/aegis/telemetry` on your own
origin, and adds `X-Aegis-Token` to your page's `fetch`/XHR calls. If your
API is on another origin, see `endpoint` and `allowedOrigins` in
[configuration.md](configuration.md#browser-sdk-aegisjs-sdk).

### Step 2a: Python backend (FastAPI shown; Flask and Django in the [integration guide](INTEGRATION_GUIDE.md))

```bash
pip install -e "path/to/AEGIS-BOT-SHIELD/packages/server-python[fastapi]"
```

```python
import os

from fastapi import FastAPI
from aegis_shield import AegisFastAPIMiddleware, add_aegis_openapi

app = FastAPI()
app.add_middleware(
    AegisFastAPIMiddleware,
    site_key="my-site",
    secret_key=os.environ["AEGIS_SECRET_KEY"],
    mode="monitor",                         # start by observing
    require_token_paths=["/api/login", "/api/checkout"],
)
add_aegis_openapi(app)                      # /docs lists the AEGIS endpoints too
```

### Step 2b: Node backend (Express shown)

```bash
npm install path/to/AEGIS-BOT-SHIELD/packages/core path/to/AEGIS-BOT-SHIELD/packages/server-node
```

```javascript
const express = require('express');
const { aegisExpress } = require('@aegis/server-node');

const app = express();
app.use(express.json());
app.use(aegisExpress({
  siteKey: 'my-site',
  secretKey: process.env.AEGIS_SECRET_KEY,
  mode: 'monitor',
  requireTokenPaths: ['/api/login', '/api/checkout'],
}));
```

### Step 3: observe, then enforce

1. Run in `monitor` mode for a few days. Every request is scored; nothing is
   denied. Look at the decisions: `request.state.aegis` (FastAPI),
   `req.aegis` (Express), or the dashboard and `/aegis/events` (Node).
2. Check for real users scored above your thresholds (false positives). Adjust
   `block_threshold`/`challenge_threshold`, `excluded_paths`, or your
   `trusted_proxies` (behind a proxy every client otherwise shares one IP).
3. Switch to `mode="enforce"`.

### Step 4 (production)

- Put the status API behind authentication.
- Several processes or servers: configure Redis (`AEGIS_REDIS_URL`).
- Read the [deployment checklist](security-whitepaper.md#6-deployment-checklist).

---

## Where next

| Topic | Document |
|---|---|
| All options | [configuration.md](configuration.md) |
| Framework-specific setup, proxies, edge, scaling | [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) |
| HTTP endpoints and library APIs | [API_REFERENCE.md](API_REFERENCE.md), `contracts/openapi.json` |
| How detection works | [architecture.md](architecture.md) |
| The ML model | [ML_MODEL_GUIDE.md](ML_MODEL_GUIDE.md) |
| Threat model and limits | [security-whitepaper.md](security-whitepaper.md) |

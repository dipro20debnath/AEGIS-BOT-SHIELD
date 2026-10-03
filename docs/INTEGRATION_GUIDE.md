# Integration guide

How to add AEGIS to an application, framework by framework, and how to run
it behind proxies, at the edge and on several servers. Start with
[getting-started.md](getting-started.md) if you have not run the demo yet.
All options: [configuration.md](configuration.md).

- [How the pieces fit](#how-the-pieces-fit)
- [Browser SDK](#browser-sdk)
- [Python: FastAPI, Flask, Django](#python-fastapi-flask-django)
- [Node: Express, Fastify, plain http](#node-express-fastify-plain-http)
- [Reading the decision in your code](#reading-the-decision-in-your-code)
- [API on another origin](#api-on-another-origin)
- [Behind a reverse proxy or CDN](#behind-a-reverse-proxy-or-cdn)
- [Several processes or servers](#several-processes-or-servers)
- [Cloudflare Worker in front](#cloudflare-worker-in-front)
- [ML scoring](#ml-scoring)
- [Server-to-server calls and webhooks](#server-to-server-calls-and-webhooks)
- [Rolling out safely](#rolling-out-safely)

---

## How the pieces fit

1. The page loads the SDK, which collects behaviour statistics.
2. The SDK posts them to `POST /aegis/telemetry` on your server. The AEGIS
   middleware answers this itself: it scores the telemetry and returns a token
   and an `aegis_sid` session cookie.
3. The SDK adds `X-Aegis-Token` to your page's own `fetch`/XHR requests.
4. On every protected request the middleware fuses the token's score with
   request-level signals and decides `allow`, `monitor`, `challenge` or `block`.
5. On `challenge` (HTTP 403) the SDK solves a proof of work
   (`/aegis/challenge`) and retries once.

The token is bound to the browser's user agent **and** to its session
cookie: a token copied into another client is ignored.

---

## Browser SDK

Build once with `npm run build -w packages/js-sdk`, serve
`packages/js-sdk/dist/aegis.min.js` from your site (there is no public CDN):

```html
<script src="/static/aegis.min.js" data-site-key="YOUR_SITE_KEY"></script>
```

Manual control, e.g. for forms that do not use `fetch`:

```html
<script src="/static/aegis.min.js"></script>
<script>
  const aegis = new Aegis.AegisClient({ siteKey: 'YOUR_SITE_KEY', autoIntercept: false });
  document.querySelector('#login').addEventListener('submit', async (event) => {
    event.preventDefault();
    const token = await aegis.getToken();       // sends telemetry first if needed
    await fetch('/api/login', { method: 'POST', headers: { 'X-Aegis-Token': token }, body: new FormData(event.target) });
  });
  aegis.on('token', (r) => console.debug('verdict', r.verdict, 'score', r.score));
</script>
```

Classic HTML form posts (no JavaScript `fetch`) cannot carry a header. Either
submit with `fetch` as above, or leave such paths out of
`require_token_paths` and rely on the request-level signals there.

Content Security Policy: allow the script's origin, `connect-src` to your
AEGIS server, and `'wasm-unsafe-eval'` for the fast proof-of-work solver.

---

## Python: FastAPI, Flask, Django

```bash
pip install -e "path/to/AEGIS-BOT-SHIELD/packages/server-python[fastapi]"   # or [flask], [django]; add [redis] for Redis
```

**FastAPI / Starlette**

```python
from fastapi import FastAPI, Request
from aegis_shield import AegisFastAPIMiddleware, add_aegis_openapi, get_config

app = FastAPI()
app.add_middleware(
    AegisFastAPIMiddleware,
    **get_config(),                              # AEGIS_SITE_KEY, AEGIS_SECRET_KEY, AEGIS_MODE, ...
    require_token_paths=["/api/login", "/api/checkout"],
    excluded_paths=["/health", "/static", "/docs", "/openapi.json"],
)
add_aegis_openapi(app)                           # /docs also lists /aegis/telemetry and /aegis/challenge

@app.post("/api/login")
def login(request: Request):
    decision = request.state.aegis               # AegisResult
    ...
```

**Flask**

```python
from flask import Flask, g
from aegis_shield import AegisFlaskMiddleware, get_config

app = Flask(__name__)
AegisFlaskMiddleware(app, **get_config(), require_token_paths=["/login"])

@app.post("/login")
def login():
    if g.aegis.score > 30:
        ...                                      # e.g. require a second factor
```

**Django** (`settings.py`)

```python
MIDDLEWARE = ["aegis_shield.AegisDjangoMiddleware", *MIDDLEWARE]
AEGIS = {"site_key": "...", "secret_key": env("AEGIS_SECRET_KEY"), "require_token_paths": ["/accounts/login/"]}
# in a view: request.aegis.action, request.aegis.score
```

Put the AEGIS middleware early in the chain, so denied requests do not reach
your views.

---

## Node: Express, Fastify, plain http

```bash
npm install path/to/AEGIS-BOT-SHIELD/packages/core path/to/AEGIS-BOT-SHIELD/packages/server-node
```

**Express**

```javascript
const express = require('express');
const { AegisNode, aegisExpress, aegisRoutes, attachLiveFeed, createRedisStore } = require('@aegis/server-node');

async function main() {
  const aegis = new AegisNode({
    siteKey: process.env.AEGIS_SITE_KEY,
    secretKey: process.env.AEGIS_SECRET_KEY,
    requireTokenPaths: ['/api/login'],
    excludedPaths: ['/health', '/static', '/aegis/'],
    store: process.env.AEGIS_REDIS_URL ? await createRedisStore(process.env.AEGIS_REDIS_URL) : undefined,
  });

  const app = express();
  app.use(express.json());
  app.use(aegisExpress(aegis.options, aegis));    // answers /aegis/telemetry and /aegis/challenge itself
  app.use('/aegis', requireAdmin);                // everything else under /aegis: admins only
  app.use(aegisRoutes(aegis));                    // status API, GraphQL, /aegis/docs
  app.post('/api/login', (req, res) => res.json({ score: req.aegis.score }));

  const server = app.listen(3000);
  attachLiveFeed(server, aegis, { authorize: (req) => isAdmin(req) });
}
main();
```

`requireAdmin`/`isAdmin` stand for your own authentication.

**Fastify**

```javascript
const { aegisFastify } = require('@aegis/server-node/dist/middleware/fastify');
await fastify.register(aegisFastify, { siteKey: '...', secretKey: '...', requireTokenPaths: ['/api/login'] });
// in a route: request.aegis
```

**Plain `http` / Connect**

```javascript
const { aegisGeneric } = require('@aegis/server-node');
const aegis = aegisGeneric({ siteKey: '...', secretKey: '...' });
http.createServer((req, res) => aegis(req, res, () => handle(req, res))).listen(3000);
```

---

## Reading the decision in your code

| Framework | Where | Fields |
|---|---|---|
| FastAPI/Starlette | `request.state.aegis` | `action`, `score`, `reason` (comma-separated signals), `payload` (token claims), `session_id` |
| Flask | `g.aegis` | same |
| Django | `request.aegis` | same |
| Express/Fastify | `req.aegis` / `request.aegis` | `verdict`, `score`, `reasons[]`, `claims`, `signals[]` |

Use it for graded responses instead of hard blocks: add a second factor or
a rate limit for a medium score, hold an order for review, hide a discount.

Denied requests (enforce mode) never reach your handler:
`403 {"aegis": "challenge" | "block", ...}` with `X-Aegis-Action`.

---

## API on another origin

Same origin (page and API on one host) needs nothing extra. If the API is on
another origin:

1. SDK: `endpoint: 'https://api.example.com'`, `allowedOrigins: ['https://api.example.com']`.
2. Your requests to the API must send cookies: `fetch(url, { credentials: 'include' })`.
   Tokens are bound to the `aegis_sid` session cookie; without it the token
   is ignored (`token_session_mismatch`).
3. API CORS: allow the page origin (not `*`), `Access-Control-Allow-Credentials: true`,
   and the request header `X-Aegis-Token`.
4. The page and the API must be **same-site** (e.g. `www.example.com` and
   `api.example.com`). The session cookie is `SameSite=Lax`, so browsers do
   not send it to a different site; fully cross-site APIs are not supported yet.

---

## Behind a reverse proxy or CDN

Without configuration every client appears with the proxy's IP: per-IP rate
limits then hit all users at once, and IP signals are meaningless.

- Python: `trusted_proxies=["10.0.0.0/8", "127.0.0.1"]` (or `AEGIS_TRUSTED_PROXIES`).
  `X-Forwarded-For` is honoured only from these addresses.
- Express: `app.set('trust proxy', <your proxy addresses>)`; never `true`
  on a server reachable directly, or clients can spoof their IP.
- Cloudflare: trust only Cloudflare's published ranges, or use
  `CF-Connecting-IP` via your framework's proxy settings.

---

## Several processes or servers

Without shared state each process has its own replay protection, rate
limits and sessions, which is wrong once a load balancer spreads one client
over several processes. Configure Redis:

```bash
pip install "aegis-server-python[redis]"
AEGIS_REDIS_URL=redis://redis:6379/0 uvicorn app:app --workers 4
```

```javascript
const aegis = new AegisNode({ ..., store: await createRedisStore(process.env.AEGIS_REDIS_URL) });
```

One Redis database (or key prefix) per site. Measured overhead and scaling:
[README, Performance](../README.md#performance-load-test).

---

## Cloudflare Worker in front

`packages/edge-cloudflare` checks tokens and rate limits before requests
reach your origin. Same secret as the origin:

```bash
cd packages/edge-cloudflare
npx wrangler secret put AEGIS_SECRET_KEY
# wrangler.toml: remove AEGIS_ORIGIN and add routes = [{ pattern = "example.com/*", zone_name = "example.com" }]
npx wrangler deploy
```

The ML model, telemetry and challenge stay at the origin; the origin still
verifies every token. See [configuration.md](configuration.md#edge-worker-cloudflare).

---

## ML scoring

| Server | How |
|---|---|
| Python | `ml_model_path="model.pkl"` (in-process) or `ml_url="http://ml:8001"` |
| Node | `mlUrl: 'http://ml:8001'` (run `uvicorn aegis_ml.server:app --port 8001` with `MODEL_PATH`) |

Train a model: [ML_MODEL_GUIDE.md](ML_MODEL_GUIDE.md). Without a model the
rules alone decide. The bundled training data is synthetic; retrain on your
own labelled traffic before relying on the model.

---

## Server-to-server calls and webhooks

Browsers cannot hold a secret, so tokens are for browsers. For calls between
your own services, sign requests:

```python
from aegis_shield import AntiTamper
signer = AntiTamper(SECRET)
headers = {"X-Aegis-Signature": signer.sign("POST", "/hooks/order", body)}
ok, reason = AntiTamper(SECRET, store=store).verify("POST", "/hooks/order", body, request_header)
```

```javascript
app.post('/hooks/order', express.raw({ type: '*/*' }), aegisRequireSignature(process.env.HOOK_SECRET, 300, store), handler);
```

---

## Rolling out safely

1. Deploy in `monitor` mode. Nothing is denied.
2. Watch the dashboard or `/aegis/events` for a few days; look at real users
   with high scores and at the `reasons`.
3. Fix configuration first (proxies, excluded paths such as health checks
   and static files, partner integrations calling your API).
4. Switch to `enforce`; keep `require_token_paths` to the endpoints worth
   protecting (login, sign-up, checkout, search).
5. Keep the status API private, and re-check after browser updates (new
   versions change fingerprints and headers).

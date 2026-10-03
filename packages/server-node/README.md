# @aegis/server-node

[AEGIS BOT SHIELD](https://github.com/dipro20debnath/AEGIS-BOT-SHIELD/blob/main/README.md) middleware for Express, Fastify and plain
Node `http`. It answers the browser SDK's telemetry and proof-of-work
endpoints, verifies tokens, and decides `allow` / `challenge` / `block`
per request. Also: a status API (REST, read-only GraphQL, OpenAPI with
Swagger UI) and a WebSocket live feed for the dashboard.

```js
const express = require('express');
const { aegisExpress } = require('@aegis/server-node');

const app = express();
app.use(express.json());
app.use(aegisExpress({
  siteKey: 'my-site',
  secretKey: process.env.AEGIS_SECRET_KEY,   // >= 16 characters, same on every instance
  mode: 'monitor',                           // switch to 'enforce' after reviewing decisions
  requireTokenPaths: ['/api/login'],
}));
app.post('/api/login', (req, res) => res.json({ score: req.aegis.score }));
```

Several instances: `store: await createRedisStore(process.env.AEGIS_REDIS_URL)`.

- Getting started: [getting-started.md](https://github.com/dipro20debnath/AEGIS-BOT-SHIELD/blob/main/docs/getting-started.md)
- Integration (Fastify, http, proxies, CORS, Redis, edge): [INTEGRATION_GUIDE.md](https://github.com/dipro20debnath/AEGIS-BOT-SHIELD/blob/main/docs/INTEGRATION_GUIDE.md)
- Options: [configuration.md](https://github.com/dipro20debnath/AEGIS-BOT-SHIELD/blob/main/docs/configuration.md#node-server-aegisnode)
- HTTP API: [openapi.json](https://github.com/dipro20debnath/AEGIS-BOT-SHIELD/blob/main/contracts/openapi.json)

The browser SDK is [`@aegis/js-sdk`](https://www.npmjs.com/package/@aegis/js-sdk).
Node.js ≥ 22. MIT licence.

/**
 * AEGIS BOT SHIELD - Express example.
 *
 *   npm install && npm run build -w packages/core -w packages/js-sdk -w packages/server-node
 *   AEGIS_SECRET_KEY=$(node -e "console.log(require('crypto').randomBytes(16).toString('hex'))") \
 *     node examples/express-integration/server.js
 *
 * Open http://localhost:3000 (login: admin / password). The SDK posts
 * telemetry to /aegis/telemetry (answered by the middleware) and adds the
 * returned token to the login request; /api/login requires that token.
 * Status API: /aegis/stats, /aegis/events, /aegis/graphql and the WebSocket
 * feed /aegis/live (protect these in production).
 *
 * Several instances behind a load balancer: set AEGIS_REDIS_URL
 * (e.g. redis://localhost:6379/0) so replay protection, rate limits and
 * sessions are shared through Redis.
 */
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { AegisNode, aegisExpress, aegisRoutes, attachLiveFeed, createRedisStore } = require('../../packages/server-node/dist');

const PORT = process.env.PORT || 3000;

async function main() {
  const store = process.env.AEGIS_REDIS_URL ? await createRedisStore(process.env.AEGIS_REDIS_URL) : undefined;
  const aegis = new AegisNode({
    siteKey: process.env.AEGIS_SITE_KEY || 'demo-site',
    secretKey: process.env.AEGIS_SECRET_KEY || crypto.randomBytes(16).toString('hex'),
    requireTokenPaths: ['/api/login'],
    // the status API under /aegis/ is not analysed (telemetry is handled before this check)
    excludedPaths: ['/health', '/sdk', '/aegis/'],
    mlUrl: process.env.AEGIS_ML_URL, // optional: packages/ml-engine service
    store, // optional: shared state in Redis
  });

  const app = express();
  app.use(express.json());
  app.use(aegisExpress(aegis.options, aegis));
  app.use(aegisRoutes(aegis)); // REST + GraphQL (/aegis/graphql)
  app.use('/sdk', express.static(path.resolve(__dirname, '../../packages/js-sdk/dist')));
  app.use(express.static(path.resolve(__dirname, '../html-basic')));

  app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === 'password') {
      res.json({ success: true, message: `Welcome, human! (risk score ${req.aegis.score})` });
    } else {
      res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }
  });

  const server = app.listen(PORT, () =>
    console.log(`AEGIS Express example on http://localhost:${PORT}${store ? ' (state in Redis)' : ''}`));
  attachLiveFeed(server, aegis); // WebSocket feed for the dashboard: ws://localhost:3000/aegis/live
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

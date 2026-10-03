/**
 * Express app for load tests. Env: PORT, AEGIS=on|off, AEGIS_REDIS_URL,
 * AEGIS_ML_URL. Trusts X-Forwarded-For from localhost so the generator can
 * simulate many clients. Not a deployment template (see examples/).
 */
const express = require('express');
const { AegisNode, aegisExpress, createRedisStore } = require('../packages/server-node/dist');

(async () => {
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(express.json());
  let aegis;
  if (process.env.AEGIS !== 'off') {
    const store = process.env.AEGIS_REDIS_URL ? await createRedisStore(process.env.AEGIS_REDIS_URL) : undefined;
    aegis = new AegisNode({
      siteKey: 'load-site', secretKey: 'load-test-secret-0123456789', mode: 'monitor',
      excludedPaths: ['/health'], mlUrl: process.env.AEGIS_ML_URL, mlTimeoutMs: 2000, store,
    });
    app.use(aegisExpress(aegis.options, aegis));
  }
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.get('/page', (_req, res) => res.json({ ok: true, items: [1, 2, 3] }));
  const server = app.listen(Number(process.env.PORT || 3300), '127.0.0.1', () => console.log('ready'));
  process.on('SIGTERM', async () => { server.close(); await aegis?.shutdown(); process.exit(0); });
})().catch(e => { console.error(e); process.exit(1); });

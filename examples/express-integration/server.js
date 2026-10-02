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
 * Status API: /aegis/stats, /aegis/events (protect these in production).
 */
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { AegisNode, aegisExpress, aegisRoutes } = require('../../packages/server-node/dist');

const PORT = process.env.PORT || 3000;
const aegis = new AegisNode({
  siteKey: process.env.AEGIS_SITE_KEY || 'demo-site',
  secretKey: process.env.AEGIS_SECRET_KEY || crypto.randomBytes(16).toString('hex'),
  requireTokenPaths: ['/api/login'],
  // the status API under /aegis/ is not analysed (telemetry is handled before this check)
  excludedPaths: ['/health', '/sdk', '/aegis/'],
  mlUrl: process.env.AEGIS_ML_URL, // optional: packages/ml-engine service
});

const app = express();
app.use(express.json());
app.use(aegisExpress(aegis.options, aegis));
app.use(aegisRoutes(aegis));
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

app.listen(PORT, () => console.log(`AEGIS Express example on http://localhost:${PORT}`));

import express from 'express';
import http from 'http';
import request from 'supertest';
import { aegisExpress, AegisServer, AegisNode, TokenVerifier } from '../src';
import { BROWSER_HEADERS, CHROME_UA, SECRET, SITE_KEY, telemetry } from './fixtures';

function makeApp(extra: Partial<ConstructorParameters<typeof AegisNode>[0]> = {}) {
  const app = express();
  app.use(express.json());
  const middleware = aegisExpress({ siteKey: SITE_KEY, secretKey: SECRET, requireTokenPaths: ['/api/login'], ...extra });
  app.use(middleware);
  app.get('/products', (_req, res) => { res.json({ ok: true }); });
  app.post('/api/login', (req, res) => { res.json({ success: true, score: (req as any).aegis.score }); });
  app.post('/contact', (_req, res) => { res.json({ sent: true }); });
  return { app, aegis: middleware.aegis };
}

describe('aegisExpress', () => {
  const apps: AegisNode[] = [];
  const make = (extra = {}) => { const r = makeApp(extra); apps.push(r.aegis); return r; };
  afterAll(async () => { await Promise.all(apps.map(a => a.shutdown())); });

  it('lets a normal browser request through and sets a session cookie', async () => {
    const { app } = make();
    const res = await request(app).get('/products').set(BROWSER_HEADERS);
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie'][0]).toMatch(/^aegis_sid=.+HttpOnly/);
  });

  it('challenges a token-required path without a token', async () => {
    const { app } = make();
    const res = await request(app).post('/api/login').set(BROWSER_HEADERS).send({ u: 'a' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ aegis: 'challenge', telemetry: '/aegis/telemetry' });
  });

  it('issues a token for human telemetry that unlocks the protected path', async () => {
    const { app } = make();
    const t = await request(app).post('/aegis/telemetry').set(BROWSER_HEADERS).send(telemetry());
    expect(t.status).toBe(200);
    expect(t.body.verdict).toBe('allow');
    expect(t.body.expiresIn).toBe(300);
    const login = await request(app).post('/api/login').set({ ...BROWSER_HEADERS, 'x-aegis-token': t.body.token }).send({});
    expect(login.status).toBe(200);
    expect(login.body.success).toBe(true);
  });

  it('blocks headless telemetry and requests carrying its token', async () => {
    const { app } = make();
    const t = await request(app).post('/aegis/telemetry').set(BROWSER_HEADERS).send(telemetry(false));
    expect(t.body.verdict).toBe('block');
    const res = await request(app).get('/products').set({ ...BROWSER_HEADERS, 'x-aegis-token': t.body.token });
    expect(res.status).toBe(403);
  });

  it('rejects a token used with a different user agent', async () => {
    const { app } = make();
    const t = await request(app).post('/aegis/telemetry').set(BROWSER_HEADERS).send(telemetry());
    const res = await request(app).post('/api/login')
      .set({ ...BROWSER_HEADERS, 'user-agent': CHROME_UA.replace('120.0', '121.0'), 'x-aegis-token': t.body.token }).send({});
    expect(res.status).toBe(403);
  });

  it('rejects telemetry for another site key or without features', async () => {
    const { app } = make();
    expect((await request(app).post('/aegis/telemetry').set(BROWSER_HEADERS).send(telemetry(true, 'other'))).status).toBe(403);
    expect((await request(app).post('/aegis/telemetry').set(BROWSER_HEADERS).send({ siteKey: SITE_KEY })).status).toBe(400);
  });

  it('blocks honeypot form submissions via the core engine', async () => {
    const { app } = make();
    const res = await request(app).post('/contact').set(BROWSER_HEADERS).send({ name: 'x', website_url: 'http://spam' });
    expect(res.status).toBe(403);
    expect(res.body.aegis).toBe('block');
  });

  it('never blocks in monitor mode', async () => {
    const { app } = make({ mode: 'monitor' });
    const res = await request(app).post('/contact').set(BROWSER_HEADERS).send({ website_url: 'http://spam' });
    expect(res.status).toBe(200);
  });

  it('adds the ML service probability when mlUrl is set', async () => {
    const ml = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ is_bot: true, confidence_score: 0.9, client_id: 'x' }));
    });
    await new Promise<void>(resolve => ml.listen(0, '127.0.0.1', resolve));
    const port = (ml.address() as any).port;
    const { app } = make({ mlUrl: `http://127.0.0.1:${port}` });
    const t = await request(app).post('/aegis/telemetry').set(BROWSER_HEADERS).send(telemetry());
    ml.close();
    expect(t.body.score).toBeGreaterThanOrEqual(90);
    expect(t.body.verdict).toBe('block');
  });
});

describe('AegisServer routes', () => {
  const server = new AegisServer({ siteKey: SITE_KEY, secretKey: SECRET });
  afterAll(() => server.aegis.shutdown());

  it('reports real counts, not placeholders', async () => {
    const app = server.getApp();
    await request(app).post('/aegis/telemetry').set(BROWSER_HEADERS).send(telemetry());
    const stats = await request(app).get('/aegis/stats');
    expect(stats.body.totalRequests).toBe(1);
    expect(stats.body.telemetrySubmissions).toBe(1);
    const events = await request(app).get('/aegis/events');
    expect(events.body[0]).toMatchObject({ path: '/aegis/telemetry', verdict: 'allow' });
    expect(events.body[0].ip).toMatch(/\/(24|48)$|unknown/);
  });

  it('verifies tokens server-to-server', async () => {
    const app = server.getApp();
    const t = await request(app).post('/aegis/telemetry').set(BROWSER_HEADERS).send(telemetry());
    expect((await request(app).post('/aegis/verify').send({ token: t.body.token })).body.valid).toBe(true);
    expect((await request(app).post('/aegis/verify').send({ token: 'x' })).status).toBe(401);
  });
});

describe('TokenVerifier', () => {
  it('rejects garbage', () => {
    expect(new TokenVerifier(SECRET).verify('nope').valid).toBe(false);
  });
});

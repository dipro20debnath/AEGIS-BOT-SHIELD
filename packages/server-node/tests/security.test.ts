import express from 'express';
import request from 'supertest';
import { signRequest } from '@aegis/core';
import { aegisExpress, aegisSecurityHeaders, aegisRequireSignature, AegisNode } from '../src';
import { BROWSER_HEADERS, SECRET, SITE_KEY } from './fixtures';

describe('aegisSecurityHeaders', () => {
  it('adds the headers without overriding ones the app set', async () => {
    const app = express();
    app.use(aegisSecurityHeaders());
    app.get('/', (_req, res) => { res.json({}); });
    app.get('/framed', (_req, res) => { res.setHeader('X-Frame-Options', 'SAMEORIGIN'); res.json({}); });
    const res = await request(app).get('/');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toMatch(/max-age=/);
    // headers set before next() are the middleware's; app overrides after next() win
    expect((await request(app).get('/framed')).headers['x-frame-options']).toBe('SAMEORIGIN');
  });
});

describe('aegisRequireSignature', () => {
  const secret = 'webhook-shared-secret';
  const app = express();
  const guard = aegisRequireSignature(secret);
  app.post('/hook', guard, (req, res) => { res.json({ got: JSON.parse((req as any).rawBody).id }); });
  afterAll(() => guard.antiTamper.destroy());

  it('accepts a signed request once and rejects replay and tampering', async () => {
    const body = '{"id":42}';
    const sig = signRequest({ method: 'POST', path: '/hook', body }, secret);
    const send = (b: string, s = sig) => request(app).post('/hook').set('content-type', 'application/json').set('x-aegis-signature', s).send(b);
    expect((await send(body)).body).toEqual({ got: 42 });
    expect((await send(body)).body.reason).toBe('replay');
    const fresh = signRequest({ method: 'POST', path: '/hook', body }, secret);
    expect((await send('{"id":43}', fresh)).body.reason).toBe('bad_signature');
    expect((await request(app).post('/hook').send(body)).status).toBe(401);
  });
});

describe('input validation through aegisExpress', () => {
  const nodes: AegisNode[] = [];
  afterAll(async () => { await Promise.all(nodes.map(n => n.shutdown())); });

  it('scores an injection in the query string higher than a clean query', async () => {
    const app = express();
    const mw = aegisExpress({ siteKey: SITE_KEY, secretKey: SECRET, mode: 'monitor' });
    nodes.push(mw.aegis);
    app.use(mw);
    app.get('/search', (req, res) => { res.json({ score: (req as any).aegis.score, reasons: (req as any).aegis.reasons }); });
    const clean = await request(app).get('/search?q=blue+shoes').set(BROWSER_HEADERS);
    const attack = await request(app).get("/search?q=1'%20UNION%20SELECT%20password%20FROM%20users--").set(BROWSER_HEADERS);
    expect(attack.body.score).toBeGreaterThan(clean.body.score);
  });
});

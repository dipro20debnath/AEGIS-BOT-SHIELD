import http from 'http';
import { execFileSync } from 'child_process';
import path from 'path';
import request from 'supertest';
import Fastify from 'fastify';
import { aegisGeneric, TokenVerifier } from '../src';
import { aegisFastify } from '../src/middleware/fastify';
import { BROWSER_HEADERS, SECRET, SITE_KEY, telemetry } from './fixtures';

describe('aegisGeneric (plain http)', () => {
  const handler = aegisGeneric({ siteKey: SITE_KEY, secretKey: SECRET, requireTokenPaths: ['/buy'] });
  const server = http.createServer((req, res) => handler(req, res, () => { res.end('ok'); }));

  it('handles telemetry and protects paths', async () => {
    expect((await request(server).post('/buy').set(BROWSER_HEADERS)).status).toBe(403);
    const browser = request.agent(server);
    const t = await browser.post('/aegis/telemetry').set(BROWSER_HEADERS)
      .set('content-type', 'application/json').send(JSON.stringify(telemetry()));
    expect(t.status).toBe(200);
    const ok = await browser.post('/buy').set({ ...BROWSER_HEADERS, 'x-aegis-token': t.body.token });
    expect(ok.text).toBe('ok');
  });
});

describe('aegisFastify', () => {
  it('handles telemetry and protects paths', async () => {
    const app = Fastify();
    await app.register(aegisFastify, { siteKey: SITE_KEY, secretKey: SECRET, requireTokenPaths: ['/buy'] });
    app.post('/buy', async () => ({ bought: true }));
    await app.ready();

    expect((await app.inject({ method: 'POST', url: '/buy', headers: BROWSER_HEADERS })).statusCode).toBe(403);
    const t = await app.inject({ method: 'POST', url: '/aegis/telemetry', headers: BROWSER_HEADERS, payload: telemetry() });
    expect(t.statusCode).toBe(200);
    const cookie = String(t.headers['set-cookie']).split(';')[0];
    const ok = await app.inject({ method: 'POST', url: '/buy', headers: { ...BROWSER_HEADERS, cookie, 'x-aegis-token': t.json().token } });
    expect(ok.json()).toEqual({ bought: true });
    await app.close();
  });
});

describe('interoperability with the Python SDK', () => {
  it('verifies a token issued by aegis_shield', () => {
    let token: string;
    try {
      token = execFileSync('python3', ['-c',
        `import sys; sys.path.insert(0, ${JSON.stringify(path.resolve(__dirname, '../../server-python'))});` +
        `from aegis_shield.verifier import generate_token; print(generate_token({"sid": "py", "score": 7, "verdict": "allow"}, ${JSON.stringify(SECRET)}))`,
      ], { encoding: 'utf8' }).trim();
    } catch {
      console.warn('python3 with cryptography not available; skipping interop check');
      return;
    }
    const result = new TokenVerifier(SECRET).verify(token);
    expect(result).toMatchObject({ valid: true, verdict: 'allow', riskScore: 7 });
  });
});

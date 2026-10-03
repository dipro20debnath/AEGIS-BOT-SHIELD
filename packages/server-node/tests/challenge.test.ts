import express from 'express';
import request from 'supertest';
import { scryptSync } from 'crypto';
import { aegisExpress } from '../src';
import { BROWSER_HEADERS, SECRET, SITE_KEY } from './fixtures';

function leadingZeroBits(bytes: Uint8Array): number {
  let bits = 0;
  for (const b of bytes) { if (b === 0) { bits += 8; continue; } return bits + Math.clz32(b) - 24; }
  return bits;
}

function solve(c: { challenge: string; seed: string; n: number; r: number; bits: number }): number {
  for (let nonce = 0; ; nonce++) {
    if (leadingZeroBits(scryptSync(`${c.challenge}:${nonce}`, c.seed, 32, { N: c.n, r: c.r, p: 1 })) >= c.bits) return nonce;
  }
}

describe('memory-hard challenge endpoints (Express)', () => {
  const mw = aegisExpress({ siteKey: SITE_KEY, secretKey: SECRET, requireTokenPaths: ['/api/login'], pow: { n: 1024, r: 8, bits: 3 } });
  const app = express();
  app.use(express.json());
  app.use(mw);
  app.post('/api/login', (req, res) => { res.json({ ok: true, reasons: (req as any).aegis.reasons }); });
  app.get('/search', (req, res) => { res.json({ reasons: (req as any).aegis.reasons }); });
  afterAll(() => mw.aegis.shutdown());

  async function powToken(headers: Record<string, string>, agent = request(app)): Promise<string> {
    const issued = (await agent.get('/aegis/challenge').set(headers)).body;
    const solved = await agent.post('/aegis/challenge').set(headers).send({ challenge: issued.challenge, nonce: solve(issued) });
    expect(solved.status).toBe(200);
    return solved.body.token;
  }

  it('turns a challenge-band request into allow without counting its signals twice', async () => {
    // Only a browser user agent, no other browser headers: score ~65 (challenge band)
    const odd = { 'user-agent': BROWSER_HEADERS['user-agent'] };
    const denied = await request(app).get('/search').set(odd);
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ aegis: 'challenge', challenge: '/aegis/challenge' });

    const ok = await request(app).get('/search').set(odd).set('X-Aegis-Token', await powToken(odd));
    expect(ok.status).toBe(200);
    expect(ok.body.reasons).toContain('pow_solved');
  });

  it('does not let proof of work alone unlock a token-required path', async () => {
    const res = await request(app).post('/api/login').set(BROWSER_HEADERS).set('X-Aegis-Token', await powToken(BROWSER_HEADERS)).send({});
    expect(res.status).toBe(403);
    expect(res.body.aegis).toBe('challenge');
  });

  it('rejects a replayed or wrong solution', async () => {
    const issued = (await request(app).get('/aegis/challenge')).body;
    const nonce = solve(issued);
    expect((await request(app).post('/aegis/challenge').send({ challenge: issued.challenge, nonce })).status).toBe(200);
    const replay = await request(app).post('/aegis/challenge').send({ challenge: issued.challenge, nonce });
    expect(replay.status).toBe(403);
    expect(replay.body.reason).toBe('replay');
    expect((await request(app).post('/aegis/challenge').send({ challenge: 'junk', nonce: 1 })).body.reason).toBe('malformed');
  });

  it('never turns a block into an allow', async () => {
    const issued = (await request(app).get('/aegis/challenge').set('user-agent', 'sqlmap/1.7')).body;
    const token = (await request(app).post('/aegis/challenge').set('user-agent', 'sqlmap/1.7')
      .send({ challenge: issued.challenge, nonce: solve(issued) })).body.token;
    const res = await request(app).post('/api/login').set('user-agent', 'sqlmap/1.7').set('X-Aegis-Token', token).send({});
    expect(res.status).toBe(403);
    expect(res.body.aegis).toBe('block');
  });
});

/**
 * Two server instances behind a load balancer, sharing one store. With
 * MemoryStore the instances share the object (what Redis gives separate
 * processes); with AEGIS_TEST_REDIS_URL the same cases run against Redis.
 */
import express from 'express';
import request from 'supertest';
import { scryptSync } from 'crypto';
import { AegisStore, MemoryStore, createRedisStore, verifyToken } from '@aegis/core';
import { aegisExpress } from '../src';
import { BROWSER_HEADERS, SECRET, SITE_KEY, telemetry } from './fixtures';

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

function instance(store: AegisStore) {
  const mw = aegisExpress({
    siteKey: SITE_KEY, secretKey: SECRET, store, pow: { n: 1024, r: 8, bits: 2 },
    engine: { rateLimiting: { endpointLimits: { '/login': { maxRequests: 2, windowMs: 60_000 } } } as any },
  });
  const app = express();
  app.use(express.json());
  app.use(mw);
  app.post('/login', (req, res) => { res.json({ ok: true, reasons: (req as any).aegis.reasons }); });
  return { app, mw };
}

const cases: Array<[string, () => Promise<AegisStore>]> = [['MemoryStore', async () => new MemoryStore()]];
if (process.env.AEGIS_TEST_REDIS_URL) {
  cases.push(['RedisStore', () => createRedisStore(process.env.AEGIS_TEST_REDIS_URL!, `aegis-node-test:${process.pid}:${Date.now()}:`)]);
}

describe.each(cases)('two instances sharing a %s', (_name, makeStore) => {
  let store: AegisStore;
  let a: ReturnType<typeof instance>;
  let b: ReturnType<typeof instance>;
  beforeAll(async () => {
    store = await makeStore();
    a = instance(store);
    b = instance(store);
  });
  afterAll(async () => {
    await a.mw.aegis.shutdown();
    await b.mw.aegis.shutdown();
    await store.close();
  });

  it('counts a rate limit across instances', async () => {
    const send = (app: express.Express) => request(app).post('/login').set(BROWSER_HEADERS).send({});
    expect((await send(a.app)).status).toBe(200);
    expect((await send(b.app)).status).toBe(200);
    // Third login within the window: each instance alone has seen at most 2
    const third = await send(a.app);
    expect(third.status).toBe(403);
    expect(third.body.aegis).toBe('block');
  });

  it('rejects at instance B a challenge solution already redeemed at instance A', async () => {
    const issued = (await request(a.app).get('/aegis/challenge')).body;
    const nonce = solve(issued);
    expect((await request(a.app).post('/aegis/challenge').send({ challenge: issued.challenge, nonce })).status).toBe(200);
    const replay = await request(b.app).post('/aegis/challenge').send({ challenge: issued.challenge, nonce });
    expect(replay.status).toBe(403);
    expect(replay.body.reason).toBe('replay');
  });

  it('carries the telemetry score of a session from instance A to a challenge solved at B', async () => {
    const tel = await request(a.app).post('/aegis/telemetry').set(BROWSER_HEADERS).send(telemetry(true));
    expect(tel.status).toBe(200);
    const cookie = String(tel.headers['set-cookie']).split(';')[0];
    const issued = (await request(b.app).get('/aegis/challenge')).body;
    const solved = await request(b.app).post('/aegis/challenge').set(BROWSER_HEADERS).set('Cookie', cookie)
      .send({ challenge: issued.challenge, nonce: solve(issued) });
    expect(solved.status).toBe(200);
    const claims = verifyToken(solved.body.token, SECRET, 300)!;
    expect(claims.tel).toBe(1);
    expect(claims.score).toBe(tel.body.score);
    const record = await b.mw.aegis.sessions.get(cookie.split('=')[1].split('.')[0]);
    expect(record?.paths).toContain('/aegis/telemetry');
  });
});

describe('store outage', () => {
  const down: AegisStore = {
    claimOnce: async () => { throw new Error('ECONNREFUSED'); },
    hit: async () => { throw new Error('ECONNREFUSED'); },
    get: async () => { throw new Error('ECONNREFUSED'); },
    set: async () => { throw new Error('ECONNREFUSED'); },
    close: async () => undefined,
  };
  const mw = aegisExpress({ siteKey: SITE_KEY, secretKey: SECRET, store: down, requireTokenPaths: ['/login'], pow: { n: 1024, r: 8, bits: 2 } });
  const app = express();
  app.use(express.json());
  app.use(mw);
  app.post('/login', (_req, res) => { res.json({ ok: true }); });
  afterAll(() => mw.aegis.shutdown());

  it('keeps analysing requests (no fail-open bypass) while the store is unreachable', async () => {
    const res = await request(app).post('/login').set(BROWSER_HEADERS).send({});
    expect(res.status).toBe(403);
    expect(res.body.aegis).toBe('challenge');
    const tel = await request(app).post('/aegis/telemetry').set(BROWSER_HEADERS).send(telemetry(true));
    expect(tel.status).toBe(200);
    expect(typeof tel.body.token).toBe('string');
  });

  it('refuses challenge solutions instead of risking a replay', async () => {
    const issued = (await request(app).get('/aegis/challenge')).body;
    const res = await request(app).post('/aegis/challenge').send({ challenge: issued.challenge, nonce: solve(issued) });
    expect(res.status).toBe(503);
  });
});

import express from 'express';
import request from 'supertest';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import WebSocket from 'ws';
import { AegisNode, aegisExpress, aegisRoutes, attachLiveFeed, LiveFeed, MAX_ROOT_FIELDS } from '../src';
import { BROWSER_HEADERS, SECRET, SITE_KEY, telemetry } from './fixtures';

function app(aegis: AegisNode) {
  const a = express();
  a.use(express.json());
  a.use(aegisExpress(aegis.options, aegis));
  a.use(aegisRoutes(aegis));
  a.get('/page', (_req, res) => { res.json({ ok: true }); });
  return a;
}

describe('GraphQL status API', () => {
  const aegis = new AegisNode({ siteKey: SITE_KEY, secretKey: SECRET, excludedPaths: ['/aegis/'] });
  const server = app(aegis);
  afterAll(() => aegis.shutdown());

  const gql = (query: string, variables?: Record<string, unknown>) =>
    request(server).post('/aegis/graphql').send({ query, variables });

  beforeAll(async () => {
    await request(server).get('/page').set(BROWSER_HEADERS);
    await request(server).get('/page').set('User-Agent', 'python-requests/2.31');
    await request(server).post('/aegis/telemetry').set(BROWSER_HEADERS).send(telemetry(false));
  });

  it('returns the same counters as the REST endpoint', async () => {
    const rest = (await request(server).get('/aegis/stats')).body;
    const res = await gql('{ stats { totalRequests blocked challenged allowed topReasons { reason count } } }');
    expect(res.status).toBe(200);
    expect(res.body.data.stats).toMatchObject({ totalRequests: rest.totalRequests, blocked: rest.blocked, challenged: rest.challenged });
    expect(res.body.data.stats.totalRequests).toBe(3);
  });

  it('filters events and lists threat signals', async () => {
    const res = await gql(`query($v: Verdict) { events(verdict: $v, limit: 10) { path verdict score reasons ipPrefix telemetry }
      threats(limit: 3) { reason count } config { mode sharedStore mlEnabled } }`, { v: 'block' });
    expect(res.status).toBe(200);
    const { events, threats, config } = res.body.data;
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e: { verdict: string }) => e.verdict === 'block')).toBe(true);
    expect(events[0].ipPrefix).toMatch(/\/(24|48)$/);
    expect(threats.length).toBeGreaterThan(0);
    expect(config).toEqual({ mode: 'enforce', sharedStore: false, mlEnabled: false });
  });

  it('answers GET queries', async () => {
    const res = await request(server).get('/aegis/graphql').query({ query: '{ health { status } }' });
    expect(res.body.data.health.status).toBe('ok');
  });

  it('is read-only and rejects abusive documents', async () => {
    expect((await gql('mutation { stats { blocked } }')).status).toBe(400);
    const aliased = '{ ' + Array.from({ length: MAX_ROOT_FIELDS + 1 }, (_, i) => `e${i}: events(limit: 500) { path }`).join(' ') + ' }';
    const tooMany = await gql(aliased);
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.errors[0].message).toMatch(/root fields/);
    const viaFragment = await gql('{ ...F } fragment F on Query { ' + Array.from({ length: MAX_ROOT_FIELDS + 1 }, (_, i) => `s${i}: stats { blocked }`).join(' ') + ' }');
    expect(viaFragment.status).toBe(400);
    expect((await gql('{ nope }')).status).toBe(400);
    expect((await request(server).post('/aegis/graphql').send({})).status).toBe(400);
    expect((await gql('{ health { status } }'.padEnd(9000, ' '))).status).toBe(413);
  });

  it('caps the events limit', async () => {
    const res = await gql('{ events(limit: 100000) { path } }');
    expect(res.status).toBe(200);
    expect(res.body.data.events.length).toBeLessThanOrEqual(500);
  });
});

describe('WebSocket live feed', () => {
  let aegis: AegisNode;
  let server: Server;
  let feed: LiveFeed;
  let url: string;
  let expressApp: express.Express;

  beforeEach(async () => {
    aegis = new AegisNode({ siteKey: SITE_KEY, secretKey: SECRET, excludedPaths: ['/aegis/'] });
    expressApp = app(aegis);
    server = expressApp.listen(0);
    await new Promise(r => server.once('listening', r));
    url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    await feed?.close();
    await new Promise(r => server.close(r));
    await aegis.shutdown();
  });

  function collect(ws: WebSocket) {
    const messages: any[] = [];
    ws.on('message', data => messages.push(JSON.parse(String(data))));
    return messages;
  }
  const until = async (check: () => boolean, ms = 3000) => {
    const end = Date.now() + ms;
    while (!check()) {
      if (Date.now() > end) throw new Error('timed out');
      await new Promise(r => setTimeout(r, 20));
    }
  };

  it('greets with counters and pushes each decision in batches', async () => {
    feed = attachLiveFeed(server, aegis, { flushMs: 50 });
    await request(expressApp).get('/page').set(BROWSER_HEADERS);
    const ws = new WebSocket(`${url}/aegis/live`);
    const messages = collect(ws);
    await until(() => messages.length > 0);
    expect(messages[0]).toMatchObject({ type: 'hello', summary: { totalRequests: 1 } });
    expect(messages[0].events).toHaveLength(1);

    for (let i = 0; i < 3; i++) await request(expressApp).get('/page').set('User-Agent', 'curl/8.0');
    await until(() => messages.filter(m => m.type === 'events').flatMap(m => m.events).length === 3);
    const pushed = messages.filter(m => m.type === 'events').flatMap(m => m.events);
    expect(pushed.every((e: { path: string; ip: string }) => e.path === '/page' && /\/(24|48)$/.test(e.ip))).toBe(true);
    // fewer messages than events: batched
    expect(messages.filter(m => m.type === 'events').length).toBeLessThanOrEqual(3);
    ws.close();
  });

  it('drops events beyond the batch size and reports how many', async () => {
    feed = attachLiveFeed(server, aegis, { flushMs: 200, maxBatch: 2 });
    const ws = new WebSocket(`${url}/aegis/live`);
    const messages = collect(ws);
    await until(() => messages.length > 0);
    await Promise.all(Array.from({ length: 5 }, () => request(expressApp).get('/page').set('User-Agent', 'curl/8.0')));
    await until(() => messages.some(m => m.type === 'events'));
    const batch = messages.find(m => m.type === 'events');
    expect(batch.events.length + batch.dropped).toBe(5);
    expect(batch.events.length).toBe(2);
    ws.close();
  });

  it('refuses unauthorised clients and foreign origins', async () => {
    feed = attachLiveFeed(server, aegis, {
      authorize: req => req.headers['authorization'] === 'Bearer admin',
      allowedOrigins: ['http://dashboard.local'],
    });
    const status = (ws: WebSocket) => new Promise<number>(resolve => {
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('open', () => resolve(101));
    });
    expect(await status(new WebSocket(`${url}/aegis/live`, { origin: 'http://evil.example' }))).toBe(403);
    expect(await status(new WebSocket(`${url}/aegis/live`, { origin: 'http://dashboard.local' }))).toBe(401);
    const ok = new WebSocket(`${url}/aegis/live`, { origin: 'http://dashboard.local', headers: { Authorization: 'Bearer admin' } });
    expect(await status(ok)).toBe(101);
    ok.close();
    expect(await status(new WebSocket(`${url}/elsewhere`))).toBe(404);
  });
});

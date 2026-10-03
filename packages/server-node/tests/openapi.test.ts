/**
 * Contract test: real responses of the Node server, for every documented
 * operation and status code exercised here, are validated against
 * contracts/openapi.json (the same file the Python tests use).
 */
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'fs';
import path from 'path';
import { scryptSync } from 'crypto';
import Ajv2020 from 'ajv/dist/2020';
import { AegisNode, aegisExpress, aegisRoutes, openapiSpec } from '../src';
import { BROWSER_HEADERS, SECRET, SITE_KEY, telemetry } from './fixtures';

const CONTRACT = path.resolve(__dirname, '../../../contracts/openapi.json');
const spec = JSON.parse(readFileSync(CONTRACT, 'utf8'));

const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addSchema({ $id: 'openapi.json', components: spec.components });

/** Schema of one documented response, with refs pointing into the spec's components. */
function responseSchema(method: string, p: string, status: number) {
  const op = spec.paths[p]?.[method];
  if (!op) throw new Error(`${method.toUpperCase()} ${p} is not in the OpenAPI document`);
  const res = op.responses[String(status)] ?? op.responses[`${String(status)[0]}XX`];
  if (!res) throw new Error(`${method.toUpperCase()} ${p} does not document status ${status}`);
  return res.content?.['application/json']?.schema;
}

function expectConforms(method: string, p: string, res: request.Response) {
  const schema = responseSchema(method, p, res.status);
  if (!schema) return;
  const rewritten = JSON.parse(JSON.stringify(schema).replace(/"#\/components\//g, '"openapi.json#/components/'));
  const validate = ajv.compile(rewritten);
  if (!validate(res.body)) {
    throw new Error(`${method.toUpperCase()} ${p} ${res.status}: ${ajv.errorsText(validate.errors)}\n${JSON.stringify(res.body)}`);
  }
}

function leadingZeroBits(bytes: Uint8Array): number {
  let bits = 0;
  for (const b of bytes) { if (b === 0) { bits += 8; continue; } return bits + Math.clz32(b) - 24; }
  return bits;
}
const solve = (c: { challenge: string; seed: string; n: number; r: number; bits: number }) => {
  for (let nonce = 0; ; nonce++) if (leadingZeroBits(scryptSync(`${c.challenge}:${nonce}`, c.seed, 32, { N: c.n, r: c.r, p: 1 })) >= c.bits) return nonce;
};

describe('OpenAPI contract (Node server)', () => {
  const aegis = new AegisNode({ siteKey: SITE_KEY, secretKey: SECRET, requireTokenPaths: ['/api/login'], excludedPaths: ['/aegis/'], pow: { n: 1024, r: 8, bits: 2 } });
  const app = express();
  app.use(express.json());
  app.use(aegisExpress(aegis.options, aegis));
  app.use(aegisRoutes(aegis));
  app.post('/api/login', (_req, res) => { res.json({ ok: true }); });
  afterAll(() => aegis.shutdown());

  it('serves the same document as contracts/openapi.json (run npm run sync:openapi if this fails)', async () => {
    expect(openapiSpec).toEqual(spec);
    const res = await request(app).get('/aegis/openapi.json');
    expect({ ...res.body, servers: res.body.servers.slice(1) }).toEqual(spec);
    expect(res.body.servers[0]).toEqual({ url: '/', description: 'This server' });
    const docs = await request(app).get('/aegis/docs');
    expect(docs.type).toBe('text/html');
    expect(docs.text).toContain('integrity="sha384-');
  });

  it('documents every status-API route', () => {
    const router = aegisRoutes(aegis) as unknown as { stack: Array<{ route?: { path: string } }> };
    const routes = router.stack.filter(l => l.route).map(l => l.route!.path);
    expect(routes.length).toBeGreaterThan(5);
    for (const r of routes) expect(Object.keys(spec.paths)).toContain(r);
  });

  it('telemetry: 200, 400, 403, 413', async () => {
    const p = '/aegis/telemetry';
    const ok = await request(app).post(p).set(BROWSER_HEADERS).send(telemetry(true));
    expect(ok.status).toBe(200);
    expectConforms('post', p, ok);
    const bad = await request(app).post(p).send({ siteKey: SITE_KEY });
    expect(bad.status).toBe(400);
    expectConforms('post', p, bad);
    const site = await request(app).post(p).send(telemetry(true, 'other-site'));
    expect(site.status).toBe(403);
    expectConforms('post', p, site);
    const big = await request(app).post(p).send({ ...telemetry(true), behavioral: { pad: 'x'.repeat(70 * 1024) } });
    expect(big.status).toBe(413);
    expectConforms('post', p, big);
  });

  it('challenge: issue, solve, replay, malformed', async () => {
    const p = '/aegis/challenge';
    const issued = await request(app).get(p);
    expectConforms('get', p, issued);
    const solved = await request(app).post(p).send({ challenge: issued.body.challenge, nonce: solve(issued.body) });
    expect(solved.status).toBe(200);
    expectConforms('post', p, solved);
    const replay = await request(app).post(p).send({ challenge: issued.body.challenge, nonce: solve(issued.body) });
    expect(replay.status).toBe(403);
    expectConforms('post', p, replay);
  });

  it('denial of a protected request', async () => {
    const res = await request(app).post('/api/login').set(BROWSER_HEADERS).send({});
    expect(res.status).toBe(403);
    expect(['block', 'challenge']).toContain(res.headers['x-aegis-action']);
    expectConforms('get', '/{protectedPath}', res);
  });

  it('status API', async () => {
    for (const p of ['/aegis/health', '/aegis/stats', '/aegis/events', '/aegis/config']) {
      const res = await request(app).get(p);
      expect(res.status).toBe(200);
      expectConforms('get', p, res);
    }
    const token = (await request(app).post('/aegis/telemetry').set(BROWSER_HEADERS).send(telemetry(true))).body.token;
    const valid = await request(app).post('/aegis/verify').send({ token });
    expect(valid.status).toBe(200);
    expectConforms('post', '/aegis/verify', valid);
    const invalid = await request(app).post('/aegis/verify').send({ token: 'x' });
    expect(invalid.status).toBe(401);
    expectConforms('post', '/aegis/verify', invalid);
    const gql = await request(app).post('/aegis/graphql').send({ query: '{ stats { blocked } }' });
    expectConforms('post', '/aegis/graphql', gql);
    const gqlBad = await request(app).get('/aegis/graphql').query({ query: '{ nope }' });
    expect(gqlBad.status).toBe(400);
    expectConforms('get', '/aegis/graphql', gqlBad);
  });

  it('rejects responses that break the contract (the checker itself works)', () => {
    const fake = (status: number, body: unknown) => ({ status, body }) as unknown as request.Response;
    expect(() => expectConforms('get', '/aegis/health', fake(200, { status: 'ok' }))).toThrow(/timestamp/);
    expect(() => expectConforms('post', '/aegis/telemetry', fake(200, { token: 'x', expiresIn: 1, verdict: 'allow' }))).toThrow(/pattern/);
    expect(() => expectConforms('get', '/aegis/events', fake(200, [{ timestamp: 1, path: '/', verdict: 'allow', score: 1, reasons: [], ip: '1.2.3.4', telemetry: false }]))).toThrow(/pattern/);
    expect(() => expectConforms('get', '/aegis/health', fake(418, {}))).toThrow(/does not document/);
  });

  it('the test fixture telemetry matches the request schema', () => {
    const validate = ajv.compile({ $ref: 'openapi.json#/components/schemas/TelemetryPayload' });
    expect(validate(telemetry(true))).toBe(true);
  });
});

import { execFileSync } from 'child_process';
import path from 'path';
import { generateToken, sha256 } from '@aegis/core';
import { createEdgeHandler, Env, IsolateRateLimiter } from '../src/worker';
import { userAgentHash, verifyAegisToken } from '../src/token';

const SECRET = 'edge-test-secret-0123456789abcdef';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const uah = sha256(UA).slice(0, 16);
const exp = () => Math.floor(Date.now() / 1000) + 300;

const env = (extra: Partial<Env> = {}): Env => ({
  AEGIS_SECRET_KEY: SECRET,
  AEGIS_REQUIRE_TOKEN_PATHS: '/api/login',
  AEGIS_EXCLUDED_PATHS: '/health',
  AEGIS_ORIGIN: 'https://origin.test',
  AEGIS_RATE_LIMIT: '0',
  ...extra,
});

/** Records what reaches the origin instead of making network calls. */
function stubOrigin() {
  const seen: Request[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    seen.push(input as Request);
    return new Response('origin', { status: 200 });
  }) as typeof fetch;
  return { seen, restore: () => { globalThis.fetch = original; } };
}

const req = (p: string, headers: Record<string, string> = {}, init: RequestInit = {}) =>
  new Request(`https://site.test${p}`, { headers: { 'User-Agent': UA, 'CF-Connecting-IP': '198.51.100.20', ...headers }, ...init });

describe('token verification (WebCrypto)', () => {
  it('accepts tokens from @aegis/core and rejects tampered or foreign ones', async () => {
    const token = generateToken({ sid: 's1', score: 12.5, verdict: 'allow', uah, exp: exp() }, SECRET);
    expect(await verifyAegisToken(token, SECRET)).toMatchObject({ sid: 's1', score: 12.5, verdict: 'allow' });
    const parts = token.split('.');
    expect(await verifyAegisToken([...parts.slice(0, 3), parts[3].slice(0, -2) + 'AA'].join('.'), SECRET)).toBeNull();
    expect(await verifyAegisToken(token, 'another-secret-0123456789')).toBeNull();
    expect(await verifyAegisToken('AEGIS.v1.x.y', SECRET)).toBeNull();
    expect(await verifyAegisToken(generateToken({ exp: 1 }, SECRET), SECRET)).toBeNull();
    // too old by iat even without exp
    expect(await verifyAegisToken(token, SECRET, 300, Date.now() + 301_000)).toBeNull();
  });

  it('works with a 32-byte secret (raw AES key, no hashing)', async () => {
    const secret32 = 'x'.repeat(32);
    expect(await verifyAegisToken(generateToken({ a: 1 }, secret32), secret32)).toMatchObject({ a: 1 });
  });

  it('accepts tokens issued by the Python server', async () => {
    let token: string;
    try {
      token = execFileSync('python3', ['-c',
        `import sys; sys.path.insert(0, ${JSON.stringify(path.resolve(__dirname, '../../server-python'))});` +
        `from aegis_shield.verifier import generate_token; print(generate_token({"sid": "py", "score": 7}, ${JSON.stringify(SECRET)}))`,
      ]).toString().trim();
    } catch {
      console.warn('python3 with cryptography not available; skipping interop check');
      return;
    }
    expect(await verifyAegisToken(token, SECRET)).toMatchObject({ sid: 'py', score: 7 });
  });

  it('hashes the user agent like the servers', async () => {
    expect(await userAgentHash(UA)).toBe(uah);
  });
});

describe('edge handler', () => {
  let origin: ReturnType<typeof stubOrigin>;
  beforeEach(() => { origin = stubOrigin(); });
  afterEach(() => origin.restore());

  it('challenges token-required paths without a token and lets valid tokens through', async () => {
    const handler = createEdgeHandler();
    const denied = await handler.fetch(req('/api/login', {}, { method: 'POST', body: '{}' }), env());
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ aegis: 'challenge', telemetry: '/aegis/telemetry', challenge: '/aegis/challenge' });
    expect(origin.seen).toHaveLength(0);

    const token = generateToken({ sid: 's', score: 20, verdict: 'allow', uah, exp: exp() }, SECRET);
    const ok = await handler.fetch(req('/api/login?x=1', { 'X-Aegis-Token': token }, { method: 'POST', body: '{"u":"a"}' }), env());
    expect(ok.status).toBe(200);
    const forwarded = origin.seen[0];
    expect(forwarded.url).toBe('https://origin.test/api/login?x=1');
    expect(forwarded.headers.get('X-Aegis-Edge')).toBe('verified; score=20');
    expect(await forwarded.text()).toBe('{"u":"a"}');
  });

  it('blocks tokens with a block verdict or score, and rejects tokens bound to another user agent', async () => {
    const handler = createEdgeHandler();
    const blocked = generateToken({ score: 91, verdict: 'block', uah, exp: exp() }, SECRET);
    expect((await handler.fetch(req('/products', { 'X-Aegis-Token': blocked }), env())).status).toBe(403);
    const highScore = generateToken({ score: 85, verdict: 'allow', uah, exp: exp() }, SECRET);
    expect((await handler.fetch(req('/products', { 'X-Aegis-Token': highScore }), env())).status).toBe(403);

    const stolen = generateToken({ score: 5, verdict: 'allow', uah: sha256('curl/8').slice(0, 16), exp: exp() }, SECRET);
    const res = await handler.fetch(req('/api/login', { 'X-Aegis-Token': stolen }, { method: 'POST', body: '{}' }), env());
    expect(res.status).toBe(403);
    expect((await res.json()).reason).toBe('invalid_token');
  });

  it('does not accept proof of work alone on token-required paths (same rule as the origin)', async () => {
    const handler = createEdgeHandler();
    const powOnly = generateToken({ score: 0, verdict: 'allow', pow: 1, tel: 0, uah, exp: exp() }, SECRET);
    expect((await handler.fetch(req('/api/login', { 'X-Aegis-Token': powOnly }, { method: 'POST', body: '{}' }), env())).status).toBe(403);
    const powWithTelemetry = generateToken({ score: 10, verdict: 'allow', pow: 1, tel: 1, uah, exp: exp() }, SECRET);
    expect((await handler.fetch(req('/api/login', { 'X-Aegis-Token': powWithTelemetry }, { method: 'POST', body: '{}' }), env())).status).toBe(200);
  });

  it('passes open paths, AEGIS endpoints and excluded paths, and strips spoofed edge headers', async () => {
    const handler = createEdgeHandler();
    const res = await handler.fetch(req('/products', { 'X-Aegis-Edge': 'verified; score=0', 'x-aegis-edge-extra': '1' }), env());
    expect(res.status).toBe(200);
    expect(origin.seen[0].headers.get('X-Aegis-Edge')).toBe('no_token');
    expect(origin.seen[0].headers.get('x-aegis-edge-extra')).toBeNull();
    await handler.fetch(req('/aegis/telemetry', {}, { method: 'POST', body: '{}' }), env());
    expect(origin.seen[1].headers.get('X-Aegis-Edge')).toBe('aegis_endpoint');
    await handler.fetch(req('/health'), env());
    expect(origin.seen[2].headers.get('X-Aegis-Edge')).toBe('excluded');
    await handler.fetch(req('/products', { 'X-Aegis-Token': 'AEGIS.v1.bad.sig' }), env());
    expect(origin.seen[3].headers.get('X-Aegis-Edge')).toBe('invalid_token');
  });

  it('rate limits with the binding, or the per-isolate fallback', async () => {
    let calls = 0;
    const binding = { limit: async () => ({ success: ++calls <= 2 }) };
    const handler = createEdgeHandler();
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await handler.fetch(req('/products'), env({ AEGIS_RATE_LIMITER: binding }))).status);
    expect(statuses).toEqual([200, 200, 429]);

    const fallback = createEdgeHandler(new IsolateRateLimiter(2));
    const fb = [];
    for (let i = 0; i < 3; i++) fb.push((await fallback.fetch(req('/products'), env({ AEGIS_RATE_LIMIT: '2' }))).status);
    expect(fb).toEqual([200, 200, 429]);
    // another IP has its own window
    expect((await fallback.fetch(req('/products', { 'CF-Connecting-IP': '198.51.100.21' }), env())).status).toBe(200);
  });

  it('monitor mode annotates instead of denying', async () => {
    const handler = createEdgeHandler();
    const res = await handler.fetch(req('/api/login', {}, { method: 'POST', body: '{}' }), env({ AEGIS_MODE: 'monitor' }));
    expect(res.status).toBe(200);
    expect(origin.seen[0].headers.get('X-Aegis-Edge')).toBe('monitor; would=challenge; reason=token_required');
  });

  it('refuses to run without a proper secret', async () => {
    const res = await createEdgeHandler().fetch(req('/'), env({ AEGIS_SECRET_KEY: 'short' }));
    expect(res.status).toBe(500);
  });
});

describe('IsolateRateLimiter', () => {
  it('uses a sliding window', () => {
    const limiter = new IsolateRateLimiter(2, 1000);
    expect([limiter.allow('a', 0), limiter.allow('a', 100), limiter.allow('a', 200)]).toEqual([true, true, false]);
    expect(limiter.allow('a', 1150)).toBe(true);
  });
});

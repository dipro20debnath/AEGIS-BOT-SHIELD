import { InputValidator } from '../src/security/InputValidator';
import { securityHeaders, DEFAULT_CSP } from '../src/security/SecurityHeaders';
import { AntiTamper, signRequest, parseSignatureHeader, canonicalString } from '../src/security/AntiTamper';
import { DetectionEngine, classifyThreats } from '../src/engine/DetectionEngine';
import { ThreatCategory } from '../src/types';

describe('InputValidator', () => {
  const v = new InputValidator();
  const threats = (input: unknown) => v.inspect(input, 'body').map(f => f.threat);

  it.each([
    ['<script>alert(1)</script>', 'xss'],
    ['<img src=x onerror=alert(1)>', 'xss'],
    ['javascript:alert(document.cookie)', 'xss'],
    ['%3Cscript%3Ealert(1)%3C%2Fscript%3E', 'xss'],
    ["' OR '1'='1", 'sqli'],
    ["1 UNION SELECT username, password FROM users", 'sqli'],
    ["1; DROP TABLE users", 'sqli'],
    ["admin'--", 'sqli'],
    ["1' AND SLEEP(5)--", 'sqli'],
    ['../../../../etc/passwd', 'path_traversal'],
    ['..%2F..%2F..%2Fetc%2Fpasswd', 'path_traversal'],
  ])('detects %s', (payload, threat) => {
    expect(threats({ q: payload })).toContain(threat);
  });

  it.each([
    'Hello, I would like to order 2 items.',
    "I'm a fan of Tom & Jerry; select one for me",
    'Where can I buy a union jack flag?',
    'Price < 500 and > 100',
    'আমি একটি অর্ডার দিতে চাই',
    'see https://example.com/path/to/file.html',
    "O'Brien",
  ])('does not flag benign text: %s', text => {
    expect(v.inspect({ comment: text }, 'body')).toEqual([]);
  });

  it('skips sensitive fields such as passwords', () => {
    expect(v.inspect({ password: "' OR '1'='1", user: { api_key: '<script>' } }, 'body')).toEqual([]);
  });

  it('flags prototype pollution keys, including from JSON and bracket notation', () => {
    expect(threats(JSON.parse('{"__proto__": {"isAdmin": true}}'))).toContain('prototype_pollution');
    expect(threats({ 'a[constructor][prototype]': 'x' })).toContain('prototype_pollution');
  });

  it('flags CRLF only in headers', () => {
    const { signals } = v.analyze({ path: '/', headers: { 'x-forwarded-host': 'evil.com\r\nSet-Cookie: a=b' } });
    expect(signals.map(s => s.type)).toContain('input.crlf');
    expect(v.inspect({ note: 'line one\r\nline two' }, 'body')).toEqual([]);
  });

  it('bounds the work on large or deep inputs', () => {
    let deep: unknown = '<script>x</script>';
    for (let i = 0; i < 50; i++) deep = { a: deep };
    expect(v.inspect(deep, 'body')).toEqual([]);
    const wide = Array.from({ length: 5000 }, () => 'ok');
    expect(new InputValidator({ maxValues: 10 }).inspect([...wide, '<script>'], 'body')).toEqual([]);
  });

  it('groups findings into one signal per threat with growing confidence', () => {
    const one = v.analyze({ path: '/', body: { a: "' OR 1=1--" } }).signals;
    const many = v.analyze({ path: '/', body: { a: "' OR 1=1--", b: 'UNION SELECT 1', c: '1; DROP TABLE x' } }).signals;
    expect(one).toHaveLength(1);
    expect(many.filter(s => s.type === 'input.sqli')).toHaveLength(1);
    expect(many[0].confidence).toBeGreaterThan(one[0].confidence);
  });
});

describe('DetectionEngine input validation', () => {
  it('raises the score for a SQLi payload and maps it to OAT-014', async () => {
    const engine = new DetectionEngine({ modules: { rateLimiter: false } as any });
    await engine.init();
    const base = { ip: '103.230.104.20', method: 'POST', path: '/search', timestamp: Date.now(), requestId: 'sec-1', headers: { 'user-agent': 'Mozilla/5.0 Chrome/120', accept: '*/*', 'accept-language': 'en' } };
    const clean = await engine.analyze({ ...base, body: { q: 'blue shoes' } });
    const attack = await engine.analyze({ ...base, body: { q: "' UNION SELECT password FROM users--" } });
    expect(attack.riskScore.score).toBeGreaterThan(clean.riskScore.score);
    expect(attack.signals.some(s => s.type === 'input.sqli')).toBe(true);
    expect(attack.threats).toContain(ThreatCategory.OAT_014_VULNERABILITY_SCANNING);
    await engine.shutdown();
  });

  it('classifyThreats ignores requests without input findings', () => {
    expect(classifyThreats([], '/')).toEqual([]);
  });
});

describe('securityHeaders', () => {
  it('returns safe defaults', () => {
    const h = securityHeaders();
    expect(h['Content-Security-Policy']).toBe(DEFAULT_CSP);
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['X-Frame-Options']).toBe('DENY');
    expect(h['Strict-Transport-Security']).toMatch(/max-age=31536000/);
  });

  it('allows overriding and disabling headers', () => {
    const h = securityHeaders({ contentSecurityPolicy: "default-src 'none'", hsts: false });
    expect(h['Content-Security-Policy']).toBe("default-src 'none'");
    expect(h['Strict-Transport-Security']).toBeUndefined();
  });
});

describe('AntiTamper', () => {
  const secret = 'test-secret-for-antitamper';
  const req = { method: 'POST', path: '/api/orders?id=7', body: '{"qty":1}' };

  it('accepts a valid signature once and rejects the replay', () => {
    const at = new AntiTamper(secret);
    const header = at.sign(req);
    expect(at.verify(req, header)).toEqual({ valid: true });
    expect(at.verify(req, header)).toEqual({ valid: false, reason: 'replay' });
    at.destroy();
  });

  it('rejects tampered body, path, method, wrong secret, old timestamp and garbage', () => {
    const at = new AntiTamper(secret);
    const header = signRequest(req, secret);
    expect(at.verify({ ...req, body: '{"qty":100}' }, header)).toEqual({ valid: false, reason: 'bad_signature' });
    expect(at.verify({ ...req, path: '/api/orders?id=8' }, header)).toEqual({ valid: false, reason: 'bad_signature' });
    expect(at.verify({ ...req, method: 'DELETE' }, header)).toEqual({ valid: false, reason: 'bad_signature' });
    expect(at.verify(req, signRequest(req, 'other-secret'))).toEqual({ valid: false, reason: 'bad_signature' });
    expect(at.verify(req, signRequest(req, secret, Date.now() - 10 * 60_000))).toEqual({ valid: false, reason: 'expired' });
    expect(at.verify(req, 'garbage')).toEqual({ valid: false, reason: 'malformed' });
    expect(at.verify(req, undefined)).toEqual({ valid: false, reason: 'missing' });
    at.destroy();
  });

  it('does not burn the nonce when the signature is bad', () => {
    const at = new AntiTamper(secret);
    const header = signRequest(req, secret);
    expect(at.verify({ ...req, body: 'x' }, header).valid).toBe(false);
    expect(at.verify(req, header)).toEqual({ valid: true });
    at.destroy();
  });

  it('uses a stable canonical string (shared with the Python SDK)', () => {
    expect(canonicalString({ method: 'post', path: '/p', body: '' }, 1700000000, 'abcdef0123456789')).toBe(
      'POST\n/p\n1700000000\nabcdef0123456789\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(parseSignatureHeader('t=1,n=abcdef01,s=xyz')).toEqual({ t: 1, n: 'abcdef01', s: 'xyz' });
  });
});

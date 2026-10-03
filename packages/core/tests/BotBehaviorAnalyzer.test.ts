import { BotBehaviorAnalyzer, classifyRequest, longestSequentialRun } from '../src/modules/session/BotBehaviorAnalyzer';
import { DetectionEngine, SESSION_HEADER } from '../src/engine/DetectionEngine';
import { ThreatCategory } from '../src/types';

const PAGE = { accept: 'text/html,application/xhtml+xml', 'sec-fetch-dest': 'document' };
const types = (signals: { type: string }[]) => signals.map(s => s.type);

/** Deterministic pseudo-random generator so the "human" sessions are reproducible. */
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe('classifyRequest', () => {
  it('uses Sec-Fetch-Dest, then the extension, then Accept', () => {
    expect(classifyRequest({ path: '/', headers: PAGE })).toBe('page');
    expect(classifyRequest({ path: '/x', headers: { 'sec-fetch-dest': 'image' } })).toBe('asset');
    expect(classifyRequest({ path: '/app.js?v=3' })).toBe('asset');
    expect(classifyRequest({ path: '/api/cart', headers: { accept: 'application/json' } })).toBe('api');
    expect(classifyRequest({ path: '/products', headers: { accept: '*/*' } })).toBe('page');
    expect(classifyRequest({ path: '/login', method: 'POST', headers: { accept: '*/*' } })).toBe('api');
  });
});

describe('longestSequentialRun', () => {
  it('finds constant-step ID runs and ignores unrelated numbers', () => {
    expect(longestSequentialRun(['/p/10', '/p/11', '/p/12', '/p/13', '/p/14'])).toBe(5);
    expect(longestSequentialRun(['/p/10', '/p/20', '/p/30', '/p/40'])).toBe(4);
    expect(longestSequentialRun(['/p/10', '/p/11', '/q/12', '/p/13'])).toBe(2);
    expect(longestSequentialRun(['/api/v2/items', '/api/v2/items', '/api/v2/cart'])).toBe(1);
  });
});

describe('BotBehaviorAnalyzer', () => {
  it('flags a scraper paging through IDs on a fixed timer, without referers', () => {
    const a = new BotBehaviorAnalyzer();
    let signals: { type: string }[] = [];
    for (let i = 0; i < 12; i++) {
      signals = a.observe('bot', { path: `/product/${1000 + i}`, headers: { accept: '*/*' }, timestamp: 1_000_000 + i * 2000 });
    }
    expect(types(signals)).toEqual(expect.arrayContaining(['session.timer_regular', 'session.sequential_ids', 'session.no_referer']));
  });

  it('flags fast breadth-first crawling with irregular timing', () => {
    const a = new BotBehaviorAnalyzer();
    const random = rng(7);
    let t = 0;
    let signals: { type: string }[] = [];
    for (let i = 0; i < 32; i++) {
      t += 500 + Math.round(random() * 4000);
      signals = a.observe('crawler', { path: `/${['blog', 'news', 'shop', 'docs'][i % 4]}/${(i * 7919) % 1000}-x`, headers: { ...PAGE, referer: 'https://shop.example/' }, timestamp: t });
    }
    expect(types(signals)).toEqual(['session.crawl_breadth']);
  });

  it('flags 4xx probing once responses are recorded', () => {
    const a = new BotBehaviorAnalyzer();
    for (let i = 0; i < 12; i++) {
      a.observe('scan', { path: `/admin${i}.php`, headers: { accept: '*/*' }, timestamp: i * 137 * (i % 3 + 1) });
      a.recordResponse('scan', i < 9 ? 404 : 200);
    }
    expect(types(a.analyze('scan'))).toContain('session.error_probing');
  });

  it('does not flag 200 simulated human browsing sessions', () => {
    const random = rng(42);
    const paths = ['/', '/products', '/products/shoes', '/product/731', '/product/88', '/cart', '/search?q=bag', '/product/402', '/about', '/checkout'];
    let flagged = 0;
    for (let s = 0; s < 200; s++) {
      const a = new BotBehaviorAnalyzer({ expectAssets: true });
      let t = 0;
      let signals: { type: string }[] = [];
      const pages = 5 + Math.floor(random() * 25);
      for (let p = 0; p < pages; p++) {
        // Reading time: log-normal-ish, 3 s to several minutes
        t += Math.round(3000 + Math.exp(8 + random() * 3));
        signals = a.observe(`h${s}`, { path: paths[Math.floor(random() * paths.length)], headers: { ...PAGE, ...(p ? { referer: 'https://shop.example/' } : {}) }, timestamp: t });
        for (let k = 0; k < 3; k++) a.observe(`h${s}`, { path: `/static/app${k}.css`, headers: { 'sec-fetch-dest': 'style' }, timestamp: t + 20 * k });
      }
      if (signals.length) flagged++;
    }
    expect(flagged).toBe(0);
  });

  it('only flags missing assets when asked to', () => {
    const run = (expectAssets: boolean) => {
      const a = new BotBehaviorAnalyzer({ expectAssets });
      let out: { type: string }[] = [];
      for (let i = 0; i < 6; i++) out = a.observe('s', { path: `/page-${'abcdef'[i]}`, headers: { ...PAGE, referer: 'x' }, timestamp: i * 9000 + (i % 2) * 7000 });
      return types(out);
    };
    expect(run(false)).not.toContain('session.no_assets');
    expect(run(true)).toContain('session.no_assets');
  });

  it('evicts the least recently used sessions beyond maxSessions', () => {
    const a = new BotBehaviorAnalyzer({ maxSessions: 4 });
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) a.observe(id, { path: '/' });
    expect(a.size).toBeLessThanOrEqual(4);
    expect(a.size).toBeGreaterThanOrEqual(2);
  });
});

describe('DetectionEngine session behaviour', () => {
  it('raises the score of a timer-driven ID scraper across its session and maps it to OAT-011', async () => {
    const engine = new DetectionEngine({ secretKey: 'engine-secret-0123456789abcdef', modules: { rateLimiter: false } as any });
    await engine.init();
    let token: string | undefined;
    let first: number | undefined;
    let last: any;
    for (let i = 0; i < 10; i++) {
      last = await engine.analyze({
        ip: '103.230.104.30', method: 'GET', path: `/product/${500 + i}`, timestamp: 2_000_000 + i * 1500, requestId: `r${i}`,
        headers: { 'user-agent': 'Mozilla/5.0 Chrome/120', accept: 'text/html', 'accept-language': 'en', ...(token ? { [SESSION_HEADER]: token } : {}) },
      });
      token = last.sessionToken;
      first ??= last.riskScore.score;
    }
    expect(last.signals.map((s: any) => s.type)).toEqual(expect.arrayContaining(['session.timer_regular', 'session.sequential_ids']));
    expect(last.riskScore.score).toBeGreaterThan(first!);
    expect(last.threats).toContain(ThreatCategory.OAT_011_SCRAPING);
    await engine.shutdown();
  });
});

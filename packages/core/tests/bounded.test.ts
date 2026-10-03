import { TokenBucketLimiter } from '../src/modules/rate-limiter/TokenBucketLimiter';
import { SlidingWindowLimiter } from '../src/modules/rate-limiter/SlidingWindowLimiter';
import { IPAnalyzer } from '../src/modules/ip-intelligence/IPAnalyzer';
import { SessionManager } from '../src/modules/session/SessionManager';
import { BoundedMap } from '../src/utils/bounded';

describe('bounded per-client state (memory under IP rotation)', () => {
  test('BoundedMap keeps at most maxSize keys and recently used ones', () => {
    const evicted: string[] = [];
    const m = new BoundedMap<string, number>(4, (k) => evicted.push(k));
    m.set('a', 1).set('b', 2);          // current full -> next insert rotates
    m.set('c', 3);
    expect(m.get('a')).toBe(1);          // promoted from previous; rotates again, dropping nothing yet read
    m.set('d', 4).set('e', 5);
    expect(m.size).toBeLessThanOrEqual(4);
    expect(m.has('a')).toBe(true);
    expect(evicted).toContain('b');
    expect(m.evicted).toBe(evicted.length);
    expect(m.delete('a')).toBe(true);
    expect(m.has('a')).toBe(false);
    expect([...m.keys()].sort()).toEqual([...new Set([...m.keys()])].sort());
    expect(() => new BoundedMap(1)).toThrow(RangeError);
  });

  test('BoundedMap operations stay O(1) when full', () => {
    const m = new BoundedMap<number, number>(100_000);
    const t0 = Date.now();
    for (let i = 0; i < 500_000; i++) m.set(i, i);
    expect(m.size).toBeLessThanOrEqual(100_000);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  test('token bucket holds at most maxKeys keys and keeps the active one', () => {
    const limiter = new TokenBucketLimiter({ capacity: 2, refillRate: 0.001, maxKeys: 100 });
    limiter.isAllowed('attacker');
    limiter.isAllowed('attacker');
    for (let i = 0; i < 1000; i++) {
      limiter.isAllowed(`rotating-${i}`);
      if (i % 20 === 0) limiter.isAllowed('attacker');
    }
    const metrics = limiter.getMetrics();
    expect(metrics.totalKeys).toBeLessThanOrEqual(100);
    expect(metrics.evictedKeys).toBeGreaterThan(800);
    // still limited: its empty bucket survived because it stayed recently used
    expect(limiter.isAllowed('attacker').allowed).toBe(false);
    limiter.destroy();
  });

  test('sliding window holds at most maxKeys keys', () => {
    const limiter = new SlidingWindowLimiter({ windowSizeMs: 60_000, maxRequests: 10, maxKeys: 50 });
    for (let i = 0; i < 500; i++) limiter.isAllowed(`k${i}`);
    expect(limiter.getMetrics().totalKeys).toBeLessThanOrEqual(50);
    expect(limiter.getCurrentCount('k499')).toBe(1);
    expect(limiter.getCurrentCount('k0')).toBe(0);
    limiter.destroy();
  });

  test('IP velocity tracking is bounded', async () => {
    const analyzer = new IPAnalyzer({ maxTrackedIps: 20 });
    for (let i = 0; i < 200; i++) await analyzer.analyze(`203.0.113.${i}`);
    expect(analyzer.getMetrics().cacheSize).toBeLessThanOrEqual(20);
  });

  test('session manager drops least recently used sessions at the bound', () => {
    const sessions = new SessionManager({ secretKey: 'bounded-test-secret-0123456789', maxSessions: 30 });
    const first = sessions.createSession('198.51.100.1', 'ua');
    for (let i = 0; i < 100; i++) sessions.createSession(`198.51.100.${i + 2}`, 'ua');
    expect(sessions.getSession(first.id)).toBeNull();
    const inner = sessions as unknown as { sessions: { size: number }; requestTimes: Map<string, unknown> };
    expect(inner.sessions.size).toBeLessThanOrEqual(30);
    expect(inner.requestTimes.size).toBe(inner.sessions.size);
    sessions.destroy();
  });
});

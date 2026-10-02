import { TokenBucketLimiter } from '../src/modules/rate-limiter/TokenBucketLimiter';
import { SlidingWindowLimiter } from '../src/modules/rate-limiter/SlidingWindowLimiter';
import { AdaptiveRateLimiter } from '../src/modules/rate-limiter/AdaptiveRateLimiter';

describe('rate limiters', () => {
  let now = 1_000_000;
  beforeEach(() => { now = 1_000_000; jest.spyOn(Date, 'now').mockImplementation(() => now); });
  afterEach(() => jest.restoreAllMocks());

  it('token bucket allows up to capacity, then refills over time', () => {
    const limiter = new TokenBucketLimiter({ capacity: 3, refillRate: 1 });
    expect([1, 2, 3].map(() => limiter.isAllowed('ip').allowed)).toEqual([true, true, true]);
    const blocked = limiter.isAllowed('ip');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    now += 1000;
    expect(limiter.isAllowed('ip').allowed).toBe(true);
    expect(limiter.isAllowed('other-ip').allowed).toBe(true);
    limiter.destroy();
  });

  it('sliding window blocks after maxRequests until the window passes', () => {
    const limiter = new SlidingWindowLimiter({ windowSizeMs: 1000, maxRequests: 2 });
    expect(limiter.isAllowed('k').allowed).toBe(true);
    expect(limiter.isAllowed('k').allowed).toBe(true);
    expect(limiter.isAllowed('k').allowed).toBe(false);
    now += 1001;
    expect(limiter.isAllowed('k').allowed).toBe(true);
    limiter.destroy();
  });

  it('adaptive limiter emits a well-formed signal when the limit is exceeded', () => {
    const limiter = new AdaptiveRateLimiter({ baseCapacity: 1, baseRefillRate: 0.001, baseWindowMs: 60_000, baseMaxRequests: 100 });
    expect(limiter.check('ip').allowed).toBe(true);
    const result = limiter.check('ip', '/login');
    expect(result.allowed).toBe(false);
    expect(result.signals[0]).toMatchObject({ category: 'network', type: 'rate_limit.exceeded' });
    expect(result.signals[0].value).toBeGreaterThan(0);
    limiter.destroy();
  });
});

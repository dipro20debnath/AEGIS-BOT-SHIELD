import { RateLimiter } from '../src/network/RateLimiter';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter({
      limit: 10,
      windowMs: 60000,
      type: 'token_bucket'
    });
  });

  it('should allow requests under limit (Token bucket)', async () => {
    const ip = '192.168.1.100';
    for(let i=0; i<5; i++) {
      const result = await limiter.check(ip);
      expect(result.allowed).toBe(true);
    }
  });

  it('should block requests over limit (Token bucket)', async () => {
    const ip = '192.168.1.101';
    for(let i=0; i<10; i++) {
      await limiter.check(ip);
    }
    const result = await limiter.check(ip);
    expect(result.allowed).toBe(false);
  });

  it('should expire sliding window', async () => {
    jest.useFakeTimers();
    const ip = '192.168.1.102';
    
    for(let i=0; i<10; i++) {
      await limiter.check(ip);
    }
    expect((await limiter.check(ip)).allowed).toBe(false);
    
    // Fast-forward past the window
    jest.advanceTimersByTime(60001);
    
    expect((await limiter.check(ip)).allowed).toBe(true);
    jest.useRealTimers();
  });

  it('should adjust rate on attack detection (Adaptive)', async () => {
    const adaptiveLimiter = new RateLimiter({ adaptive: true, limit: 100 });
    const ip = '10.0.0.1';
    
    // Simulate attack trigger
    adaptiveLimiter.triggerAttackMode(ip);
    
    // Should now block at a much lower threshold
    let blocked = false;
    for(let i=0; i<20; i++) {
      const res = await adaptiveLimiter.check(ip);
      if (!res.allowed) blocked = true;
    }
    expect(blocked).toBe(true);
  });

  it('should track per-IP rates independently', async () => {
    const ip1 = '192.168.0.1';
    const ip2 = '192.168.0.2';
    
    for(let i=0; i<10; i++) {
      await limiter.check(ip1);
    }
    
    expect((await limiter.check(ip1)).allowed).toBe(false);
    expect((await limiter.check(ip2)).allowed).toBe(true);
  });

  it('should cleanup expired entries to prevent memory leaks', async () => {
    const ip = '192.168.0.3';
    await limiter.check(ip);
    expect(limiter.getStoreSize()).toBeGreaterThan(0);
    
    limiter.cleanup(Date.now() + 100000); // Pass future time to force cleanup
    expect(limiter.getStoreSize()).toBe(0);
  });
});

import { Logger } from '../../utils/logger.js';

/** Token bucket entry for a single key */
interface Bucket {
  tokens: number;
  lastRefill: number;
  totalRequests: number;
  blockedRequests: number;
  firstSeen: number;
}

/**
 * Token Bucket Rate Limiter
 * 
 * Implements the token bucket algorithm for smooth rate limiting.
 * Supports per-IP, per-session, and per-endpoint tracking.
 * Features automatic cleanup of stale entries to prevent memory leaks.
 * 
 * @example
 * ```typescript
 * const limiter = new TokenBucketLimiter({
 *   capacity: 50,
 *   refillRate: 5,
 *   cleanupIntervalMs: 60_000,
 * });
 * 
 * if (!limiter.isAllowed('192.168.1.1')) {
 *   // Rate limited!
 * }
 * ```
 */
export class TokenBucketLimiter {
  private buckets = new Map<string, Bucket>();
  private capacity: number;
  private refillRate: number; // tokens per second
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private cleanupIntervalMs: number;
  private maxAge: number;
  private logger: Logger;
  private totalAllowed = 0;
  private totalBlocked = 0;

  constructor(options: {
    capacity: number;
    refillRate: number;
    cleanupIntervalMs?: number;
    maxAge?: number;
  }) {
    this.capacity = options.capacity;
    this.refillRate = options.refillRate;
    this.cleanupIntervalMs = options.cleanupIntervalMs || 60_000;
    this.maxAge = options.maxAge || 600_000; // 10 min default
    this.logger = new Logger('TokenBucketLimiter');
    this.startCleanup();
  }

  public isAllowed(key: string, cost: number = 1): { allowed: boolean; remaining: number; retryAfterMs: number } {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = {
        tokens: this.capacity,
        lastRefill: now,
        totalRequests: 0,
        blockedRequests: 0,
        firstSeen: now,
      };
      this.buckets.set(key, bucket);
    }

    this.refillBucket(bucket, now);
    bucket.totalRequests += 1;

    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      this.totalAllowed += 1;
      return { allowed: true, remaining: bucket.tokens, retryAfterMs: 0 };
    }

    bucket.blockedRequests += 1;
    this.totalBlocked += 1;
    const tokensNeeded = cost - bucket.tokens;
    const retryAfterMs = (tokensNeeded / this.refillRate) * 1000;
    
    return { allowed: false, remaining: bucket.tokens, retryAfterMs };
  }

  public consume(key: string, tokens: number): boolean {
    return this.isAllowed(key, tokens).allowed;
  }

  public getStatus(key: string): { tokens: number; capacity: number; totalRequests: number; blockedRequests: number } {
    const bucket = this.buckets.get(key);
    if (!bucket) {
      return { tokens: this.capacity, capacity: this.capacity, totalRequests: 0, blockedRequests: 0 };
    }
    this.refillBucket(bucket, Date.now());
    return {
      tokens: bucket.tokens,
      capacity: this.capacity,
      totalRequests: bucket.totalRequests,
      blockedRequests: bucket.blockedRequests
    };
  }

  public reset(key: string): void {
    this.buckets.delete(key);
  }

  public resetAll(): void {
    this.buckets.clear();
    this.totalAllowed = 0;
    this.totalBlocked = 0;
  }

  public getMetrics(): { totalKeys: number; totalBlocked: number; totalAllowed: number } {
    return {
      totalKeys: this.buckets.size,
      totalBlocked: this.totalBlocked,
      totalAllowed: this.totalAllowed
    };
  }

  private refillBucket(bucket: Bucket, now: number): void {
    const timePassedMs = now - bucket.lastRefill;
    const tokensToAdd = (timePassedMs / 1000) * this.refillRate;
    
    if (tokensToAdd > 0) {
      bucket.tokens = Math.min(this.capacity, bucket.tokens + tokensToAdd);
      bucket.lastRefill = now;
    }
  }

  private startCleanup(): void {
    if (this.cleanupIntervalMs > 0) {
      this.cleanupInterval = setInterval(() => this.cleanup(), this.cleanupIntervalMs);
    }
  }

  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, bucket] of this.buckets.entries()) {
      if (now - bucket.lastRefill > this.maxAge) {
        this.buckets.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      this.logger.debug(`Cleaned up ${cleaned} stale rate limit buckets`);
    }
  }

  public destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.buckets.clear();
  }
}

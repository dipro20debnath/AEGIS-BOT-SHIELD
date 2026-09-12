export class TokenBucketLimiter {
  private buckets = new Map<string, { tokens: number; lastRefill: number }>();
  
  constructor(private capacity: number, private refillRate: number) {}

  public isAllowed(key: string): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(key) || { tokens: this.capacity, lastRefill: now };

    const timePassed = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + timePassed * this.refillRate);
    bucket.lastRefill = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      this.buckets.set(key, bucket);
      return true;
    }

    this.buckets.set(key, bucket);
    return false;
  }
}

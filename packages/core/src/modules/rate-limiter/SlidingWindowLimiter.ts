import { Logger } from '../../utils/logger.js';

interface WindowEntry {
  timestamps: number[];
  totalRequests: number;
  blockedRequests: number;
}

/**
 * Sliding Window Rate Limiter
 * 
 * More accurate than fixed-window counters.
 * Tracks individual request timestamps within the window.
 * Efficient memory: auto-prunes expired timestamps.
 */
export class SlidingWindowLimiter {
  private windows = new Map<string, WindowEntry>();
  private windowSizeMs: number;
  private maxRequests: number;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private logger: Logger;
  private totalBlocked = 0;

  constructor(options: {
    windowSizeMs: number;
    maxRequests: number;
    cleanupIntervalMs?: number;
  }) {
    this.windowSizeMs = options.windowSizeMs;
    this.maxRequests = options.maxRequests;
    this.logger = new Logger('SlidingWindowLimiter');
    
    const cleanupMs = options.cleanupIntervalMs || Math.max(60_000, this.windowSizeMs * 2);
    this.cleanupInterval = setInterval(() => this.cleanup(), cleanupMs);
  }

  public isAllowed(key: string): { allowed: boolean; remaining: number; resetMs: number } {
    const now = Date.now();
    let entry = this.windows.get(key);

    if (!entry) {
      entry = { timestamps: [], totalRequests: 0, blockedRequests: 0 };
      this.windows.set(key, entry);
    }

    entry.totalRequests++;

    // Prune old timestamps
    const threshold = now - this.windowSizeMs;
    while (entry.timestamps.length > 0 && entry.timestamps[0] <= threshold) {
      entry.timestamps.shift();
    }

    if (entry.timestamps.length < this.maxRequests) {
      entry.timestamps.push(now);
      return { 
        allowed: true, 
        remaining: this.maxRequests - entry.timestamps.length,
        resetMs: entry.timestamps[0] + this.windowSizeMs - now
      };
    }

    entry.blockedRequests++;
    this.totalBlocked++;
    return {
      allowed: false,
      remaining: 0,
      resetMs: entry.timestamps[0] + this.windowSizeMs - now
    };
  }

  public getCurrentCount(key: string): number {
    const entry = this.windows.get(key);
    if (!entry) return 0;
    
    const now = Date.now();
    const threshold = now - this.windowSizeMs;
    return entry.timestamps.filter(t => t > threshold).length;
  }

  public getMetrics(): { totalKeys: number; totalBlocked: number } {
    return {
      totalKeys: this.windows.size,
      totalBlocked: this.totalBlocked
    };
  }

  public reset(key: string): void {
    this.windows.delete(key);
  }

  private cleanup(): void {
    const now = Date.now();
    const threshold = now - this.windowSizeMs;
    let cleaned = 0;

    for (const [key, entry] of this.windows.entries()) {
      if (entry.timestamps.length === 0 || entry.timestamps[entry.timestamps.length - 1] <= threshold) {
        this.windows.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug(`Cleaned up ${cleaned} inactive sliding window entries`);
    }
  }

  public destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.windows.clear();
  }
}

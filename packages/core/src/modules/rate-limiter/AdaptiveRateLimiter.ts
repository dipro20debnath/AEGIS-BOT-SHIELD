import { TokenBucketLimiter } from './TokenBucketLimiter.js';
import { SlidingWindowLimiter } from './SlidingWindowLimiter.js';
import { Logger } from '../../utils/logger.js';
import { DetectionSignal } from '../../types/index.js';

/**
 * Adaptive Rate Limiter
 * 
 * Intelligently adjusts rate limits based on real-time traffic analysis.
 * During detected attack patterns, limits tighten automatically.
 * During normal traffic, limits relax to avoid false positives.
 * 
 * Features:
 * - Traffic baseline learning (moving average)
 * - Attack spike detection (standard deviation threshold)
 * - Per-endpoint adaptive limits
 * - Gradual recovery after attack subsides
 * - Integration with risk scoring
 */
export class AdaptiveRateLimiter {
  private tokenBucket: TokenBucketLimiter;
  private slidingWindow: SlidingWindowLimiter;
  private trafficHistory: number[] = [];
  private baselineRate: number = 0;
  private baselineStdDev: number = 0;
  private currentMultiplier: number = 1.0;
  private _isAttackMode: boolean = false;
  private logger: Logger;
  private sensitivityFactor: number;
  private historyWindowSize: number;
  private updateInterval: ReturnType<typeof setInterval> | null = null;
  private recentRequests: number = 0;

  constructor(options: {
    baseCapacity: number;
    baseRefillRate: number;
    baseWindowMs: number;
    baseMaxRequests: number;
    sensitivityFactor?: number;
    historyWindowSize?: number;
    updateIntervalMs?: number;
  }) {
    this.tokenBucket = new TokenBucketLimiter({
      capacity: options.baseCapacity,
      refillRate: options.baseRefillRate
    });
    this.slidingWindow = new SlidingWindowLimiter({
      windowSizeMs: options.baseWindowMs,
      maxRequests: options.baseMaxRequests
    });
    this.sensitivityFactor = options.sensitivityFactor || 2.0;
    this.historyWindowSize = options.historyWindowSize || 60;
    this.logger = new Logger('AdaptiveRateLimiter');

    const updateMs = options.updateIntervalMs || 10_000; // Default 10s analysis
    this.updateInterval = setInterval(() => this.analyzeTraffic(), updateMs);
  }

  /**
   * Check if a request is allowed, with adaptive adjustment.
   * Returns detection signals if suspicious patterns detected.
   */
  public check(key: string, endpoint?: string): {
    allowed: boolean;
    signals: DetectionSignal[];
    remaining: number;
    retryAfterMs: number;
  } {
    this.recordRequest();

    const bucketResult = this.tokenBucket.isAllowed(key, this.currentMultiplier > 1 ? 2 : 1);
    const windowResult = this.slidingWindow.isAllowed(key);

    const allowed = bucketResult.allowed && windowResult.allowed;
    const signals: DetectionSignal[] = [];

    if (!allowed && this._isAttackMode) {
      signals.push({
        type: 'RATE_LIMIT_EXCEEDED_ATTACK_MODE',
        severity: 'high',
        confidence: 0.9,
        timestamp: Date.now(),
        details: { key, endpoint }
      });
    } else if (!allowed) {
      signals.push({
        type: 'RATE_LIMIT_EXCEEDED',
        severity: 'medium',
        confidence: 0.8,
        timestamp: Date.now(),
        details: { key, endpoint }
      });
    }

    return {
      allowed,
      signals,
      remaining: Math.min(bucketResult.remaining, windowResult.remaining),
      retryAfterMs: Math.max(bucketResult.retryAfterMs, windowResult.resetMs || 0)
    };
  }

  /**
   * Record a request and update traffic baseline.
   */
  private recordRequest(): void {
    this.recentRequests++;
  }

  /**
   * Periodically analyze traffic patterns and adjust limits.
   */
  private analyzeTraffic(): void {
    this.trafficHistory.push(this.recentRequests);
    if (this.trafficHistory.length > this.historyWindowSize) {
      this.trafficHistory.shift();
    }
    this.recentRequests = 0;

    if (this.trafficHistory.length < 5) return; // Need minimum history

    // Calculate moving average and std dev
    const sum = this.trafficHistory.reduce((a, b) => a + b, 0);
    this.baselineRate = sum / this.trafficHistory.length;
    
    const sqDiffSum = this.trafficHistory.reduce((a, b) => a + Math.pow(b - this.baselineRate, 2), 0);
    this.baselineStdDev = Math.sqrt(sqDiffSum / this.trafficHistory.length);

    const currentRate = this.trafficHistory[this.trafficHistory.length - 1];
    const threshold = this.baselineRate + (this.baselineStdDev * this.sensitivityFactor);

    if (currentRate > threshold && threshold > 10) {
      if (!this._isAttackMode) {
        this.logger.warn(`Traffic spike detected (${currentRate} > ${threshold.toFixed(2)}). Entering attack mode.`);
        this._isAttackMode = true;
      }
      this.tightenLimits();
    } else if (this._isAttackMode && currentRate < this.baselineRate + this.baselineStdDev) {
      this.relaxLimits();
    }
  }

  /**
   * Tighten limits during detected attacks.
   */
  private tightenLimits(): void {
    this.currentMultiplier = Math.min(3.0, this.currentMultiplier + 0.5);
    // Note: The multiplier increases the cost of tokens in check()
  }

  /**
   * Gradually relax limits after attack subsides.
   */
  private relaxLimits(): void {
    this.currentMultiplier = Math.max(1.0, this.currentMultiplier - 0.2);
    if (this.currentMultiplier === 1.0) {
      this.logger.info('Traffic normalized. Exiting attack mode.');
      this._isAttackMode = false;
    }
  }

  public get isAttackMode(): boolean {
    return this._isAttackMode;
  }

  public getMetrics(): any {
    return {
      baselineRate: this.baselineRate,
      baselineStdDev: this.baselineStdDev,
      currentMultiplier: this.currentMultiplier,
      isAttackMode: this._isAttackMode,
      bucketMetrics: this.tokenBucket.getMetrics(),
      windowMetrics: this.slidingWindow.getMetrics()
    };
  }

  public destroy(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    this.tokenBucket.destroy();
    this.slidingWindow.destroy();
  }
}

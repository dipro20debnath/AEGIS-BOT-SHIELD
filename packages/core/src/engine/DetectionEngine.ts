/**
 * DetectionEngine - Core bot detection engine for AEGIS BOT SHIELD.
 * Wires up all detection modules and aggregates signals.
 */
import {
  AegisConfig, AegisRequest, AegisResult, AegisVerdict,
  RiskScore, DetectionSignal, ThreatCategory,
  AegisEvent, AegisEventHandler, AegisEventType
} from '../types/index.js';
import { mergeConfig } from '../config/defaults.js';
import { RiskScorer } from './RiskScorer.js';
import { TokenBucketLimiter } from '../modules/rate-limiter/TokenBucketLimiter.js';
import { SlidingWindowLimiter } from '../modules/rate-limiter/SlidingWindowLimiter.js';
import { Logger } from '../utils/logger.js';

export class DetectionEngine {
  private config: AegisConfig;
  private logger: Logger;
  private riskScorer: RiskScorer;
  private events: Map<AegisEventType, AegisEventHandler[]>;
  private isRunning: boolean = false;

  // Modules
  private tokenLimiter: TokenBucketLimiter;
  private slidingLimiter: SlidingWindowLimiter;

  constructor(config: Partial<AegisConfig> = {}) {
    this.config = mergeConfig(config);
    this.logger = new Logger(this.config.logLevel);
    this.riskScorer = new RiskScorer(this.config.weights);
    this.events = new Map();

    // Init limiters
    this.tokenLimiter = new TokenBucketLimiter(this.config.rateLimit.capacity, this.config.rateLimit.refillRate);
    this.slidingLimiter = new SlidingWindowLimiter(this.config.rateLimit.windowMs, this.config.rateLimit.maxRequests);
  }

  public async init(): Promise<void> {
    if (this.isRunning) return;
    this.logger.info('Initializing AEGIS Detection Engine...');
    this.isRunning = true;
    this.emit({ type: 'engine:ready', timestamp: Date.now(), payload: {} });
  }

  public async shutdown(): Promise<void> {
    if (!this.isRunning) return;
    this.logger.info('Shutting down AEGIS Detection Engine...');
    this.isRunning = false;
    this.events.clear();
  }

  public on(event: AegisEventType, handler: AegisEventHandler): void {
    const handlers = this.events.get(event) || [];
    handlers.push(handler);
    this.events.set(event, handlers);
  }

  public off(event: AegisEventType, handler: AegisEventHandler): void {
    const handlers = this.events.get(event);
    if (handlers) {
      this.events.set(event, handlers.filter(h => h !== handler));
    }
  }

  private emit(event: AegisEvent): void {
    const handlers = this.events.get(event.type) || [];
    for (const handler of handlers) {
      try {
        handler(event);
      } catch (error) {
        this.logger.error(`Error in event handler for ${event.type}:`, error);
      }
    }
  }

  /**
   * Main entry point for analyzing a request.
   * @param request - The incoming request object
   * @returns A promise resolving to an AegisResult
   */
  public async analyze(request: AegisRequest): Promise<AegisResult> {
    const startTime = performance.now();
    const signals: DetectionSignal[] = [];
    const executionTimes: Record<string, number> = {};

    if (!this.isRunning) {
      return this.createFailOpenResult(request, 'Engine not initialized');
    }

    try {
      // 1. Rate Limiting (Fast Reject)
      const limiterStartTime = performance.now();
      const isRateLimited = await this.checkRateLimits(request);
      executionTimes['rateLimiting'] = performance.now() - limiterStartTime;

      if (isRateLimited) {
        return this.createRejectResult(request, 'Rate limit exceeded', ThreatCategory.RATE_LIMIT);
      }

      // 2. IP Intelligence
      const ipStartTime = performance.now();
      signals.push(...await this.analyzeIPIntelligence(request));
      executionTimes['ipIntelligence'] = performance.now() - ipStartTime;

      // 3. Header Analysis
      const headerStartTime = performance.now();
      signals.push(...await this.analyzeHeaders(request));
      executionTimes['headerAnalysis'] = performance.now() - headerStartTime;

      // 4. TLS Fingerprinting
      const tlsStartTime = performance.now();
      signals.push(...await this.analyzeTLSFingerprint(request));
      executionTimes['tlsFingerprinting'] = performance.now() - tlsStartTime;

      // 5. Honeypot Detection
      const honeypotStartTime = performance.now();
      signals.push(...await this.checkHoneypots(request));
      executionTimes['honeypots'] = performance.now() - honeypotStartTime;

      // 6. Behavioral Analysis (Client SDK Token)
      const behavioralStartTime = performance.now();
      signals.push(...await this.analyzeBehavioralData(request));
      executionTimes['behavioral'] = performance.now() - behavioralStartTime;

      // 7. Aggregate & Score
      const scoringStartTime = performance.now();
      const riskScore = this.riskScorer.calculateCompositeScore(signals);
      executionTimes['scoring'] = performance.now() - scoringStartTime;

      const verdict = this.determineVerdict(riskScore.score);
      const executionTime = performance.now() - startTime;

      const result: AegisResult = {
        requestId: request.id,
        verdict,
        riskScore,
        signals,
        executionTime,
        executionTimes
      };

      this.emit({ type: 'analysis:complete', timestamp: Date.now(), payload: result });

      return result;
    } catch (error) {
      this.logger.error('Error during request analysis:', error);
      return this.createFailOpenResult(request, 'Analysis failed');
    }
  }

  private async checkRateLimits(request: AegisRequest): Promise<boolean> {
    const ip = request.ip;
    const [tokenOk, windowOk] = await Promise.all([
      this.tokenLimiter.consume(ip),
      this.slidingLimiter.record(ip)
    ]);
    return !tokenOk || !windowOk;
  }

  private async analyzeIPIntelligence(request: AegisRequest): Promise<DetectionSignal[]> {
    return [{
      type: 'ip:reputation',
      category: 'reputation',
      value: 10,
      confidence: 0.8,
      weight: 1.0,
      metadata: { ip: request.ip }
    }];
  }

  private async analyzeHeaders(request: AegisRequest): Promise<DetectionSignal[]> {
    return [{
      type: 'header:consistency',
      category: 'protocol',
      value: 5,
      confidence: 0.9,
      weight: 0.8,
      metadata: { userAgent: request.headers['user-agent'] }
    }];
  }

  private async analyzeTLSFingerprint(request: AegisRequest): Promise<DetectionSignal[]> {
    return [{
      type: 'tls:fingerprint',
      category: 'protocol',
      value: 0,
      confidence: 0.7,
      weight: 1.0
    }];
  }

  private async checkHoneypots(request: AegisRequest): Promise<DetectionSignal[]> {
    return [{
      type: 'honeypot:interaction',
      category: 'behavioral',
      value: 0,
      confidence: 1.0,
      weight: 1.5
    }];
  }

  private async analyzeBehavioralData(request: AegisRequest): Promise<DetectionSignal[]> {
    return [{
      type: 'behavioral:mouse_movement',
      category: 'behavioral',
      value: 0,
      confidence: 0.8,
      weight: 1.0
    }];
  }

  private determineVerdict(score: number): AegisVerdict {
    if (score >= this.config.thresholds.block) return AegisVerdict.BLOCK;
    if (score >= this.config.thresholds.challenge) return AegisVerdict.CHALLENGE;
    return AegisVerdict.ALLOW;
  }

  private createRejectResult(request: AegisRequest, reason: string, category: ThreatCategory): AegisResult {
    return {
      requestId: request.id,
      verdict: AegisVerdict.BLOCK,
      riskScore: this.riskScorer.emptyScore(),
      signals: [{
        type: 'engine:reject',
        category: 'network',
        value: 100,
        confidence: 1.0,
        weight: 1.0,
        metadata: { reason }
      }],
      executionTime: 0,
      executionTimes: {}
    };
  }

  private createFailOpenResult(request: AegisRequest, reason: string): AegisResult {
    this.logger.warn(`Fail-open triggered for request ${request.id}: ${reason}`);
    return {
      requestId: request.id,
      verdict: AegisVerdict.ALLOW,
      riskScore: this.riskScorer.emptyScore(),
      signals: [],
      executionTime: 0,
      executionTimes: {}
    };
  }
}

/**
 * DetectionEngine - Core bot detection engine for AEGIS BOT SHIELD.
 * Runs the enabled detection modules on a request, fuses their signals with
 * the RiskScorer and turns the score into a verdict according to the mode.
 */
import {
  AegisConfig, AegisRequest, AegisResult, AegisVerdict,
  DetectionSignal, ThreatCategory, BehavioralPayload,
  AegisEvent, AegisEventHandler, AegisEventType
} from '../types/index.js';
import { mergeConfig } from '../config/defaults.js';
import { RiskScorer } from './RiskScorer.js';
import { TokenBucketLimiter } from '../modules/rate-limiter/TokenBucketLimiter.js';
import { SlidingWindowLimiter } from '../modules/rate-limiter/SlidingWindowLimiter.js';
import { IPAnalyzer } from '../modules/ip-intelligence/IPAnalyzer.js';
import { HeaderAnalyzer } from '../modules/fingerprint/HeaderAnalyzer.js';
import { TLSFingerprinter } from '../modules/fingerprint/TLSFingerprinter.js';
import { HTTP2Fingerprinter } from '../modules/fingerprint/HTTP2Fingerprinter.js';
import { HoneypotDetector } from '../modules/honeypot/HoneypotDetector.js';
import { ThreatDatabase } from '../modules/threat-intel/ThreatDatabase.js';
import { SessionManager } from '../modules/session/SessionManager.js';
import { Logger } from '../utils/logger.js';

/** Header carrying the signed session token issued by the engine. */
export const SESSION_HEADER = 'x-aegis-session';

export class DetectionEngine {
  private config: AegisConfig;
  private logger: Logger;
  private riskScorer: RiskScorer;
  private events: Map<AegisEventType, AegisEventHandler[]> = new Map();
  private isRunning = false;

  // Modules (undefined when disabled in config.modules)
  private tokenLimiter?: TokenBucketLimiter;
  private windowLimiter?: SlidingWindowLimiter;
  private endpointLimiters: Map<string, SlidingWindowLimiter> = new Map();
  private ipAnalyzer?: IPAnalyzer;
  private headerAnalyzer?: HeaderAnalyzer;
  private tlsFingerprinter?: TLSFingerprinter;
  private http2Fingerprinter?: HTTP2Fingerprinter;
  private honeypot?: HoneypotDetector;
  private threatDb?: ThreatDatabase;
  private sessions?: SessionManager;

  constructor(config: Partial<AegisConfig> = {}) {
    this.config = mergeConfig(config);
    this.logger = new Logger('DetectionEngine');
    this.riskScorer = new RiskScorer();

    const { modules, rateLimiting, ipIntelligence } = this.config;

    if (modules.rateLimiter && rateLimiting.enabled) {
      this.tokenLimiter = new TokenBucketLimiter({
        capacity: rateLimiting.perIpCapacity,
        refillRate: rateLimiting.perIpRefillRate,
      });
      this.windowLimiter = new SlidingWindowLimiter({
        windowSizeMs: rateLimiting.windowMs,
        maxRequests: rateLimiting.maxRequests,
      });
      for (const [path, limit] of Object.entries(rateLimiting.endpointLimits)) {
        this.endpointLimiters.set(path, new SlidingWindowLimiter({
          windowSizeMs: limit.windowMs,
          maxRequests: limit.maxRequests,
        }));
      }
    }
    if (modules.ipIntelligence && ipIntelligence.enabled) {
      this.ipAnalyzer = new IPAnalyzer({
        blocklist: ipIntelligence.blocklist,
        allowlist: ipIntelligence.allowlist,
        externalGeoLookup: ipIntelligence.externalGeoLookup,
      });
    }
    if (modules.headerAnalysis) this.headerAnalyzer = new HeaderAnalyzer();
    if (modules.tlsFingerprint) this.tlsFingerprinter = new TLSFingerprinter();
    if (modules.http2Fingerprint) this.http2Fingerprinter = new HTTP2Fingerprinter();
    if (modules.honeypot) this.honeypot = new HoneypotDetector();
    if (modules.threatIntel) this.threatDb = new ThreatDatabase();
    if (modules.sessionTracking && this.config.secretKey) {
      this.sessions = new SessionManager({ secretKey: this.config.secretKey });
    }
  }

  public async init(): Promise<void> {
    if (this.isRunning) return;
    this.logger.info('Initializing AEGIS Detection Engine');
    this.isRunning = true;
  }

  /** Stops module timers and releases state. */
  public async shutdown(): Promise<void> {
    this.isRunning = false;
    this.tokenLimiter?.destroy();
    this.windowLimiter?.destroy();
    this.endpointLimiters.forEach(l => l.destroy());
    this.tlsFingerprinter?.destroy();
    this.threatDb?.destroy();
    this.sessions?.destroy();
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

  /** Threat database, e.g. to add blocklist entries at runtime. */
  public getThreatDatabase(): ThreatDatabase | undefined {
    return this.threatDb;
  }

  public getConfig(): AegisConfig {
    return this.config;
  }

  private emit(event: AegisEvent): void {
    for (const handler of this.events.get(event.type) || []) {
      try {
        handler(event);
      } catch (error) {
        this.logger.error(`Error in event handler for ${event.type}`, error);
      }
    }
  }

  /**
   * Analyze a request. Fails open (verdict 'allow') if the engine is not
   * running or a module throws, so a detection bug never takes the site down.
   */
  public async analyze(request: AegisRequest): Promise<AegisResult> {
    const startTime = performance.now();

    if (!this.isRunning) {
      return this.failOpen(request, 'Engine not initialized', startTime);
    }

    try {
      const rateLimitSignal = this.checkRateLimits(request);
      if (rateLimitSignal && this.config.mode !== 'monitor') {
        return this.finish(request, [rateLimitSignal], 'block', 'Rate limit exceeded', startTime);
      }

      const signals: DetectionSignal[] = rateLimitSignal ? [rateLimitSignal] : [];
      const userAgent = this.header(request, 'user-agent') ?? '';

      if (this.ipAnalyzer) {
        signals.push(...(await this.ipAnalyzer.analyze(request.ip)).signals);
      }
      if (this.threatDb) {
        signals.push(...this.threatDb.checkIP(request.ip).signals);
        if (userAgent) signals.push(...this.threatDb.checkUserAgent(userAgent).signals);
      }
      if (this.headerAnalyzer) {
        signals.push(...this.headerAnalyzer.analyze(request.headers, request.method, request.path));
      }
      if (this.tlsFingerprinter && request.tls) {
        signals.push(...this.tlsFingerprinter.analyze(request.tls, userAgent, request.ip));
      }
      if (this.http2Fingerprinter && request.http2) {
        signals.push(...this.http2Fingerprinter.analyze(request.http2, userAgent));
      }
      if (this.honeypot) {
        signals.push(...this.honeypot.checkRequest(request.path, request.method, request.body).signals);
      }

      let sessionToken: string | undefined;
      let sessionId: string | undefined;
      if (this.sessions) {
        const result = this.sessions.processRequest({
          sessionToken: this.header(request, SESSION_HEADER),
          ip: request.ip,
          path: request.path,
          deviceFingerprint: request.behavioralData?.fingerprint,
        });
        signals.push(...result.signals);
        sessionToken = result.token;
        sessionId = result.session.id;
      }

      if (this.config.modules.behavioral && this.config.behavioral.enabled && request.behavioralData) {
        signals.push(...analyzeBehavior(request.behavioralData));
      }

      const riskScore = this.riskScorer.calculateCompositeScore(signals);
      const verdict = this.decide(riskScore.score);
      if (this.sessions && sessionId) {
        this.sessions.addVerdict(sessionId, verdict, riskScore.score);
      }
      const reason = verdict === 'allow'
        ? 'No significant risk detected'
        : topReasons(signals);

      return this.finish(request, signals, verdict, reason, startTime, sessionToken);
    } catch (error) {
      this.logger.error('Error during request analysis', error);
      return this.failOpen(request, 'Analysis failed', startTime);
    }
  }

  private header(request: AegisRequest, name: string): string | undefined {
    const value = request.headers[name] ?? request.headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  }

  /** Returns a signal when the request exceeds any rate limit. */
  private checkRateLimits(request: AegisRequest): DetectionSignal | null {
    if (!this.tokenLimiter || !this.windowLimiter) return null;

    const endpointLimiter = this.endpointLimiters.get(request.path);
    const checks: Array<[string, boolean]> = [
      ['per-IP burst', this.tokenLimiter.isAllowed(request.ip).allowed],
      ['per-IP window', this.windowLimiter.isAllowed(request.ip).allowed],
    ];
    if (endpointLimiter) {
      checks.push([`endpoint ${request.path}`, endpointLimiter.isAllowed(`${request.ip}|${request.path}`).allowed]);
    }
    const exceeded = checks.filter(([, allowed]) => !allowed).map(([name]) => name);
    if (exceeded.length === 0) return null;

    return {
      category: 'network',
      type: 'rate_limit.exceeded',
      value: 100,
      confidence: 1.0,
      description: `Rate limit exceeded: ${exceeded.join(', ')}`,
      weight: 2.0,
    };
  }

  private decide(score: number): AegisVerdict {
    const { block, challenge, monitor } = this.config.thresholds;
    switch (this.config.mode) {
      case 'monitor':
        return score >= monitor ? 'monitor' : 'allow';
      case 'strict':
        if (score >= Math.max(challenge, block - 15)) return 'block';
        if (score >= monitor) return 'challenge';
        return 'allow';
      default:
        if (score >= block) return 'block';
        if (score >= challenge) return 'challenge';
        return 'allow';
    }
  }

  private finish(
    request: AegisRequest,
    signals: DetectionSignal[],
    verdict: AegisVerdict,
    reason: string,
    startTime: number,
    sessionToken?: string,
  ): AegisResult {
    const riskScore = this.riskScorer.calculateCompositeScore(signals);
    const result: AegisResult = {
      verdict,
      riskScore,
      challengeType: verdict === 'challenge' ? this.config.challenges.defaultType : undefined,
      reason,
      signals,
      threats: classifyThreats(signals, request.path),
      processingTimeMs: performance.now() - startTime,
      requestId: request.requestId,
      timestamp: Date.now(),
      sessionToken,
    };

    this.emit({ type: 'request.analyzed', timestamp: result.timestamp, requestId: request.requestId,
      data: { verdict, score: riskScore.score } });
    if (verdict === 'block') {
      this.emit({ type: 'request.blocked', timestamp: result.timestamp, requestId: request.requestId,
        data: { reason, ip: request.ip } });
    } else if (verdict === 'challenge') {
      this.emit({ type: 'request.challenged', timestamp: result.timestamp, requestId: request.requestId,
        data: { reason, challengeType: result.challengeType } });
    }
    return result;
  }

  private failOpen(request: AegisRequest, reason: string, startTime: number): AegisResult {
    this.logger.warn(`Fail-open for request ${request.requestId}: ${reason}`);
    return {
      verdict: 'allow',
      riskScore: this.riskScorer.emptyScore(),
      reason: `Fail-open: ${reason}`,
      signals: [],
      threats: [],
      processingTimeMs: performance.now() - startTime,
      requestId: request.requestId,
      timestamp: Date.now(),
    };
  }
}

/**
 * Rule-based checks on the behavioral summary sent by the JS SDK.
 * The ML engine scores the full feature vector; these rules catch the
 * obvious cases without it.
 */
export function analyzeBehavior(data: BehavioralPayload): DetectionSignal[] {
  const signals: DetectionSignal[] = [];
  const signal = (category: DetectionSignal['category'], type: string, value: number,
                  confidence: number, description: string, weight = 1.0): void => {
    signals.push({ category, type, value, confidence, description, weight });
  };

  if (data.isHeadless) {
    signal('device', 'behavior.headless_browser', 95, 0.9, 'Headless browser detected by SDK', 1.5);
  }
  if (data.isAntiDetect) {
    signal('device', 'behavior.antidetect_browser', 80, 0.7, 'Anti-detect browser indicators', 1.2);
  }

  const { mouse, keyboard, scroll, touch } = data;
  if (mouse && mouse.eventCount >= 10) {
    if (mouse.straightnessIndex > 0.98) {
      signal('behavioral', 'behavior.mouse_linear', 70, 0.7, 'Mouse paths are almost perfectly straight');
    }
    if (mouse.eventCount >= 20 && mouse.microTremorFreq < 2) {
      signal('behavioral', 'behavior.mouse_no_tremor', 55, 0.6, 'No physiological micro-tremor in mouse movement');
    }
  }
  if (keyboard && keyboard.eventCount >= 10) {
    if (keyboard.avgDwellTime < 20) {
      signal('behavioral', 'behavior.key_dwell_too_short', 75, 0.75,
        `Average key dwell ${keyboard.avgDwellTime.toFixed(0)}ms is below human range`);
    }
    if (keyboard.cadenceEntropy < 1.0) {
      signal('behavioral', 'behavior.typing_uniform', 65, 0.7, 'Typing rhythm is mechanically uniform');
    }
  }
  if (scroll && scroll.eventCount > 0
      && scroll.scrollTypes.programmatic > scroll.scrollTypes.wheel + scroll.scrollTypes.touch) {
    signal('behavioral', 'behavior.programmatic_scroll', 50, 0.6, 'Scrolling is mostly programmatic');
  }
  const interactions = (mouse?.eventCount ?? 0) + (keyboard?.eventCount ?? 0)
    + (scroll?.eventCount ?? 0) + (touch?.eventCount ?? 0);
  if (interactions === 0) {
    signal('behavioral', 'behavior.no_interaction', 40, 0.5, 'SDK recorded no user interaction', 0.8);
  }
  return signals;
}

function topReasons(signals: DetectionSignal[]): string {
  return [...signals]
    .sort((a, b) => b.value * b.confidence * b.weight - a.value * a.confidence * a.weight)
    .slice(0, 3)
    .map(s => s.description)
    .join('; ');
}

/** Maps detection signals to OWASP Automated Threat categories. */
export function classifyThreats(signals: DetectionSignal[], path: string): ThreatCategory[] {
  const threats = new Set<ThreatCategory>();
  const has = (prefix: string) => signals.some(s => s.type.startsWith(prefix));
  const isAuthPath = /login|signin|auth/i.test(path);

  if (has('rate_limit')) {
    threats.add(isAuthPath ? ThreatCategory.OAT_008_CREDENTIAL_STUFFING : ThreatCategory.OAT_015_DENIAL_OF_SERVICE);
  }
  if (has('honeypot.form_filled') || has('honeypot.timing')) {
    threats.add(isAuthPath ? ThreatCategory.OAT_019_ACCOUNT_CREATION : ThreatCategory.OAT_017_SPAMMING);
  }
  if (has('honeypot.trap_endpoint')) threats.add(ThreatCategory.OAT_011_SCRAPING);
  if (has('threat.user-agent') || has('threat.pattern')) threats.add(ThreatCategory.OAT_011_SCRAPING);
  if (has('behavior.headless_browser') && isAuthPath) threats.add(ThreatCategory.OAT_008_CREDENTIAL_STUFFING);
  return [...threats];
}

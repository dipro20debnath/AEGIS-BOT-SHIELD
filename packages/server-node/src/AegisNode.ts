/**
 * Framework-independent AEGIS server logic for Node.js (the counterpart of
 * the Python SDK's AegisMiddlewareBase). Adapters for Express, Fastify and
 * plain http call handleTelemetry() and evaluate().
 *
 * - POST {telemetryPath}: scores SDK telemetry with the core DetectionEngine
 *   (IP intelligence, headers, threat DB, session, behaviour rules) plus the
 *   ML service when `mlUrl` is set, and returns a token in the format shared
 *   with the Python SDK (core generateToken).
 * - Other requests: token score + request-level analysis, fused with noisy-OR.
 */
import {
  DetectionEngine, AegisConfig, AegisRequest, BehavioralPayload, DetectionSignal,
  IPAnalyzer, SESSION_HEADER, generateToken, verifyToken, sha256, MemoryHardChallenger, MemoryHardOptions,
  AegisStore, BoundedMap, mergeConfig,
} from '@aegis/core';
import { AegisStats } from './stats.js';
import { AegisMetrics } from './metrics.js';

export const TOKEN_HEADER = 'x-aegis-token';
export const SESSION_COOKIE = 'aegis_sid';

export type Verdict = 'allow' | 'monitor' | 'challenge' | 'block';

export interface AegisNodeOptions {
  siteKey: string;
  secretKey: string;
  mode?: 'monitor' | 'enforce';
  /** Path prefixes to analyse (default: all not excluded) */
  protectedPaths?: string[];
  excludedPaths?: string[];
  /** Path prefixes where requests without a valid token are challenged */
  requireTokenPaths?: string[];
  thresholds?: { block: number; challenge: number };
  telemetryPath?: string;
  /** Proof-of-work challenge endpoint: GET issues, POST {challenge, nonce} verifies */
  challengePath?: string;
  /** scrypt parameters of the challenge (default n=4096, r=8, bits=4) */
  pow?: MemoryHardOptions;
  /** Token lifetime in seconds */
  tokenTtl?: number;
  /** URL of the ML engine service (POST {mlUrl}/predict) */
  mlUrl?: string;
  mlTimeoutMs?: number;
  maxTelemetryBytes?: number;
  /** Extra DetectionEngine configuration */
  engine?: Partial<AegisConfig>;
  /**
   * Shared state for several server instances (e.g. RedisStore from
   * createRedisStore). When set, challenge replay protection, rate limits and
   * session records live in the store, so every instance sees them. Default:
   * in-process state, correct for a single instance.
   */
  store?: AegisStore;
  /** Inactivity after which a session record expires, seconds (default 1800) */
  sessionTtl?: number;
  /** Add the Secure flag to the aegis_sid cookie; set it when the site is served over HTTPS (default false) */
  secureCookies?: boolean;
  /** Collect process metrics (CPU, memory, event loop, GC) in /aegis/metrics (default true) */
  processMetrics?: boolean;
}

export interface AegisDecision {
  verdict: Verdict;
  score: number;
  reasons: string[];
  claims: Record<string, unknown> | null;
  signals: DetectionSignal[];
  /** Engine session token (internal; used by recordResponse) */
  sessionToken?: string;
}

export interface HandlerResponse {
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

export interface RequestInfo {
  method: string;
  path: string;
  ip: string;
  headers: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string>;
  /** Parsed query string (inspected for injection payloads) */
  query?: Record<string, unknown>;
  body?: unknown;
}

const SDK_CATEGORIES = ['mouse', 'keyboard', 'scroll', 'touch', 'fingerprint'] as const;

export function noisyOr(scores: number[]): number {
  return 100 * (1 - scores.reduce((benign, s) => benign * (1 - Math.min(1, Math.max(0, s / 100))), 1));
}

/**
 * Shortest time the reported behaviour can have taken: the typing span, or the
 * mouse pauses alone (count x mean pause). Same rule as the Python server.
 */
export function claimedInteractionSeconds(features: Record<string, Record<string, number>>): number {
  const typing = features.keyboard?.kb_total_duration ?? 0;
  const pauses = (features.mouse?.mouse_pause_count ?? 0) * (features.mouse?.mouse_avg_pause_duration ?? 0) / 1000;
  return Math.max(typing, pauses);
}

/**
 * Score (75) when telemetry claims more interaction time than has passed since the
 * session's first request; the SDK measures from page load, so a browser cannot.
 * Only when the session existed before this telemetry (the page may come from a CDN).
 */
export function impossibleTiming(features: Record<string, Record<string, number>>, elapsedSeconds: number, sessionSeenBefore: boolean): number | null {
  if (!sessionSeenBefore) return null;
  return claimedInteractionSeconds(features) > elapsedSeconds * 1.1 + 2 ? 75 : null;
}

export function userAgentHash(userAgent: string): string {
  return sha256(userAgent).slice(0, 16);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

class TelemetryError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export interface SessionRecord { created: number; times: number[]; paths: string[]; risk: number[]; telemetryScore?: number }

/**
 * Session records (request times, paths, risk history, telemetry score).
 * In-process by default; with a store each record is one JSON value with a
 * TTL. Concurrent requests of one session on different instances are
 * last-writer-wins: a lost update drops one request time, which the session
 * features tolerate. Correctness-critical state (replay, rate limits) uses the
 * store's atomic operations instead.
 *
 * When the store is unreachable, reads return nothing and writes are dropped:
 * the request is analysed with a fresh session instead of skipping analysis.
 */
export class SessionRecords {
  private local: BoundedMap<string, SessionRecord>;

  constructor(private store?: AegisStore, private ttlMs = 1_800_000, private onStoreError?: (operation: string) => void,
    maxLocal = 100_000) {
    this.local = new BoundedMap(maxLocal);
  }

  /** Records held in this process (0 with a shared store). */
  localSize(): number {
    return this.local.size;
  }

  async get(id: string): Promise<SessionRecord | undefined> {
    if (!this.store) {
      const record = this.local.get(id);
      // Same inactivity expiry as the store's TTL (the size bound drops least recently used records).
      if (record && Date.now() - (record.times[record.times.length - 1] ?? record.created) > this.ttlMs) {
        this.local.delete(id);
        return undefined;
      }
      return record;
    }
    try {
      const raw = await this.store.get(`sess:${id}`);
      return raw ? JSON.parse(raw) as SessionRecord : undefined;
    } catch {
      this.onStoreError?.('session_get');
      return undefined;
    }
  }

  async getOrCreate(id: string, now = Date.now()): Promise<SessionRecord> {
    const existing = await this.get(id);
    if (existing) return existing;
    const created: SessionRecord = { created: now, times: [], paths: [], risk: [] };
    if (!this.store) {
      this.local.set(id, created);
    }
    return created;
  }

  /** Persist a record changed in place (no-op in memory, where it is the stored object). */
  async save(id: string, record: SessionRecord): Promise<void> {
    if (record.times.length > 500) record.times.splice(0, record.times.length - 500);
    if (record.risk.length > 100) record.risk.splice(0, record.risk.length - 100);
    if (this.store) await this.store.set(`sess:${id}`, JSON.stringify(record), this.ttlMs).catch(() => this.onStoreError?.('session_set'));
  }
}

export class AegisNode {
  readonly options: Required<Omit<AegisNodeOptions, 'mlUrl' | 'engine' | 'protectedPaths' | 'pow' | 'store' | 'processMetrics'>> &
    Pick<AegisNodeOptions, 'mlUrl' | 'engine' | 'protectedPaths' | 'pow' | 'store' | 'processMetrics'>;
  readonly metrics: AegisMetrics;
  readonly engine: DetectionEngine;
  readonly challenger: MemoryHardChallenger;
  readonly stats = new AegisStats();
  private ipAnalyzer = new IPAnalyzer();
  readonly sessions: SessionRecords;
  private ready: Promise<void>;
  /** Rate limits enforced through the shared store (only when one is configured) */
  private sharedLimits: Array<{ name: string; path?: string; max: number; windowMs: number }> = [];

  constructor(options: AegisNodeOptions) {
    if (!options.secretKey || options.secretKey.length < 16) {
      throw new Error('AEGIS requires a secretKey of at least 16 characters');
    }
    this.options = {
      mode: 'enforce',
      excludedPaths: ['/health', '/favicon.ico'],
      requireTokenPaths: [],
      thresholds: { block: 80, challenge: 50 },
      telemetryPath: '/aegis/telemetry',
      challengePath: '/aegis/challenge',
      tokenTtl: 300,
      mlTimeoutMs: 500,
      maxTelemetryBytes: 64 * 1024,
      sessionTtl: 1800,
      secureCookies: false,
      ...options,
    };
    const engineConfig: Partial<AegisConfig> = {
      ...options.engine,
      siteKey: options.siteKey,
      secretKey: options.secretKey,
      // The engine scores; this class decides (it also fuses token and ML scores)
      mode: 'monitor',
    };
    if (options.store) {
      // The engine's limiters count per process; with a store the same window and
      // endpoint limits are counted in the store instead (the per-IP token bucket is
      // not replicated: the sliding window bounds sustained rates across instances)
      const { rateLimiting, modules } = mergeConfig(engineConfig);
      if (rateLimiting.enabled && modules.rateLimiter) {
        this.sharedLimits.push({ name: 'per-IP window', max: rateLimiting.maxRequests, windowMs: rateLimiting.windowMs });
        for (const [path, limit] of Object.entries(rateLimiting.endpointLimits)) {
          this.sharedLimits.push({ name: `endpoint ${path}`, path, max: limit.maxRequests, windowMs: limit.windowMs });
        }
      }
      engineConfig.rateLimiting = { ...rateLimiting, enabled: false };
    }
    this.engine = new DetectionEngine(engineConfig);
    this.ready = this.engine.init();
    this.challenger = new MemoryHardChallenger(options.secretKey, { ...options.pow, store: options.store });
    this.sessions = new SessionRecords(options.store, this.options.sessionTtl * 1000,
      operation => this.metrics.storeErrors.inc({ operation }));
    this.metrics = new AegisMetrics({ processMetrics: options.processMetrics, sessionCount: (): number => this.sessions.localSize() });
  }

  /**
   * Readiness: the engine is initialised and, when configured, the shared store answers.
   * The ML service is reported but not required (without it the rules decide alone).
   */
  async readiness(): Promise<{ ready: boolean; checks: Record<string, string> }> {
    const checks: Record<string, string> = {};
    await this.ready;
    checks.engine = 'ok';
    if (this.options.store) {
      try { await this.options.store.get('ready-probe'); checks.store = 'ok'; } catch { checks.store = 'unreachable'; }
    }
    if (this.options.mlUrl) {
      try {
        const r = await fetch(`${this.options.mlUrl.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(this.options.mlTimeoutMs) });
        checks.ml = r.ok ? 'ok' : `http ${r.status}`;
      } catch { checks.ml = 'unreachable (rules only)'; }
    }
    return { ready: checks.store !== 'unreachable', checks };
  }

  /**
   * Shared-store rate limits; the reason when one is exceeded. If the store is
   * unreachable the limits are skipped (the rest of the analysis still runs).
   */
  private async checkSharedLimits(req: RequestInfo): Promise<string | null> {
    if (!this.sharedLimits.length) return null;
    const exceeded: string[] = [];
    try {
      await Promise.all(this.sharedLimits
        .filter(l => !l.path || l.path === req.path)
        .map(async l => {
          const count = await this.options.store!.hit(l.path ? `rl:${l.path}|${req.ip}` : `rl:${req.ip}`, l.windowMs);
          if (count > l.max) exceeded.push(l.name);
        }));
    } catch {
      this.metrics.storeErrors.inc({ operation: 'rate_limit' });
      return null;
    }
    return exceeded.length ? 'rate_limit.exceeded' : null;
  }

  async shutdown(): Promise<void> {
    this.challenger.destroy();
    await this.engine.shutdown();
  }

  shouldProtect(path: string): boolean {
    if (this.options.excludedPaths.some(p => path.startsWith(p))) return false;
    if (this.options.protectedPaths) return this.options.protectedPaths.some(p => path.startsWith(p));
    return true;
  }

  isTelemetryRequest(method: string, path: string): boolean {
    return method.toUpperCase() === 'POST' && path === this.options.telemetryPath;
  }

  /** Requests answered by AEGIS itself: telemetry and the proof-of-work challenge. */
  isAegisEndpoint(method: string, path: string): boolean {
    return this.isTelemetryRequest(method, path)
      || (path === this.options.challengePath && ['GET', 'POST'].includes(method.toUpperCase()));
  }

  handleEndpoint(req: RequestInfo): Promise<HandlerResponse> {
    return req.path === this.options.challengePath ? this.handleChallenge(req) : this.handleTelemetry(req);
  }

  /** GET: issue a memory-hard challenge. POST {challenge, nonce}: verify it and return a token. */
  async handleChallenge(req: RequestInfo): Promise<HandlerResponse> {
    const noStore = { 'Cache-Control': 'no-store' };
    if (req.method.toUpperCase() === 'GET') {
      return { status: 200, body: { ...this.challenger.issue() }, headers: noStore };
    }
    let data: { challenge?: unknown; nonce?: unknown } = {};
    try {
      data = typeof req.body === 'string' || Buffer.isBuffer(req.body)
        ? JSON.parse(req.body.toString() || '{}')
        : (req.body as typeof data) ?? {};
    } catch {
      return { status: 400, body: { error: 'invalid JSON' }, headers: noStore };
    }
    let result;
    const stop = this.metrics.duration.startTimer({ kind: 'challenge' });
    try {
      result = await this.challenger.verify(String(data.challenge ?? ''), data.nonce);
    } catch {
      // Store unreachable: refuse rather than risk accepting a replayed solution
      this.metrics.storeErrors.inc({ operation: 'replay' });
      return { status: 503, body: { error: 'challenge verification unavailable' }, headers: noStore };
    } finally {
      stop();
    }
    this.metrics.decisions.inc({ kind: 'challenge', verdict: result.valid ? 'allow' : 'rejected' });
    if (!result.valid) {
      return { status: 403, body: { error: 'challenge failed', reason: result.reason }, headers: noStore };
    }
    const cookie = (req.cookies ?? parseCookies(header(req.headers, 'cookie')))[SESSION_COOKIE];
    const sid = cookie ? cookie.split('.')[0] : 'anonymous';
    // Carry the behavioural (telemetry) score so the work does not erase that evidence. Request
    // signals are not carried: every request recomputes them, and carrying them would count them twice.
    // "tel" marks that the session sent telemetry, which token-required paths need.
    const stats = sid === 'anonymous' ? undefined : await this.sessions.get(sid).catch(() => undefined);
    const token = generateToken({
      sid,
      score: stats?.telemetryScore ?? 0,
      tel: stats?.telemetryScore !== undefined ? 1 : 0,
      verdict: 'allow',
      pow: 1,
      uah: userAgentHash(header(req.headers, 'user-agent') ?? ''),
      exp: Math.floor(Date.now() / 1000) + this.options.tokenTtl,
    }, this.options.secretKey);
    return { status: 200, body: { token, expiresIn: this.options.tokenTtl, verdict: 'allow' }, headers: noStore };
  }

  decide(score: number): Verdict {
    const { block, challenge } = this.options.thresholds;
    if (this.options.mode === 'monitor') return score >= challenge ? 'monitor' : 'allow';
    if (score >= block) return 'block';
    if (score >= challenge) return 'challenge';
    return 'allow';
  }

  // --- telemetry -----------------------------------------------------------

  async handleTelemetry(req: RequestInfo): Promise<HandlerResponse> {
    await this.ready;
    const stop = this.metrics.duration.startTimer({ kind: 'telemetry' });
    try {
      const payload = this.parseTelemetry(req.body);
      const [engineResult, limited] = await Promise.all([
        this.engine.analyze(this.toEngineRequest(req, payload.behavioral as BehavioralPayload)),
        this.checkSharedLimits(req),
      ]);
      const { sessionId, cookieHeaders, record } = await this.session(engineResult.sessionToken, req);

      const scores = [engineResult.riskScore.score];
      const reasons = engineResult.signals.filter(s => s.value * s.confidence >= 20).map(s => s.type);
      if (limited) { scores.push(100); reasons.push(limited); }
      // Spoofed-fingerprint evidence from the SDK: only when several checks agree
      if (payload.antiDetectScore >= 0.5) {
        scores.push(80 * payload.antiDetectScore);
        reasons.push('anti_detect');
      }
      const timing = record ? impossibleTiming(payload.features, (Date.now() - record.created) / 1000, record.times.length > 1) : null;
      if (timing) { scores.push(timing); reasons.push('telemetry.impossible_timing'); }
      const mlProbability = await this.mlScore(payload.features, req.ip, record);
      if (mlProbability !== null) {
        scores.push(mlProbability * 100);
        reasons.push('ml_model');
      }
      const score = Math.round(noisyOr(scores) * 10) / 10;
      const verdict = this.decide(score);
      if (record) {
        record.risk.push(score);
        record.telemetryScore = score;
        await this.sessions.save(sessionId, record);
      }

      const token = generateToken({
        sid: sessionId,
        score,
        verdict,
        uah: userAgentHash(header(req.headers, 'user-agent') ?? ''),
        exp: Math.floor(Date.now() / 1000) + this.options.tokenTtl,
      }, this.options.secretKey);

      this.stats.record({ path: this.options.telemetryPath, verdict, score, reasons, ip: req.ip, telemetry: true });
      stop();
      this.metrics.decisions.inc({ kind: 'telemetry', verdict });
      for (const signal of reasons) this.metrics.signals.inc({ signal });
      return {
        status: 200,
        body: { token, expiresIn: this.options.tokenTtl, verdict, score },
        headers: { ...cookieHeaders, 'Cache-Control': 'no-store' },
      };
    } catch (error) {
      if (error instanceof TelemetryError) {
        return { status: error.status, body: { error: error.message }, headers: {} };
      }
      return { status: 500, body: { error: 'telemetry processing failed' }, headers: {} };
    }
  }

  private parseTelemetry(body: unknown): { features: Record<string, Record<string, number>>; behavioral: unknown; antiDetectScore: number } {
    let data = body;
    if (typeof body === 'string' || Buffer.isBuffer(body)) {
      if (body.length > this.options.maxTelemetryBytes) throw new TelemetryError('telemetry too large', 413);
      try {
        data = JSON.parse(body.toString());
      } catch {
        throw new TelemetryError('invalid telemetry: not JSON');
      }
    } else if (JSON.stringify(body ?? null).length > this.options.maxTelemetryBytes) {
      throw new TelemetryError('telemetry too large', 413);
    }
    const payload = data as Record<string, any>;
    if (!payload || typeof payload !== 'object' || typeof payload.features !== 'object' || payload.features === null) {
      throw new TelemetryError('invalid telemetry: missing features');
    }
    if (payload.siteKey !== this.options.siteKey) throw new TelemetryError('unknown site key', 403);

    const features: Record<string, Record<string, number>> = {};
    for (const category of SDK_CATEGORIES) {
      const group = payload.features[category] ?? {};
      features[category] = {};
      for (const [key, value] of Object.entries(group)) {
        if (typeof value === 'number' && Number.isFinite(value)) features[category][key] = value;
      }
    }
    const antiDetectScore = Number(payload.antiDetect?.score);
    return {
      features,
      behavioral: { timestamp: Date.now(), ...(payload.behavioral ?? {}) },
      antiDetectScore: Number.isFinite(antiDetectScore) ? Math.min(1, Math.max(0, antiDetectScore)) : 0,
    };
  }

  private async mlScore(sdkFeatures: Record<string, Record<string, number>>, ip: string, session: SessionRecord | undefined): Promise<number | null> {
    if (!this.options.mlUrl) return null;
    const { intelligence } = await this.ipAnalyzer.analyze(ip);
    const times = session?.times ?? [];
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    const risk = (session?.risk ?? []).slice(-10);
    const features = {
      ...sdkFeatures,
      session: {
        session_duration: times.length && session ? (times[times.length - 1] - session.created) / 1000 : 0,
        session_request_count: times.length,
        session_unique_paths: session?.paths.length ?? 0,
        session_avg_time_between_requests: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length / 1000 : 0,
        session_reputation: risk.length ? risk.reduce((a, b) => a + b, 0) / risk.length / 100 : 0,
      },
      network: {
        is_vpn: +intelligence.isVpn,
        is_tor: +intelligence.isTor,
        is_datacenter: +intelligence.isDatacenter,
        is_residential_proxy: +intelligence.isResidentialProxy,
        ip_reputation: 1 - intelligence.reputation / 100,
      },
    };
    try {
      const response = await fetch(`${this.options.mlUrl.replace(/\/$/, '')}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: 'aegis-server-node', behavioral_data: features }),
        signal: AbortSignal.timeout(this.options.mlTimeoutMs),
      });
      if (!response.ok) { this.metrics.mlErrors.inc(); return null; }
      const result = await response.json() as { confidence_score?: number };
      return typeof result.confidence_score === 'number' ? result.confidence_score : null;
    } catch {
      this.metrics.mlErrors.inc();
      return null;
    }
  }

  // --- protected requests --------------------------------------------------

  /** Report the status code sent for an evaluated request (enables the 4xx-probing session check). */
  recordResponse(decision: AegisDecision | undefined, status: number): void {
    if (decision) this.engine.recordResponse(decision.sessionToken, status);
  }

  async evaluate(req: RequestInfo): Promise<{ decision: AegisDecision; headers: Record<string, string> }> {
    await this.ready;
    const stop = this.metrics.duration.startTimer({ kind: 'request' });
    const [engineResult, limited] = await Promise.all([
      this.engine.analyze(this.toEngineRequest(req)),
      this.checkSharedLimits(req),
    ]);
    const { sessionId, cookieHeaders, record } = await this.session(engineResult.sessionToken, req);

    const scores = [engineResult.riskScore.score];
    const reasons = engineResult.signals.filter(s => s.value * s.confidence >= 20).map(s => s.type);
    if (limited) { scores.push(100); reasons.push(limited); }

    let claims: Record<string, unknown> | null = null;
    const token = header(req.headers, TOKEN_HEADER);
    if (token) {
      claims = verifyToken(token, this.options.secretKey, this.options.tokenTtl);
      if (claims && typeof claims.exp === 'number' && Date.now() / 1000 > claims.exp) claims = null;
      if (claims && claims.uah !== userAgentHash(header(req.headers, 'user-agent') ?? '')) {
        claims = null;
        scores.push(60);
        reasons.push('token_user_agent_mismatch');
      } else if (claims && typeof claims.sid === 'string' && claims.sid !== 'anonymous' && claims.sid !== sessionId) {
        // Issued to another session: a token copied out of one browser into another client
        claims = null;
        scores.push(60);
        reasons.push('token_session_mismatch');
      } else if (claims?.pow) {
        scores.push(Number(claims.score) || 0);
        reasons.push('pow_solved');
      } else if (claims) {
        scores.push(Number(claims.score) || 0);
        reasons.push('telemetry_score');
      } else {
        scores.push(40);
        reasons.push('invalid_token');
      }
    }

    const score = Math.round(noisyOr(scores) * 10) / 10;
    let verdict = this.decide(score);
    // A solved challenge answers "challenge"; it never lifts a block
    if (verdict === 'challenge' && claims?.pow) verdict = 'allow';
    // Proof of work alone does not replace the behavioural evidence a token-required path asks for
    const hasTelemetry = !!claims && (!claims.pow || !!claims.tel);
    if (verdict === 'allow' && !hasTelemetry && this.options.requireTokenPaths.some(p => req.path.startsWith(p))) {
      verdict = this.options.mode === 'monitor' ? 'monitor' : 'challenge';
      reasons.push('token_required');
    }
    if (record) {
      record.risk.push(score);
      await this.sessions.save(sessionId, record);
    }
    this.stats.record({ path: req.path, verdict, score, reasons, ip: req.ip, telemetry: false });
    stop();
    this.metrics.decisions.inc({ kind: 'request', verdict });
    for (const signal of reasons) this.metrics.signals.inc({ signal });
    return { decision: { verdict, score, reasons, claims, signals: engineResult.signals, sessionToken: engineResult.sessionToken }, headers: cookieHeaders };
  }

  denial(decision: AegisDecision): HandlerResponse {
    const body: Record<string, unknown> = { aegis: decision.verdict };
    if (decision.verdict === 'challenge') {
      body.telemetry = this.options.telemetryPath;
      body.challenge = this.options.challengePath;
    }
    return { status: 403, body, headers: { 'X-Aegis-Action': decision.verdict, 'Cache-Control': 'no-store' } };
  }

  // --- helpers -------------------------------------------------------------

  private toEngineRequest(req: RequestInfo, behavioralData?: BehavioralPayload): AegisRequest {
    const headers: Record<string, string | string[] | undefined> = { ...req.headers };
    const sessionCookie = (req.cookies ?? parseCookies(header(req.headers, 'cookie')))[SESSION_COOKIE];
    if (sessionCookie) headers[SESSION_HEADER] = sessionCookie;
    return {
      ip: req.ip,
      headers,
      method: req.method,
      path: req.path,
      query: behavioralData ? undefined : req.query as Record<string, string> | undefined,
      body: behavioralData ? undefined : req.body,
      behavioralData,
      timestamp: Date.now(),
      requestId: header(req.headers, 'x-request-id') ?? `aegis_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`,
    };
  }

  /**
   * Track the engine's session and set the cookie when the token changed. The
   * returned record has this request added; the caller saves it once it has
   * added the risk score (one store write per request).
   */
  private async session(sessionToken: string | undefined, req: RequestInfo):
    Promise<{ sessionId: string; cookieHeaders: Record<string, string>; record?: SessionRecord }> {
    if (!sessionToken) return { sessionId: 'anonymous', cookieHeaders: {} };
    const sessionId = sessionToken.split('.')[0];
    const now = Date.now();
    const record = await this.sessions.getOrCreate(sessionId, now);
    record.times.push(now);
    if (record.paths.length < 1000 && !record.paths.includes(req.path)) record.paths.push(req.path);

    const current = (req.cookies ?? parseCookies(header(req.headers, 'cookie')))[SESSION_COOKIE];
    const cookieHeaders: Record<string, string> = current === sessionToken ? {} : {
      'Set-Cookie': `${SESSION_COOKIE}=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; SameSite=Lax${this.options.secureCookies ? '; Secure' : ''}`,
    };
    return { sessionId, cookieHeaders, record };
  }
}

export function header(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

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
  IPAnalyzer, SESSION_HEADER, generateToken, verifyToken, sha256,
} from '@aegis/core';
import { AegisStats } from './stats.js';

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
  /** Token lifetime in seconds */
  tokenTtl?: number;
  /** URL of the ML engine service (POST {mlUrl}/predict) */
  mlUrl?: string;
  mlTimeoutMs?: number;
  maxTelemetryBytes?: number;
  /** Extra DetectionEngine configuration */
  engine?: Partial<AegisConfig>;
}

export interface AegisDecision {
  verdict: Verdict;
  score: number;
  reasons: string[];
  claims: Record<string, unknown> | null;
  signals: DetectionSignal[];
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

interface SessionStats { created: number; times: number[]; paths: Set<string>; risk: number[] }

export class AegisNode {
  readonly options: Required<Omit<AegisNodeOptions, 'mlUrl' | 'engine' | 'protectedPaths'>> &
    Pick<AegisNodeOptions, 'mlUrl' | 'engine' | 'protectedPaths'>;
  readonly engine: DetectionEngine;
  readonly stats = new AegisStats();
  private ipAnalyzer = new IPAnalyzer();
  private sessions = new Map<string, SessionStats>();
  private ready: Promise<void>;

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
      tokenTtl: 300,
      mlTimeoutMs: 500,
      maxTelemetryBytes: 64 * 1024,
      ...options,
    };
    this.engine = new DetectionEngine({
      ...options.engine,
      siteKey: options.siteKey,
      secretKey: options.secretKey,
      // The engine scores; this class decides (it also fuses token and ML scores)
      mode: 'monitor',
    });
    this.ready = this.engine.init();
  }

  async shutdown(): Promise<void> {
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
    try {
      const payload = this.parseTelemetry(req.body);
      const engineResult = await this.engine.analyze(this.toEngineRequest(req, payload.behavioral as BehavioralPayload));
      const { sessionId, cookieHeaders } = this.session(engineResult.sessionToken, req);

      const scores = [engineResult.riskScore.score];
      const reasons = engineResult.signals.filter(s => s.value * s.confidence >= 20).map(s => s.type);
      const mlProbability = await this.mlScore(payload.features, req.ip, sessionId);
      if (mlProbability !== null) {
        scores.push(mlProbability * 100);
        reasons.push('ml_model');
      }
      const score = Math.round(noisyOr(scores) * 10) / 10;
      const verdict = this.decide(score);
      this.sessions.get(sessionId)?.risk.push(score);

      const token = generateToken({
        sid: sessionId,
        score,
        verdict,
        uah: userAgentHash(header(req.headers, 'user-agent') ?? ''),
        exp: Math.floor(Date.now() / 1000) + this.options.tokenTtl,
      }, this.options.secretKey);

      this.stats.record({ path: this.options.telemetryPath, verdict, score, reasons, ip: req.ip, telemetry: true });
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

  private parseTelemetry(body: unknown): { features: Record<string, Record<string, number>>; behavioral: unknown } {
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
    return { features, behavioral: { timestamp: Date.now(), ...(payload.behavioral ?? {}) } };
  }

  private async mlScore(sdkFeatures: Record<string, Record<string, number>>, ip: string, sessionId: string): Promise<number | null> {
    if (!this.options.mlUrl) return null;
    const { intelligence } = await this.ipAnalyzer.analyze(ip);
    const session = this.sessions.get(sessionId);
    const times = session?.times ?? [];
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    const risk = (session?.risk ?? []).slice(-10);
    const features = {
      ...sdkFeatures,
      session: {
        session_duration: times.length && session ? (times[times.length - 1] - session.created) / 1000 : 0,
        session_request_count: times.length,
        session_unique_paths: session?.paths.size ?? 0,
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
      if (!response.ok) return null;
      const result = await response.json() as { confidence_score?: number };
      return typeof result.confidence_score === 'number' ? result.confidence_score : null;
    } catch {
      return null;
    }
  }

  // --- protected requests --------------------------------------------------

  async evaluate(req: RequestInfo): Promise<{ decision: AegisDecision; headers: Record<string, string> }> {
    await this.ready;
    const engineResult = await this.engine.analyze(this.toEngineRequest(req));
    const { sessionId, cookieHeaders } = this.session(engineResult.sessionToken, req);

    const scores = [engineResult.riskScore.score];
    const reasons = engineResult.signals.filter(s => s.value * s.confidence >= 20).map(s => s.type);

    let claims: Record<string, unknown> | null = null;
    const token = header(req.headers, TOKEN_HEADER);
    if (token) {
      claims = verifyToken(token, this.options.secretKey, this.options.tokenTtl);
      if (claims && typeof claims.exp === 'number' && Date.now() / 1000 > claims.exp) claims = null;
      if (claims && claims.uah !== userAgentHash(header(req.headers, 'user-agent') ?? '')) {
        claims = null;
        scores.push(60);
        reasons.push('token_user_agent_mismatch');
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
    if (verdict === 'allow' && !claims && this.options.requireTokenPaths.some(p => req.path.startsWith(p))) {
      verdict = this.options.mode === 'monitor' ? 'monitor' : 'challenge';
      reasons.push('token_required');
    }
    this.sessions.get(sessionId)?.risk.push(score);
    this.stats.record({ path: req.path, verdict, score, reasons, ip: req.ip, telemetry: false });
    return { decision: { verdict, score, reasons, claims, signals: engineResult.signals }, headers: cookieHeaders };
  }

  denial(decision: AegisDecision): HandlerResponse {
    const body: Record<string, unknown> = { aegis: decision.verdict };
    if (decision.verdict === 'challenge') body.telemetry = this.options.telemetryPath;
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

  /** Track the engine's session and set the cookie when the token changed. */
  private session(sessionToken: string | undefined, req: RequestInfo): { sessionId: string; cookieHeaders: Record<string, string> } {
    if (!sessionToken) return { sessionId: 'anonymous', cookieHeaders: {} };
    const sessionId = sessionToken.split('.')[0];
    const now = Date.now();
    let stats = this.sessions.get(sessionId);
    if (!stats) {
      if (this.sessions.size > 100_000) this.sessions.clear();
      stats = { created: now, times: [], paths: new Set(), risk: [] };
      this.sessions.set(sessionId, stats);
    }
    stats.times.push(now);
    if (stats.times.length > 500) stats.times.shift();
    if (stats.paths.size < 1000) stats.paths.add(req.path);
    if (stats.risk.length > 100) stats.risk.shift();

    const current = (req.cookies ?? parseCookies(header(req.headers, 'cookie')))[SESSION_COOKIE];
    const cookieHeaders: Record<string, string> = current === sessionToken ? {} : {
      'Set-Cookie': `${SESSION_COOKIE}=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; SameSite=Lax`,
    };
    return { sessionId, cookieHeaders };
  }
}

export function header(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

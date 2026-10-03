import { SessionInfo, AegisVerdict, DetectionSignal } from '../../types/index.js';
import { Logger } from '../../utils/logger.js';
import { BoundedMap } from '../../utils/bounded.js';
import * as crypto from 'crypto';

/**
 * Secure Session Management for AEGIS BOT SHIELD
 * 
 * Manages client sessions with:
 * - Encrypted session token generation (HMAC-SHA256)
 * - Session behavior profiling and anomaly detection
 * - Session reputation tracking over time
 * - Automatic session expiration and cleanup
 * - Session velocity tracking (requests per time)
 * - Session fingerprint binding (detect session hijacking)
 * 
 * Session lifecycle:
 * 1. New request → create or resume session
 * 2. Track request metadata (path, timing, headers)
 * 3. Build behavioral profile over session lifetime
 * 4. Detect anomalies (sudden behavior change, impossible travel)
 * 5. Score session reputation
 * 6. Expire stale sessions
 */
export class SessionManager {
  private sessions: BoundedMap<string, SessionInfo>;
  /** Recent request timestamps per session (for inter-request statistics) */
  private requestTimes: Map<string, number[]> = new Map();
  private secretKey: string;
  private logger: Logger;
  private maxSessionAge: number;
  private maxSessions: number;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private totalExpired: number = 0;

  constructor(options: {
    secretKey: string;
    maxSessionAgeMs?: number;  // default 30 min
    maxSessions?: number;      // default 100,000
    cleanupIntervalMs?: number;
  }) {
    if (!options.secretKey) {
      throw new Error('SessionManager requires a secretKey');
    }
    this.secretKey = options.secretKey;
    this.maxSessionAge = options.maxSessionAgeMs || 30 * 60_000;
    this.maxSessions = options.maxSessions || 100_000;
    // Least recently used sessions are dropped at the bound (O(1)); the periodic cleanup removes expired ones.
    this.sessions = new BoundedMap(this.maxSessions, (id) => {
      this.requestTimes.delete(id);
      this.totalExpired++;
    });
    this.logger = new Logger('SessionManager');
    this.startCleanup(options.cleanupIntervalMs || 60_000);
  }

  /**
   * Resume the session named by a signed token (or create a new one),
   * record the current request and return any anomaly signals.
   */
  public processRequest(params: {
    sessionToken?: string;
    ip: string;
    path: string;
    deviceFingerprint?: string;
  }): { session: SessionInfo; signals: DetectionSignal[]; token: string } {
    const sessionId = params.sessionToken ? this.validateToken(params.sessionToken) : null;
    let session = sessionId ? this.getSession(sessionId) : null;
    if (!session) {
      session = this.createSession(params.ip, params.deviceFingerprint);
    }

    // Compare against the previous request before recording this one
    const signals = this.detectSessionAnomalies(session, params.ip, params.deviceFingerprint);

    session.lastActivity = Date.now();
    session.requestCount += 1;
    this.updateBehavioralProfile(session, params.path);
    session.reputation = this.calculateSessionReputation(session, signals);

    return { session, signals, token: this.generateToken(session.id) };
  }

  public createSession(ip: string, deviceFingerprint?: string): SessionInfo {
    const now = Date.now();
    const session: SessionInfo = {
      id: crypto.randomUUID(),
      createdAt: now,
      lastActivity: now,
      requestCount: 0,
      uniquePaths: new Set(),
      riskHistory: [],
      verdictHistory: [],
      behavioralProfile: {
        requestRate: 0,
        pathVariability: 0,
        avgInterRequestTime: 0,
        interRequestTimeStd: 0,
        resourceLoadRatio: 0,
        sessionDuration: 0,
        hasJsExecution: false,
        acceptsCookies: false,
      },
      ipAddress: ip,
      deviceFingerprint,
      reputation: 100,
    };


    this.sessions.set(session.id, session);
    this.requestTimes.set(session.id, []);
    return session;
  }

  public getSession(sessionId: string): SessionInfo | null {
    return this.sessions.get(sessionId) || null;
  }

  /** Returns the session id if the token's HMAC is valid, else null. */
  public validateToken(token: string): string | null {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [sessionId, signature] = parts;
    const expected = this.sign(sessionId);
    const a = Buffer.from(signature, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return null;
    }
    return sessionId;
  }

  public generateToken(sessionId: string): string {
    return `${sessionId}.${this.sign(sessionId)}`;
  }

  public updateBehavioralProfile(session: SessionInfo, path: string): void {
    const now = Date.now();
    session.uniquePaths.add(path);

    const times = this.requestTimes.get(session.id) ?? [];
    times.push(now);
    if (times.length > 100) times.shift();
    this.requestTimes.set(session.id, times);

    const gaps = times.slice(1).map((t, i) => t - times[i]);
    const mean = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
    const variance = gaps.length ? gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length : 0;

    const profile = session.behavioralProfile;
    profile.sessionDuration = now - session.createdAt;
    profile.requestRate = profile.sessionDuration > 0
      ? session.requestCount / (profile.sessionDuration / 60_000)
      : 0;
    profile.pathVariability = session.uniquePaths.size / Math.max(session.requestCount, 1);
    profile.avgInterRequestTime = mean;
    profile.interRequestTimeStd = Math.sqrt(variance);
  }

  public detectSessionAnomalies(session: SessionInfo, ip: string, fingerprint?: string): DetectionSignal[] {
    const signals: DetectionSignal[] = [];

    if (session.ipAddress !== ip) {
      signals.push({
        category: 'reputation',
        type: 'session.ip_changed',
        value: 70,
        confidence: 0.7,
        description: `IP address changed mid-session (${session.ipAddress} -> ${ip})`,
        weight: 1.2,
      });
    }

    if (session.deviceFingerprint && fingerprint && session.deviceFingerprint !== fingerprint) {
      signals.push({
        category: 'device',
        type: 'session.fingerprint_changed',
        value: 85,
        confidence: 0.85,
        description: 'Device fingerprint changed mid-session',
        weight: 1.4,
      });
    }

    const times = this.requestTimes.get(session.id) ?? [];
    if (times.length >= 10 && Date.now() - times[times.length - 10] < 1000) {
      signals.push({
        category: 'behavioral',
        type: 'session.velocity_spike',
        value: 75,
        confidence: 0.8,
        description: '10 requests within one second in this session',
        weight: 1.2,
      });
    }

    return signals;
  }

  public calculateSessionReputation(session: SessionInfo, signals: DetectionSignal[] = []): number {
    let rep = session.reputation;
    for (const signal of signals) {
      rep -= signal.value * signal.confidence * 0.2;
    }
    if (session.requestCount > 500) {
      rep -= Math.floor(session.requestCount / 100);
    }
    return Math.max(0, Math.min(100, Math.round(rep)));
  }

  public addVerdict(sessionId: string, verdict: AegisVerdict, riskScore?: number): void {
    const session = this.getSession(sessionId);
    if (!session) return;
    session.verdictHistory.push(verdict);
    if (session.verdictHistory.length > 100) session.verdictHistory.shift();
    if (riskScore !== undefined) {
      session.riskHistory.push(riskScore);
      if (session.riskHistory.length > 100) session.riskHistory.shift();
    }
  }

  public getSessionMetrics(): { totalActive: number; avgAge: number; totalExpired: number } {
    const now = Date.now();
    let totalAge = 0;
    this.sessions.forEach(s => totalAge += (now - s.createdAt));

    return {
      totalActive: this.sessions.size,
      avgAge: this.sessions.size ? totalAge / this.sessions.size : 0,
      totalExpired: this.totalExpired
    };
  }

  public startCleanup(intervalMs: number): void {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    this.cleanupInterval = setInterval(() => this.cleanup(), intervalMs);
    this.cleanupInterval.unref?.();
  }

  public cleanup(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.lastActivity > this.maxSessionAge) {
        this.sessions.delete(id);
        this.requestTimes.delete(id);
        cleaned++;
        this.totalExpired++;
      }
    }
    return cleaned;
  }

  public destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.sessions.clear();
    this.requestTimes.clear();
  }

  private sign(sessionId: string): string {
    return crypto.createHmac('sha256', this.secretKey).update(sessionId).digest('hex');
  }
}

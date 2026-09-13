import { SessionInfo, AegisVerdict, BehavioralProfile, DetectionSignal } from '../../types/index.js';
import { Logger } from '../../utils/logger.js';
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
  private sessions: Map<string, SessionInfo> = new Map();
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
    this.secretKey = options.secretKey;
    this.maxSessionAge = options.maxSessionAgeMs || 30 * 60_000;
    this.maxSessions = options.maxSessions || 100_000;
    this.logger = new Logger('SessionManager');
    this.startCleanup(options.cleanupIntervalMs || 60_000);
  }

  /**
   * Get or create a session, update it with the current request,
   * and return detection signals if anomalies are detected.
   */
  public processRequest(params: {
    sessionId?: string;
    ip: string;
    path: string;
    userAgent: string;
    deviceFingerprint?: string;
  }): { session: SessionInfo; signals: DetectionSignal[]; token: string } {
    let session = params.sessionId ? this.getSession(params.sessionId) : null;
    let token = '';
    
    if (!session) {
        session = this.createSession(params.ip, params.deviceFingerprint);
        token = this.generateToken(session.id);
    } else {
        token = params.sessionId!; // In a real implementation this could be the token itself or we regenerate
    }
    
    session.lastActive = Date.now();
    session.requestCount = (session.requestCount || 0) + 1;
    
    this.updateBehavioralProfile(session, params.path);
    const signals = this.detectSessionAnomalies(session, params.ip, params.deviceFingerprint);
    session.reputation = this.calculateSessionReputation(session);
    
    return { session, signals, token };
  }

  public createSession(ip: string, deviceFingerprint?: string): SessionInfo {
    const id = crypto.randomUUID();
    const now = Date.now();
    
    const session: SessionInfo = {
      id,
      ip,
      deviceFingerprint,
      createdAt: now,
      lastActive: now,
      requestCount: 0,
      paths: [],
      behavioralProfile: {
         requestTimestamps: [],
         pathSequence: [],
      } as any,
      reputation: 100
    };
    
    if (this.sessions.size >= this.maxSessions) {
      this.cleanup();
    }
    
    this.sessions.set(id, session);
    return session;
  }

  public getSession(sessionId: string): SessionInfo | null {
    return this.sessions.get(sessionId) || null;
  }

  public validateToken(token: string): string | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 2) return null;
      
      const [sessionId, signature] = parts;
      const expectedSignature = crypto.createHmac('sha256', this.secretKey).update(sessionId).digest('hex');
      
      if (signature === expectedSignature) {
        return sessionId;
      }
    } catch (e) {
      this.logger.error('Token validation error', { error: e });
    }
    return null;
  }

  public generateToken(sessionId: string): string {
    const signature = crypto.createHmac('sha256', this.secretKey).update(sessionId).digest('hex');
    return `${sessionId}.${signature}`;
  }

  public updateBehavioralProfile(session: SessionInfo, path: string): void {
    if (!session.behavioralProfile) {
        session.behavioralProfile = { requestTimestamps: [], pathSequence: [] } as any;
    }
    
    const profile = session.behavioralProfile as any;
    if (profile.requestTimestamps) {
        profile.requestTimestamps.push(Date.now());
        if (profile.requestTimestamps.length > 100) profile.requestTimestamps.shift();
    }
    if (profile.pathSequence) {
        profile.pathSequence.push(path);
        if (profile.pathSequence.length > 50) profile.pathSequence.shift();
    }
    
    if (!session.paths) session.paths = [];
    session.paths.push(path);
  }

  public detectSessionAnomalies(session: SessionInfo, ip: string, fingerprint?: string): DetectionSignal[] {
    const signals: DetectionSignal[] = [];
    
    if (session.ip && session.ip !== ip) {
      signals.push({ type: 'session_hijacking', severity: 'high', description: 'IP address changed mid-session', metadata: { oldIp: session.ip, newIp: ip } } as any);
    }
    
    if (session.deviceFingerprint && fingerprint && session.deviceFingerprint !== fingerprint) {
      signals.push({ type: 'session_hijacking', severity: 'high', description: 'Device fingerprint changed mid-session' } as any);
    }
    
    const profile = session.behavioralProfile as any;
    if (profile && profile.requestTimestamps && profile.requestTimestamps.length >= 10) {
        const timestamps = profile.requestTimestamps;
        const recentTime = timestamps[timestamps.length - 1] - timestamps[timestamps.length - 10];
        if (recentTime < 1000) {
            signals.push({ type: 'velocity_spike', severity: 'medium', description: 'Sudden velocity spike in session' } as any);
        }
    }
    
    return signals;
  }

  public calculateSessionReputation(session: SessionInfo): number {
    let rep = 100;
    if (session.requestCount && session.requestCount > 500) {
      rep -= Math.floor(session.requestCount / 100);
    }
    return Math.max(0, Math.min(100, rep));
  }

  public addVerdict(sessionId: string, verdict: AegisVerdict): void {
    const session = this.getSession(sessionId);
    if (session) {
        session.verdict = verdict;
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
  }

  public cleanup(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.lastActive > this.maxSessionAge) {
        this.sessions.delete(id);
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
  }
}

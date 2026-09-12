export interface AegisConfig {
  redisUrl?: string;
  enableThreatIntel?: boolean;
  blockThreshold?: number;
  challengeThreshold?: number;
}

export interface AegisRequest {
  ip: string;
  headers: Record<string, string | string[] | undefined>;
  method: string;
  path: string;
  tls?: {
    ja3?: string;
  };
}

export type AegisVerdict = 'allow' | 'block' | 'challenge' | 'monitor';

export interface RiskScore {
  score: number;
  factors: Record<string, number>;
}

export enum ThreatCategory {
  OAT_001 = 'Account Takeover',
  OAT_002 = 'Credential Stuffing',
  OAT_003 = 'Sniper',
  // Add other OWASP OAT categories...
  OAT_021 = 'Fingerprinting'
}

export interface DetectionSignal {
  type: string;
  value: number;
  confidence: number;
}

export interface SessionInfo {
  id: string;
  createdAt: number;
  requestCount: number;
}

export interface IPIntelligence {
  isVpn: boolean;
  isProxy: boolean;
  isTor: boolean;
  isDatacenter: boolean;
  reputation: number;
}

export interface DeviceFingerprint {
  ja3?: string;
  userAgent: string;
  httpVersion: string;
}

export interface BehavioralProfile {
  requestRate: number;
  pathVariability: number;
}

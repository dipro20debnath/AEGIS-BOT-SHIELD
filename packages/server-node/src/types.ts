export interface AegisRequest {
  ip: string;
  headers: Record<string, string>;
  method: string;
  path: string;
  query: Record<string, string>;
  body: any;
  aegisToken?: string;
  timestamp: number;
  requestId: string;
}

export interface VerificationResult {
  riskScore: number;
  verdict: 'allow' | 'challenge' | 'block';
  requestId: string;
  reason?: string;
  timestamp: number;
  data?: any;
}

export interface AegisServerOptions {
  siteKey: string;
  secretKey: string;
  port?: number;
  logging?: boolean;
}

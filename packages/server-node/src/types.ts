export interface VerificationResult {
  valid: boolean;
  verdict: 'allow' | 'monitor' | 'challenge' | 'block';
  riskScore?: number;
  reason?: string;
  claims?: Record<string, unknown>;
}

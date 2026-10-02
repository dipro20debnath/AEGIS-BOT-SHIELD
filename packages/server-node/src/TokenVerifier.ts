import { verifyToken } from '@aegis/core';
import { VerificationResult } from './types.js';

/** Verifies AEGIS.v1 tokens issued by an AEGIS server (Node or Python). */
export class TokenVerifier {
  constructor(private secretKey: string, private maxAgeSeconds = 300) {
    if (!secretKey) throw new Error('Aegis Bot Shield requires a valid secret key');
  }

  public verify(token: string): VerificationResult {
    const claims = verifyToken(token, this.secretKey, this.maxAgeSeconds);
    if (!claims || (typeof claims.exp === 'number' && Date.now() / 1000 > claims.exp)) {
      return { valid: false, verdict: 'block', reason: 'Invalid or expired token' };
    }
    const verdict = (claims.verdict as VerificationResult['verdict']) ?? 'allow';
    return { valid: true, verdict, riskScore: Number(claims.score) || 0, claims };
  }
}

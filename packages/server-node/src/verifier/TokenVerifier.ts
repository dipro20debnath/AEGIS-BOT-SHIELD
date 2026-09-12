import * as crypto from 'crypto';
import { VerificationResult } from '../types';

export class TokenVerifier {
    private secretKey: string;

    constructor(secretKey: string) {
        if (!secretKey) {
            throw new Error("Aegis Bot Shield requires a valid secret key");
        }
        this.secretKey = secretKey;
    }

    public verify(token: string, clientIp: string): VerificationResult {
        try {
            const parts = token.split('.');
            if (parts.length !== 3) {
                return { valid: false, verdict: 'block', reason: 'Invalid token format' };
            }

            const [headerB64, payloadB64, signatureB64] = parts;
            
            // Reconstruct and verify HMAC-SHA256 signature
            const hmac = crypto.createHmac('sha256', this.secretKey);
            hmac.update(`${headerB64}.${payloadB64}`);
            const expectedSignature = hmac.digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
            
            if (signatureB64 !== expectedSignature) {
                return { valid: false, verdict: 'block', reason: 'Invalid signature' };
            }

            const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
            
            // Check expiry
            const now = Math.floor(Date.now() / 1000);
            if (payload.exp && payload.exp < now) {
                return { valid: false, verdict: 'block', reason: 'Token expired' };
            }

            // IP binding check
            if (payload.ip && payload.ip !== clientIp) {
                // Return challenge if IP mismatches (could be legit proxy/NAT change)
                return { valid: true, verdict: 'challenge', reason: 'IP mismatch' };
            }

            // Check if ML Engine specified a block
            if (payload.verdict === 'block') {
                return { valid: true, verdict: 'block', riskScore: payload.risk, reason: 'High risk score' };
            }

            if (payload.verdict === 'challenge') {
                return { valid: true, verdict: 'challenge', riskScore: payload.risk, reason: 'Suspicious activity' };
            }

            return { valid: true, verdict: 'allow', riskScore: payload.risk || 0 };
        } catch (error) {
            return { valid: false, verdict: 'block', reason: 'Token parsing error' };
        }
    }
}

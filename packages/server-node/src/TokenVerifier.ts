import crypto from 'crypto';
import { Logger } from '@aegis/core';

export class TokenVerifier {
  private secretKey: Buffer;
  private logger: Logger;
  private seenNonces = new Set<string>();

  constructor(secretKeyBase64: string) {
    this.secretKey = Buffer.from(secretKeyBase64, 'base64');
    this.logger = new Logger('TokenVerifier');
    
    // Periodically clean nonces
    setInterval(() => {
      this.seenNonces.clear();
    }, 5 * 60 * 1000).unref();
  }

  public async verify(req: any): Promise<any> {
    const defaultResult = {
      riskScore: 100,
      verdict: 'block',
      requestId: req.requestId,
      reason: 'No token provided',
      timestamp: Date.now()
    };

    if (!req.aegisToken) {
      return defaultResult;
    }

    try {
      // Extract parts
      const parts = req.aegisToken.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid token format');
      }

      const [ivB64, payloadB64, authTagB64] = parts;
      const iv = Buffer.from(ivB64, 'base64url');
      const payload = Buffer.from(payloadB64, 'base64url');
      const authTag = Buffer.from(authTagB64, 'base64url');

      // Decrypt
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.secretKey, iv);
      decipher.setAuthTag(authTag);
      
      let decrypted = decipher.update(payload, undefined, 'utf8');
      decrypted += decipher.final('utf8');

      const data = JSON.parse(decrypted);

      // Validate age
      const age = Date.now() - data.timestamp;
      if (age > 120000 || age < -5000) {
        return { ...defaultResult, reason: 'Token expired', riskScore: 90 };
      }

      // Check replay
      if (this.seenNonces.has(data.nonce)) {
        return { ...defaultResult, reason: 'Replay attack detected', riskScore: 100 };
      }
      this.seenNonces.add(data.nonce);

      // Validate behavioral data & Calculate score
      let score = 0;
      
      // Simple risk checks
      if (!data.behavioral || !data.behavioral.botDetected) {
        score += 10;
      }
      if (data.behavioral && data.behavioral.automationTool) {
        score += 50;
      }
      if (req.ip !== data.ip) {
        score += 40; // IP mismatch
      }
      if (data.env && data.env.webdriver) {
        score += 80;
      }
      
      let verdict = 'allow';
      if (score >= 80) verdict = 'block';
      else if (score >= 50) verdict = 'challenge';

      return {
        riskScore: Math.min(score, 100),
        verdict,
        requestId: req.requestId,
        reason: verdict === 'allow' ? 'Clean' : 'Suspicious activity',
        timestamp: Date.now(),
        data
      };

    } catch (err: any) {
      this.logger.error('Token verification failed', err);
      return { ...defaultResult, reason: 'Invalid token signature or malformed data', riskScore: 95 };
    }
  }
}

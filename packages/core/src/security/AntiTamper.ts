/**
 * Request signing and replay protection for calls between trusted parties
 * (backend to backend, webhooks, or challenge solutions).
 *
 * Header: X-Aegis-Signature: t=<unix seconds>,n=<nonce>,s=<base64url HMAC-SHA256>
 * Signed string (identical in the Python SDK, aegis_shield/antitamper.py):
 *   METHOD \n path-with-query \n t \n n \n hex(SHA-256(body))
 *
 * A request is rejected when the signature does not match, the timestamp is
 * outside the allowed skew, or the nonce was already used within that window.
 */
import { createHash, randomBytes } from 'crypto';
import { hmacSign, hmacVerify, NonceCache } from '../utils/crypto.js';

export const SIGNATURE_HEADER = 'x-aegis-signature';

export interface SignableRequest {
  method: string;
  /** Path including the query string, e.g. /api/orders?id=7 */
  path: string;
  body?: string | Buffer;
}

export type VerifyResult = { valid: true } | { valid: false; reason: 'missing' | 'malformed' | 'expired' | 'bad_signature' | 'replay' };

export function canonicalString(req: SignableRequest, timestamp: number, nonce: string): string {
  const bodyHash = createHash('sha256').update(req.body ?? '').digest('hex');
  return [req.method.toUpperCase(), req.path, String(timestamp), nonce, bodyHash].join('\n');
}

export function signRequest(req: SignableRequest, secret: string, now = Date.now()): string {
  const t = Math.floor(now / 1000);
  const n = randomBytes(12).toString('hex');
  return `t=${t},n=${n},s=${hmacSign(canonicalString(req, t, n), secret)}`;
}

export function parseSignatureHeader(header: string): { t: number; n: string; s: string } | null {
  const parts = Object.fromEntries(header.split(',').map(p => {
    const i = p.indexOf('=');
    return i > 0 ? [p.slice(0, i).trim(), p.slice(i + 1).trim()] : ['', ''];
  }));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !/^[0-9a-f]{8,64}$/i.test(parts.n ?? '') || !parts.s) return null;
  return { t, n: parts.n, s: parts.s };
}

export class AntiTamper {
  private nonces: NonceCache;

  constructor(private secret: string, private maxSkewSeconds = 300) {
    if (!secret) throw new Error('AntiTamper requires a secret');
    this.nonces = new NonceCache(maxSkewSeconds * 2 * 1000);
  }

  public sign(req: SignableRequest, now = Date.now()): string {
    return signRequest(req, this.secret, now);
  }

  public verify(req: SignableRequest, header: string | undefined, now = Date.now()): VerifyResult {
    if (!header) return { valid: false, reason: 'missing' };
    const parsed = parseSignatureHeader(header);
    if (!parsed) return { valid: false, reason: 'malformed' };
    if (Math.abs(Math.floor(now / 1000) - parsed.t) > this.maxSkewSeconds) return { valid: false, reason: 'expired' };
    if (!hmacVerify(canonicalString(req, parsed.t, parsed.n), parsed.s, this.secret)) {
      return { valid: false, reason: 'bad_signature' };
    }
    // Checked last so an attacker cannot burn nonces with unsigned requests
    if (this.nonces.hasBeenUsed(parsed.n)) return { valid: false, reason: 'replay' };
    return { valid: true };
  }

  public destroy(): void {
    this.nonces.destroy();
  }
}

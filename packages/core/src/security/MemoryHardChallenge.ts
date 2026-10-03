/**
 * Server side of the memory-hard proof-of-work challenge (client:
 * packages/js-sdk/src/challenges/MemoryHardChallenge.ts; Python:
 * aegis_shield/challenge.py, same format).
 *
 * challenge = "AEGIS.pow1." + base64url(JSON {id, seed, n, r, bits, exp}) + "." + base64url(HMAC-SHA256)
 * solution  = nonce such that scrypt(challenge + ":" + nonce, seed, n, r, p=1, 32 bytes) has >= bits leading zero bits
 *
 * Each challenge can be verified once: the id is burnt before the scrypt
 * check, so replaying a solution or flooding one challenge with guesses costs
 * the server at most one scrypt (~10 ms at n=4096, r=8). Issuing is a single
 * HMAC. Rate-limit both endpoints anyway.
 */
import { randomBytes, scrypt as scryptCb } from 'crypto';
import { hmacSign, hmacVerify, NonceCache } from '../utils/crypto.js';

export const POW_PREFIX = 'AEGIS.pow1.';

export interface PowChallenge {
  challenge: string;
  seed: string;
  n: number;
  r: number;
  bits: number;
  /** Unix seconds */
  expiresAt: number;
}

export interface MemoryHardOptions {
  /** scrypt cost (power of two); memory per attempt = 128 * r * n bytes. Default 4096 (4 MiB) */
  n?: number;
  r?: number;
  /** Required leading zero bits; expected attempts = 2^bits. Default 4 */
  bits?: number;
  ttlSeconds?: number;
}

export type PowVerifyResult =
  | { valid: true; id: string }
  | { valid: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'replay' | 'insufficient_work' };

export function leadingZeroBits(bytes: Uint8Array): number {
  let bits = 0;
  for (const byte of bytes) {
    if (byte === 0) { bits += 8; continue; }
    return bits + Math.clz32(byte) - 24;
  }
  return bits;
}

function scryptAsync(password: string, salt: string, n: number, r: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, 32, { N: n, r, p: 1, maxmem: 256 * n * r + 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))));
}

export class MemoryHardChallenger {
  private readonly n: number;
  private readonly r: number;
  private readonly bits: number;
  private readonly ttl: number;
  private used: NonceCache;

  constructor(private secret: string, options: MemoryHardOptions = {}) {
    if (!secret) throw new Error('MemoryHardChallenger requires a secret');
    this.n = options.n ?? 4096;
    this.r = options.r ?? 8;
    this.bits = options.bits ?? 4;
    this.ttl = options.ttlSeconds ?? 120;
    if (this.n < 2 || (this.n & (this.n - 1)) !== 0 || this.n > 1 << 16) throw new Error('n must be a power of two <= 65536');
    if (this.r < 1 || this.r > 32 || this.bits < 0 || this.bits > 20) throw new Error('r or bits out of range');
    this.used = new NonceCache(this.ttl * 1000 + 60_000);
  }

  public issue(now = Date.now()): PowChallenge {
    const claims = {
      id: randomBytes(12).toString('hex'),
      seed: randomBytes(16).toString('hex'),
      n: this.n, r: this.r, bits: this.bits,
      exp: Math.floor(now / 1000) + this.ttl,
    };
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const challenge = `${POW_PREFIX}${body}.${hmacSign(POW_PREFIX + body, this.secret)}`;
    return { challenge, seed: claims.seed, n: claims.n, r: claims.r, bits: claims.bits, expiresAt: claims.exp };
  }

  public async verify(challenge: string, nonce: unknown, now = Date.now()): Promise<PowVerifyResult> {
    if (typeof challenge !== 'string' || !challenge.startsWith(POW_PREFIX)) return { valid: false, reason: 'malformed' };
    if (typeof nonce !== 'number' || !Number.isInteger(nonce) || nonce < 0 || nonce > 2 ** 31) return { valid: false, reason: 'malformed' };
    const [body, sig] = challenge.slice(POW_PREFIX.length).split('.');
    if (!body || !sig) return { valid: false, reason: 'malformed' };
    if (!hmacVerify(POW_PREFIX + body, sig, this.secret)) return { valid: false, reason: 'bad_signature' };
    let claims: { id: string; seed: string; n: number; r: number; bits: number; exp: number };
    try {
      claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      return { valid: false, reason: 'malformed' };
    }
    if (Math.floor(now / 1000) > claims.exp) return { valid: false, reason: 'expired' };
    // Burn the id before the expensive check: one scrypt per issued challenge, at most
    if (this.used.hasBeenUsed(claims.id)) return { valid: false, reason: 'replay' };
    const digest = await scryptAsync(`${challenge}:${nonce}`, claims.seed, claims.n, claims.r);
    if (leadingZeroBits(digest) < claims.bits) return { valid: false, reason: 'insufficient_work' };
    return { valid: true, id: claims.id };
  }

  public destroy(): void {
    this.used.destroy();
  }
}

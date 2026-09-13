import * as crypto from 'crypto';

/**
 * Cryptographic Utilities for AEGIS BOT SHIELD
 * 
 * Provides all cryptographic operations for token signing,
 * payload encryption, and hash generation.
 * 
 * Algorithms:
 * - HMAC-SHA256 for token signing/verification
 * - AES-256-GCM for payload encryption/decryption
 * - SHA-256 for hashing
 * - Ed25519 for asymmetric operations (future)
 * - CSPRNG for nonce/key generation
 */

// === HMAC Operations ===

/**
 * Generate HMAC-SHA256 signature for data.
 * @param data - Data to sign
 * @param secretKey - Secret key for HMAC
 * @returns Base64url-encoded HMAC signature
 */
export function hmacSign(data: string, secretKey: string): string {
  return crypto.createHmac('sha256', secretKey).update(data).digest('base64url');
}

/**
 * Verify HMAC-SHA256 signature.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function hmacVerify(data: string, signature: string, secretKey: string): boolean {
  const expected = hmacSign(data, secretKey);
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// === AES-256-GCM Encryption ===

export interface EncryptedPayload {
  /** Base64url-encoded ciphertext */
  ciphertext: string;
  /** Base64url-encoded 12-byte IV */
  iv: string;
  /** Base64url-encoded 16-byte auth tag */
  tag: string;
}

/**
 * Encrypt data using AES-256-GCM.
 * @param plaintext - Data to encrypt
 * @param key - 32-byte encryption key (or string to derive key from)
 * @returns EncryptedPayload with ciphertext, IV, and auth tag
 */
export function aesEncrypt(plaintext: string, key: string): EncryptedPayload {
  const derivedKey = deriveKey(key);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString('base64url'),
    iv: iv.toString('base64url'),
    tag: tag.toString('base64url'),
  };
}

/**
 * Decrypt AES-256-GCM encrypted data.
 */
export function aesDecrypt(payload: EncryptedPayload, key: string): string {
  const derivedKey = deriveKey(key);
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    derivedKey,
    Buffer.from(payload.iv, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64url'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64url')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

// === Hashing ===

export function sha256(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function sha256Base64(data: string): string {
  return crypto.createHash('sha256').update(data).digest('base64url');
}

// === Token Operations ===

/**
 * Generate a signed AEGIS token.
 * Format: AEGIS.v1.{base64url(encrypted_payload)}.{hmac_signature}
 */
export function generateToken(payload: Record<string, unknown>, secretKey: string): string {
  const jsonPayload = JSON.stringify({
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    nonce: generateNonce(),
  });
  
  const encrypted = aesEncrypt(jsonPayload, secretKey);
  const encodedPayload = Buffer.from(JSON.stringify(encrypted)).toString('base64url');
  const signature = hmacSign(encodedPayload, secretKey);
  
  return `AEGIS.v1.${encodedPayload}.${signature}`;
}

/**
 * Verify and decode an AEGIS token.
 * @returns Decoded payload or null if invalid
 */
export function verifyToken(token: string, secretKey: string, maxAgeSeconds: number = 120): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 4 || parts[0] !== 'AEGIS' || parts[1] !== 'v1') return null;
    
    const encodedPayload = parts[2];
    const signature = parts[3];
    
    // Verify HMAC signature (timing-safe)
    if (!hmacVerify(encodedPayload, signature, secretKey)) return null;
    
    // Decrypt payload
    const encryptedPayload: EncryptedPayload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8')
    );
    const jsonPayload = aesDecrypt(encryptedPayload, secretKey);
    const payload = JSON.parse(jsonPayload);
    
    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.iat && (now - payload.iat) > maxAgeSeconds) return null;
    
    return payload;
  } catch {
    return null;
  }
}

// === Nonce & Key Generation ===

export function generateNonce(length: number = 16): string {
  return crypto.randomBytes(length).toString('hex');
}

export function generateSecretKey(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Derive a 32-byte key from a string using PBKDF2.
 */
function deriveKey(keyString: string): Buffer {
  if (Buffer.byteLength(keyString, 'utf8') === 32) {
    return Buffer.from(keyString, 'utf8');
  }
  // Use SHA-256 as simple key derivation for strings of other lengths
  return crypto.createHash('sha256').update(keyString).digest();
}

// === Nonce Cache for Replay Protection ===

export class NonceCache {
  private nonces: Map<string, number> = new Map();
  private maxAge: number;
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(maxAgeMs: number = 120_000) {
    this.maxAge = maxAgeMs;
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
  }

  /** Check if nonce has been seen (returns true if replay detected) */
  public hasBeenUsed(nonce: string): boolean {
    if (this.nonces.has(nonce)) return true;
    this.nonces.set(nonce, Date.now());
    return false;
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.maxAge;
    for (const [nonce, timestamp] of this.nonces) {
      if (timestamp < cutoff) this.nonces.delete(nonce);
    }
  }

  public destroy(): void {
    clearInterval(this.cleanupInterval);
  }
}

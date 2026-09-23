import { CryptoUtils } from '../src/utils/crypto';

describe('CryptoUtils', () => {
  const secret = 'super-secret-key-32-chars-long!!';
  
  it('should generate and verify HMAC-SHA256', () => {
    const data = 'test-data';
    const hmac = CryptoUtils.generateHmac(data, secret);
    expect(hmac).toBeDefined();
    
    const isValid = CryptoUtils.verifyHmac(data, hmac, secret);
    expect(isValid).toBe(true);
    
    const isInvalid = CryptoUtils.verifyHmac('tampered-data', hmac, secret);
    expect(isInvalid).toBe(false);
  });

  it('should encrypt and decrypt using AES-256-GCM roundtrip', () => {
    const plaintext = 'sensitive-bot-data';
    const encrypted = CryptoUtils.encrypt(plaintext, secret);
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted.iv).toBeDefined();
    expect(encrypted.authTag).toBeDefined();

    const decrypted = CryptoUtils.decrypt(encrypted, secret);
    expect(decrypted).toBe(plaintext);
  });

  it('should generate and validate tokens', () => {
    const payload = { userId: '123' };
    const token = CryptoUtils.generateToken(payload, secret);
    expect(typeof token).toBe('string');
    
    const decoded = CryptoUtils.validateToken(token, secret);
    expect(decoded.userId).toBe('123');
  });

  it('should ensure nonce uniqueness', () => {
    const nonce1 = CryptoUtils.generateNonce();
    const nonce2 = CryptoUtils.generateNonce();
    expect(nonce1).not.toBe(nonce2);
  });

  it('should reject invalid tokens', () => {
    const isValid = CryptoUtils.validateToken('invalid.token.here', secret);
    expect(isValid).toBeNull(); // or throw error depending on impl
  });
});

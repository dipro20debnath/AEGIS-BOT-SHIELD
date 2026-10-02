import {
  hmacSign, hmacVerify, aesEncrypt, aesDecrypt, generateToken, verifyToken,
  generateNonce, NonceCache,
} from '../src/utils/crypto';

const KEY = 'test-secret-key-0123456789';

describe('crypto utils', () => {
  afterEach(() => jest.restoreAllMocks());

  it('signs and verifies HMAC-SHA256, rejecting tampered data', () => {
    const sig = hmacSign('payload', KEY);
    expect(hmacVerify('payload', sig, KEY)).toBe(true);
    expect(hmacVerify('payload!', sig, KEY)).toBe(false);
    expect(hmacVerify('payload', sig, 'other-key')).toBe(false);
  });

  it('round-trips AES-256-GCM and fails with the wrong key', () => {
    const encrypted = aesEncrypt('hello aegis', KEY);
    expect(aesDecrypt(encrypted, KEY)).toBe('hello aegis');
    expect(() => aesDecrypt(encrypted, 'wrong-key')).toThrow();
  });

  it('generates tokens in AEGIS.v1 format that verify back to the payload', () => {
    const token = generateToken({ sid: 'abc', score: 12 }, KEY);
    expect(token.split('.')).toHaveLength(4);
    expect(token.startsWith('AEGIS.v1.')).toBe(true);
    const payload = verifyToken(token, KEY);
    expect(payload).toMatchObject({ sid: 'abc', score: 12 });
    expect(typeof payload!.nonce).toBe('string');
  });

  it('rejects tokens with a modified signature or wrong key', () => {
    const token = generateToken({ sid: 'abc' }, KEY);
    const parts = token.split('.');
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('A') ? 'BB' : 'AA');
    expect(verifyToken(parts.join('.'), KEY)).toBeNull();
    expect(verifyToken(token, 'other-key')).toBeNull();
    expect(verifyToken('not-a-token', KEY)).toBeNull();
  });

  it('rejects expired tokens', () => {
    const token = generateToken({ sid: 'abc' }, KEY);
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 121_000);
    expect(verifyToken(token, KEY, 120)).toBeNull();
  });

  it('generates unique nonces and detects replays', () => {
    const nonces = new Set(Array.from({ length: 1000 }, () => generateNonce()));
    expect(nonces.size).toBe(1000);

    const cache = new NonceCache();
    expect(cache.hasBeenUsed('n1')).toBe(false);
    expect(cache.hasBeenUsed('n1')).toBe(true);
    cache.destroy();
  });
});

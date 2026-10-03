import { describe, expect, it } from 'vitest';
import { scryptSync } from 'crypto';
import { leadingZeroBits, loadWasmRomix, pbkdf2Js, romixJs, scrypt, sha256Js } from '../src/challenges/scrypt';
import { createHash, pbkdf2Sync } from 'crypto';
import { challengeInput, solveMemoryHard } from '../src/challenges/MemoryHardChallenge';

const enc = (s: string) => new TextEncoder().encode(s);
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

describe('scrypt', () => {
  it('WASM and JS engines equal Node crypto.scrypt for several (N, r)', async () => {
    const wasm = await loadWasmRomix();
    expect(wasm).not.toBeNull();
    for (const [n, r] of [[16, 1], [1024, 8], [4096, 8], [256, 4]]) {
      const expected = scryptSync('password', 'NaCl', 32, { N: n, r, p: 1 }).toString('hex');
      expect(hex(await scrypt(enc('password'), enc('NaCl'), n, r, 32, wasm!))).toBe(expected);
      expect(hex(await scrypt(enc('password'), enc('NaCl'), n, r, 32, romixJs))).toBe(expected);
    }
  });

  it('matches the RFC 7914 vector 1 (empty password and salt, N=16, r=1, p=1)', async () => {
    // First 32 bytes of the 64-byte RFC output
    const expected = '77d6576238657b203b19ca42c18a0497f16b4844e3074ae8dfdffa3fede21442';
    const wasm = await loadWasmRomix();
    expect(hex(await scrypt(new Uint8Array(0), new Uint8Array(0), 16, 1, 32, wasm!))).toBe(expected);
    expect(hex(await scrypt(new Uint8Array(0), new Uint8Array(0), 16, 1, 32, romixJs))).toBe(expected);
  });

  it('JS SHA-256 and PBKDF2 (plain-HTTP pages without WebCrypto) equal Node crypto', () => {
    for (const len of [0, 1, 55, 56, 63, 64, 65, 200, 1000]) {
      const data = Uint8Array.from({ length: len }, (_, i) => (i * 31 + 7) & 255);
      expect(hex(sha256Js(data))).toBe(createHash('sha256').update(data).digest('hex'));
    }
    const long = new Uint8Array(100).fill(9); // HMAC key longer than the block size
    for (const [pw, salt, bytes] of [[enc('password'), enc('NaCl'), 1024], [long, enc('s'), 32], [enc('k'), new Uint8Array(0), 40]] as const) {
      expect(hex(pbkdf2Js(pw, salt, bytes))).toBe(pbkdf2Sync(pw, salt, 1, bytes, 'sha256').toString('hex'));
    }
  });

  it('works without WebCrypto (insecure context)', async () => {
    const subtle = crypto.subtle;
    Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true });
    try {
      const expected = scryptSync('password', 'NaCl', 32, { N: 1024, r: 8, p: 1 }).toString('hex');
      expect(hex(await scrypt(enc('password'), enc('NaCl'), 1024, 8, 32, (await loadWasmRomix())!))).toBe(expected);
    } finally {
      Object.defineProperty(globalThis.crypto, 'subtle', { value: subtle, configurable: true });
    }
  });

  it('counts leading zero bits', () => {
    expect(leadingZeroBits(new Uint8Array([0, 0x0f, 0xff]))).toBe(12);
    expect(leadingZeroBits(new Uint8Array([0x80]))).toBe(0);
    expect(leadingZeroBits(new Uint8Array([0, 0]))).toBe(16);
  });
});

describe('solveMemoryHard', () => {
  it('finds a nonce the server-side check (Node scrypt) accepts, with both engines', async () => {
    const c = { challenge: 'AEGIS.pow1.test.sig', seed: 'a1b2c3', n: 1024, r: 8, bits: 3 };
    for (const engine of ['wasm', 'js'] as const) {
      const solution = await solveMemoryHard(c, { engine });
      expect(solution.engine).toBe(engine);
      const digest = scryptSync(Buffer.from(challengeInput(c.challenge, solution.nonce)), c.seed, 32, { N: c.n, r: c.r, p: 1 });
      expect(leadingZeroBits(digest)).toBeGreaterThanOrEqual(c.bits);
    }
  });

  it('rejects parameters that would exhaust client memory', async () => {
    await expect(solveMemoryHard({ challenge: 'x', seed: 's', n: 1 << 20, r: 8, bits: 1 })).rejects.toThrow(/out of range/);
  });
});

import { scryptSync } from 'crypto';
import { MemoryHardChallenger, leadingZeroBits, POW_PREFIX } from '../src/security/MemoryHardChallenge';

function solve(c: { challenge: string; seed: string; n: number; r: number; bits: number }): number {
  for (let nonce = 0; ; nonce++) {
    const d = scryptSync(`${c.challenge}:${nonce}`, c.seed, 32, { N: c.n, r: c.r, p: 1 });
    if (leadingZeroBits(d) >= c.bits) return nonce;
  }
}

function unsolved(c: { challenge: string; seed: string; n: number; r: number; bits: number }): number {
  for (let nonce = 0; ; nonce++) {
    const d = scryptSync(`${c.challenge}:${nonce}`, c.seed, 32, { N: c.n, r: c.r, p: 1 });
    if (leadingZeroBits(d) < c.bits) return nonce;
  }
}

describe('MemoryHardChallenger', () => {
  const secret = 'pow-secret-0123456789abcdef';
  let ch: MemoryHardChallenger;
  beforeEach(() => { ch = new MemoryHardChallenger(secret, { n: 1024, r: 8, bits: 3 }); });
  afterEach(() => ch.destroy());

  it('issues signed challenges with the configured parameters', () => {
    const c = ch.issue();
    expect(c.challenge.startsWith(POW_PREFIX)).toBe(true);
    expect(c).toMatchObject({ n: 1024, r: 8, bits: 3 });
    expect(ch.issue().seed).not.toBe(c.seed);
  });

  it('accepts a correct solution once', async () => {
    const c = ch.issue();
    const nonce = solve(c);
    expect(await ch.verify(c.challenge, nonce)).toMatchObject({ valid: true });
    expect(await ch.verify(c.challenge, nonce)).toEqual({ valid: false, reason: 'replay' });
  });

  it('rejects wrong work, tampering, other secrets, expiry and junk', async () => {
    const c = ch.issue();
    expect(await ch.verify(c.challenge, unsolved(c))).toEqual({ valid: false, reason: 'insufficient_work' });
    // the failed attempt burnt the challenge: guessing costs the server one scrypt per issued challenge
    expect(await ch.verify(c.challenge, solve(c))).toEqual({ valid: false, reason: 'replay' });

    const d = ch.issue();
    const [body, sig] = d.challenge.slice(POW_PREFIX.length).split('.');
    const easier = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), bits: 0 })).toString('base64url');
    expect(await ch.verify(`${POW_PREFIX}${easier}.${sig}`, 0)).toEqual({ valid: false, reason: 'bad_signature' });

    const other = new MemoryHardChallenger('another-secret-0123456789', { n: 1024, r: 8, bits: 3 });
    expect(await other.verify(d.challenge, solve(d))).toEqual({ valid: false, reason: 'bad_signature' });
    other.destroy();

    const old = ch.issue(Date.now() - 10 * 60_000);
    expect(await ch.verify(old.challenge, solve(old))).toEqual({ valid: false, reason: 'expired' });
    expect(await ch.verify('nope', 1)).toEqual({ valid: false, reason: 'malformed' });
    expect(await ch.verify(d.challenge, -1)).toEqual({ valid: false, reason: 'malformed' });
    expect(await ch.verify(d.challenge, '5' as unknown as number)).toEqual({ valid: false, reason: 'malformed' });
  });

  it('refuses unsafe parameters', () => {
    expect(() => new MemoryHardChallenger(secret, { n: 1000 })).toThrow(/power of two/);
    expect(() => new MemoryHardChallenger(secret, { n: 1 << 20 })).toThrow(/power of two/);
    expect(() => new MemoryHardChallenger(secret, { bits: 40 })).toThrow(/out of range/);
  });
});

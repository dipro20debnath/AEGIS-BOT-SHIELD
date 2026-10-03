import { scryptSync } from 'crypto';
import { AegisStore, MemoryStore, RedisStore, createRedisStore, MAX_HITS_PER_KEY } from '../src/store/Store';
import { MemoryHardChallenger, leadingZeroBits } from '../src/security/MemoryHardChallenge';
import { AntiTamper } from '../src/security/AntiTamper';

/**
 * The Redis cases run against a real server when AEGIS_TEST_REDIS_URL is set
 * (CI starts a redis service; locally: redis-server & AEGIS_TEST_REDIS_URL=redis://127.0.0.1:6379/15).
 */
const REDIS_URL = process.env.AEGIS_TEST_REDIS_URL;

function solve(c: { challenge: string; seed: string; n: number; r: number; bits: number }): number {
  for (let nonce = 0; ; nonce++) {
    if (leadingZeroBits(scryptSync(`${c.challenge}:${nonce}`, c.seed, 32, { N: c.n, r: c.r, p: 1 })) >= c.bits) return nonce;
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function storeContract(name: string, make: () => Promise<AegisStore>) {
  describe(name, () => {
    let store: AegisStore;
    let prefix: string;
    beforeEach(async () => { store = await make(); prefix = `t${Date.now()}${Math.random().toString(36).slice(2, 6)}:`; });
    afterEach(async () => store.close());

    it('claimOnce accepts a key once, then rejects repeats until it expires', async () => {
      expect(await store.claimOnce(prefix + 'a', 150)).toBe(true);
      expect(await store.claimOnce(prefix + 'a', 150)).toBe(false);
      expect(await store.claimOnce(prefix + 'b', 150)).toBe(true);
      await sleep(250);
      expect(await store.claimOnce(prefix + 'a', 150)).toBe(true);
    });

    it('hit counts hits inside a sliding window', async () => {
      for (let i = 1; i <= 5; i++) expect(await store.hit(prefix + 'ip', 300)).toBe(i);
      await sleep(400);
      expect(await store.hit(prefix + 'ip', 300)).toBe(1);
      expect(await store.hit(prefix + 'other', 300)).toBe(1);
    });

    it('get/set round-trips values with a TTL', async () => {
      expect(await store.get(prefix + 'k')).toBeNull();
      await store.set(prefix + 'k', '{"x":1}', 150);
      expect(await store.get(prefix + 'k')).toBe('{"x":1}');
      await sleep(250);
      expect(await store.get(prefix + 'k')).toBeNull();
    });
  });
}

storeContract('MemoryStore', async () => new MemoryStore());

describe('MemoryStore limits', () => {
  it('saturates a window at MAX_HITS_PER_KEY instead of growing', async () => {
    const store = new MemoryStore();
    let count = 0;
    for (let i = 0; i < MAX_HITS_PER_KEY + 50; i++) count = await store.hit('flood', 60_000);
    expect(count).toBe(MAX_HITS_PER_KEY);
    await store.close();
  });
});

const redisDescribe = REDIS_URL ? describe : describe.skip;

redisDescribe('RedisStore (live Redis)', () => {
  storeContract('contract', () => createRedisStore(REDIS_URL!, `aegis-test:${process.pid}:`));

  it('shares state between two clients, as two server instances would', async () => {
    const prefix = `aegis-test:${process.pid}:${Date.now()}:`;
    const a = await createRedisStore(REDIS_URL!, prefix);
    const b = await createRedisStore(REDIS_URL!, prefix);
    try {
      expect(await a.claimOnce('nonce', 5000)).toBe(true);
      expect(await b.claimOnce('nonce', 5000)).toBe(false);
      await a.hit('ip', 5000); await b.hit('ip', 5000);
      expect(await a.hit('ip', 5000)).toBe(3);
      await a.set('session', 'v1', 5000);
      expect(await b.get('session')).toBe('v1');
    } finally {
      await a.close(); await b.close();
    }
  });

  it('rejects a replayed proof-of-work solution at a second server instance', async () => {
    const prefix = `aegis-test:${process.pid}:${Date.now()}:`;
    const [sa, sb] = [await createRedisStore(REDIS_URL!, prefix), await createRedisStore(REDIS_URL!, prefix)];
    const secret = 'pow-secret-0123456789abcdef';
    const server1 = new MemoryHardChallenger(secret, { n: 1024, r: 8, bits: 2, store: sa });
    const server2 = new MemoryHardChallenger(secret, { n: 1024, r: 8, bits: 2, store: sb });
    try {
      const c = server1.issue();
      const nonce = solve(c);
      expect(await server1.verify(c.challenge, nonce)).toMatchObject({ valid: true });
      expect(await server2.verify(c.challenge, nonce)).toEqual({ valid: false, reason: 'replay' });
    } finally {
      server1.destroy(); server2.destroy();
      await sa.close(); await sb.close();
    }
  });

  it('rejects a replayed signed request at a second server instance', async () => {
    const prefix = `aegis-test:${process.pid}:${Date.now()}:`;
    const [sa, sb] = [await createRedisStore(REDIS_URL!, prefix), await createRedisStore(REDIS_URL!, prefix)];
    const a = new AntiTamper('sig-secret-0123456789', 300, sa);
    const b = new AntiTamper('sig-secret-0123456789', 300, sb);
    try {
      const req = { method: 'POST', path: '/hook', body: '{"a":1}' };
      const header = a.sign(req);
      expect(await a.verifyAsync(req, header)).toEqual({ valid: true });
      expect(await b.verifyAsync(req, header)).toEqual({ valid: false, reason: 'replay' });
    } finally {
      a.destroy(); b.destroy();
      await sa.close(); await sb.close();
    }
  });
});

describe('createRedisStore', () => {
  it('fails fast when Redis is unreachable', async () => {
    await expect(createRedisStore('redis://127.0.0.1:1/0')).rejects.toThrow(/cannot connect to Redis/);
  });

  it('RedisStore works with any ioredis-compatible client', async () => {
    const calls: unknown[][] = [];
    const fake = {
      set: async (...args: unknown[]) => { calls.push(['set', ...args]); return 'OK' as const; },
      get: async () => null,
      eval: async () => 7,
      quit: async () => 'OK',
    };
    const store = new RedisStore(fake, 'site1:');
    expect(await store.claimOnce('n1', 1000)).toBe(true);
    expect(await store.hit('ip', 1000)).toBe(7);
    expect(calls[0]).toEqual(['set', 'site1:once:n1', '1', 'PX', 1000, 'NX']);
  });
});

/**
 * Shared state for running several AEGIS server instances behind a load
 * balancer: replay nonces, rate-limit windows and session records.
 *
 * MemoryStore (the default) keeps everything in the process, which is correct
 * for one instance. With several instances each one would see only its own
 * share of a client's requests, so a replayed challenge solution could be
 * accepted once per instance and a rate limit of N would really be N per
 * instance. RedisStore moves that state into Redis, where all instances see it.
 *
 * All operations are atomic in Redis (single commands or Lua scripts); time
 * windows use the Redis server clock, so instances with skewed clocks agree.
 */
import { Logger } from '../utils/logger.js';

export interface AegisStore {
  /**
   * Claim a one-time key (challenge id, request nonce). Returns true the first
   * time within ttlMs and false for every repeat, across all instances.
   */
  claimOnce(key: string, ttlMs: number): Promise<boolean>;
  /** Record a hit for key and return the number of hits in the last windowMs, this one included. */
  hit(key: string, windowMs: number): Promise<number>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  close(): Promise<void>;
}

/** Hits kept per window key; beyond this the oldest are dropped (the count saturates instead of growing without bound). */
export const MAX_HITS_PER_KEY = 10_000;

export class MemoryStore implements AegisStore {
  private once = new Map<string, number>();
  private windows = new Map<string, number[]>();
  private values = new Map<string, { value: string; expires: number }>();
  private timer: ReturnType<typeof setInterval>;

  constructor(cleanupIntervalMs = 60_000) {
    this.timer = setInterval(() => this.cleanup(), cleanupIntervalMs);
    this.timer.unref?.();
  }

  async claimOnce(key: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const expires = this.once.get(key);
    if (expires !== undefined && expires > now) return false;
    this.once.set(key, now + ttlMs);
    return true;
  }

  async hit(key: string, windowMs: number): Promise<number> {
    const now = Date.now();
    let hits = this.windows.get(key);
    if (!hits) this.windows.set(key, hits = []);
    let drop = 0;
    while (drop < hits.length && hits[drop] <= now - windowMs) drop++;
    if (drop) hits.splice(0, drop);
    hits.push(now);
    if (hits.length > MAX_HITS_PER_KEY) hits.splice(0, hits.length - MAX_HITS_PER_KEY);
    return hits.length;
  }

  async get(key: string): Promise<string | null> {
    const entry = this.values.get(key);
    if (!entry) return null;
    if (entry.expires <= Date.now()) { this.values.delete(key); return null; }
    return entry.value;
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    this.values.set(key, { value, expires: Date.now() + ttlMs });
  }

  async close(): Promise<void> {
    clearInterval(this.timer);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [k, expires] of this.once) if (expires <= now) this.once.delete(k);
    for (const [k, entry] of this.values) if (entry.expires <= now) this.values.delete(k);
    // A window key with no hit in the last hour is stale for any sensible window
    for (const [k, hits] of this.windows) if (!hits.length || hits[hits.length - 1] < now - 3_600_000) this.windows.delete(k);
  }
}

/** The subset of an ioredis client that RedisStore uses. */
export interface RedisLikeClient {
  set(key: string, value: string, px: 'PX', ttl: number, nx?: 'NX'): Promise<'OK' | null>;
  get(key: string): Promise<string | null>;
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
  quit(): Promise<unknown>;
}

/**
 * Sliding-window log: one sorted-set member per hit, scored by the Redis
 * server's time in ms. Old hits are trimmed, and the set expires with the window.
 */
const HIT_SCRIPT = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local window = tonumber(ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
redis.call('ZADD', KEYS[1], now, ARGV[2])
local count = redis.call('ZCARD', KEYS[1])
local cap = tonumber(ARGV[3])
if count > cap then
  redis.call('ZREMRANGEBYRANK', KEYS[1], 0, count - cap - 1)
  count = cap
end
redis.call('PEXPIRE', KEYS[1], window)
return count`;

export class RedisStore implements AegisStore {
  private seq = 0;
  private readonly instance = Math.random().toString(36).slice(2, 10);

  /**
   * @param client an ioredis client (or anything with the same set/get/eval/quit)
   * @param prefix namespace for all keys, so one Redis can serve several sites
   */
  constructor(readonly client: RedisLikeClient, readonly prefix = 'aegis:') {}

  async claimOnce(key: string, ttlMs: number): Promise<boolean> {
    return (await this.client.set(this.prefix + 'once:' + key, '1', 'PX', Math.max(1, Math.ceil(ttlMs)), 'NX')) === 'OK';
  }

  async hit(key: string, windowMs: number): Promise<number> {
    // Members must be unique per hit; instance id + counter avoids collisions between servers
    const member = `${this.instance}:${(this.seq = (this.seq + 1) % Number.MAX_SAFE_INTEGER)}`;
    return Number(await this.client.eval(HIT_SCRIPT, 1, this.prefix + 'win:' + key, Math.max(1, Math.ceil(windowMs)), member, MAX_HITS_PER_KEY));
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(this.prefix + 'kv:' + key);
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    await this.client.set(this.prefix + 'kv:' + key, value, 'PX', Math.max(1, Math.ceil(ttlMs)));
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}

/**
 * Connect to Redis (e.g. "redis://localhost:6379/0") with ioredis. Rejects
 * when the server cannot be reached, so a misconfigured deployment fails at
 * startup instead of silently running with per-instance state.
 */
export async function createRedisStore(url: string, prefix = 'aegis:'): Promise<RedisStore> {
  const { Redis } = await import('ioredis');
  // No retries while connecting at startup (fail fast, leave no reconnect timer behind)
  const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2, enableOfflineQueue: false, retryStrategy: () => null });
  // Store operations reject while Redis is down (the middleware then fails open); log the cause, at most every 10 s
  let lastLog = 0;
  let lastError: Error | undefined;
  client.on('error', (error: Error) => {
    lastError = error;
    if (Date.now() - lastLog < 10_000) return;
    lastLog = Date.now();
    new Logger('RedisStore').warn(`Redis error: ${error.message}`);
  });
  try {
    await client.connect();
    // Once up, reconnect after network blips: 0.2 s, 0.4 s, ... at most 2 s apart
    client.options.retryStrategy = (times: number) => Math.min(times * 200, 2000);
  } catch (error) {
    // Already closed without retries; disconnect() would only start a 2 s cleanup timer
    if (client.status !== 'end') client.disconnect();
    throw new Error(`AEGIS: cannot connect to Redis at ${url.replace(/\/\/[^@/]*@/, '//***@')}: ${(lastError ?? error as Error).message}`);
  }
  return new RedisStore(client as unknown as RedisLikeClient, prefix);
}

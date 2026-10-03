/**
 * Size bounds for per-client in-process state (rate-limit buckets, IP
 * counters, sessions). Without them, a client rotating source IPs grows these
 * maps until the process runs out of memory; time-based cleanup alone does not
 * help while the keys are fresh.
 */

/** Default number of keys each per-client map holds. */
export const DEFAULT_MAX_KEYS = 100_000;

/**
 * A Map with at most `maxSize` keys and approximate least-recently-used
 * eviction, in O(1) per operation. Keys live in two generations: new and
 * accessed keys go into the current one; when it is full it becomes the
 * previous generation and the old previous one is dropped. Every key set or
 * read among the last `maxSize / 2` insertions is kept.
 *
 * (Evicting one key at a time with `map.keys().next()` is not O(1) in V8: the
 * iterator skips the deleted entries at the front of the table, which made a
 * full map about 50 µs slower per new client.)
 */
export class BoundedMap<K, V> {
  private current = new Map<K, V>();
  private previous = new Map<K, V>();
  private readonly generationSize: number;
  /** Keys dropped by the size bound (not by delete or clear). */
  evicted = 0;

  constructor(maxSize: number = DEFAULT_MAX_KEYS, private onEvict?: (key: K, value: V) => void) {
    if (!Number.isFinite(maxSize) || maxSize < 2) throw new RangeError('BoundedMap maxSize must be at least 2');
    this.generationSize = Math.floor(maxSize / 2);
  }

  get size(): number {
    return this.current.size + this.previous.size;
  }

  has(key: K): boolean {
    return this.current.has(key) || this.previous.has(key);
  }

  /** Read a value and mark the key as recently used. */
  get(key: K): V | undefined {
    if (this.current.has(key)) return this.current.get(key);
    if (!this.previous.has(key)) return undefined;
    const value = this.previous.get(key) as V;
    this.previous.delete(key);
    this.insert(key, value);
    return value;
  }

  set(key: K, value: V): this {
    if (this.current.has(key)) {
      this.current.set(key, value);
    } else {
      this.previous.delete(key);
      this.insert(key, value);
    }
    return this;
  }

  delete(key: K): boolean {
    return this.current.delete(key) || this.previous.delete(key);
  }

  clear(): void {
    this.current.clear();
    this.previous.clear();
  }

  *entries(): IterableIterator<[K, V]> {
    yield* this.previous.entries();
    yield* this.current.entries();
  }

  *keys(): IterableIterator<K> {
    for (const [key] of this.entries()) yield key;
  }

  *values(): IterableIterator<V> {
    for (const [, value] of this.entries()) yield value;
  }

  forEach(fn: (value: V, key: K) => void): void {
    for (const [key, value] of this.entries()) fn(value, key);
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }

  private insert(key: K, value: V): void {
    if (this.current.size >= this.generationSize) {
      this.evicted += this.previous.size;
      if (this.onEvict) for (const [k, v] of this.previous) this.onEvict(k, v);
      this.previous = this.current;
      this.current = new Map();
    }
    this.current.set(key, value);
  }
}

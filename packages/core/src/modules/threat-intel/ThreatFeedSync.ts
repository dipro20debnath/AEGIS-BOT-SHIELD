/**
 * Keeps a ThreatDatabase in sync with public IP reputation feeds:
 *
 * | feed           | content                                             | key needed |
 * |----------------|-----------------------------------------------------|------------|
 * | firehol_level1 | attacks, malware C&C, Spamhaus DROP, DShield top     | no         |
 * | spamhaus_drop  | netblocks hijacked or leased to criminals           | no         |
 * | abuseipdb      | IPs reported for abuse, confidence >= 90 (default)  | yes (env ABUSEIPDB_API_KEY) |
 *
 * A successful download atomically replaces that feed's entries; a failed one
 * keeps the previous entries (and the on-disk copy is used after a restart).
 * AbuseIPDB's free plan allows 5 blacklist downloads per day, so it is synced
 * at most every 6 hours whatever the interval.
 *
 * These lists describe hosts that attacked *someone*; a listed IP is evidence,
 * not proof, that a request is automated (shared NAT, recycled cloud IPs).
 */
import { ThreatDatabase, ThreatEntry } from './ThreatDatabase.js';
import { FEED_URLS, Fetcher, ParsedFeed, fetchText, parsePlainList, parseSpamhausDrop, readCache, writeCache } from './feeds.js';
import { Logger } from '../../utils/logger.js';

export type FeedName = 'firehol_level1' | 'spamhaus_drop' | 'abuseipdb';

interface FeedSpec {
  source: ThreatEntry['source'];
  severity: number;
  reason: string;
  parse: (text: string) => ParsedFeed;
  minIntervalMs: number;
}

const FEEDS: Record<FeedName, FeedSpec> = {
  firehol_level1: { source: 'firehol', severity: 80, reason: 'FireHOL level1 blocklist', parse: parsePlainList, minIntervalMs: 15 * 60_000 },
  spamhaus_drop: { source: 'spamhaus', severity: 90, reason: 'Spamhaus DROP (hijacked/criminal netblock)', parse: parseSpamhausDrop, minIntervalMs: 60 * 60_000 },
  abuseipdb: { source: 'abuseipdb', severity: 75, reason: 'AbuseIPDB blacklist', parse: parsePlainList, minIntervalMs: 6 * 60 * 60_000 },
};

export interface ThreatFeedSyncOptions {
  /** Feeds to sync; default firehol_level1 + spamhaus_drop, plus abuseipdb when a key is available */
  feeds?: FeedName[];
  abuseIpDbKey?: string;
  /** AbuseIPDB confidenceMinimum (25-100); default 90 */
  abuseIpDbMinConfidence?: number;
  /** Background sync interval; default 6 hours */
  intervalMs?: number;
  cacheDir?: string;
  fetcher?: Fetcher;
  timeoutMs?: number;
  /** Override download URLs (mirrors, tests) */
  urls?: Partial<Record<FeedName, string>>;
}

export interface FeedResult {
  feed: FeedName;
  ok: boolean;
  /** Entries held for this feed after the sync */
  count: number;
  droppedSpecial?: number;
  from?: 'network' | 'cache';
  skipped?: string;
  error?: string;
  updatedAt?: number;
}

export class ThreatFeedSync {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSync: Partial<Record<FeedName, number>> = {};
  private results: Partial<Record<FeedName, FeedResult>> = {};
  private logger = new Logger('ThreatFeedSync');
  private readonly feeds: FeedName[];
  private readonly abuseKey?: string;

  constructor(private db: ThreatDatabase, private options: ThreatFeedSyncOptions = {}) {
    this.abuseKey = options.abuseIpDbKey ?? process.env.ABUSEIPDB_API_KEY;
    this.feeds = options.feeds ?? ['firehol_level1', 'spamhaus_drop', 'abuseipdb'];
    // Serve the last good copy immediately, before the first download finishes
    for (const feed of this.feeds) {
      const cached = readCache(options.cacheDir, feed);
      if (cached) this.apply(feed, cached.text, 'cache', cached.fetchedAt);
    }
  }

  /** Download every configured feed (in parallel); never throws. */
  public async syncAll(force = false): Promise<FeedResult[]> {
    return Promise.all(this.feeds.map(feed => this.sync(feed, force)));
  }

  public async sync(feed: FeedName, force = false): Promise<FeedResult> {
    const spec = FEEDS[feed];
    if (feed === 'abuseipdb' && !this.abuseKey) {
      return this.record({ feed, ok: false, count: this.count(spec), skipped: 'no ABUSEIPDB_API_KEY' });
    }
    const last = this.lastSync[feed] ?? 0;
    if (!force && Date.now() - last < spec.minIntervalMs) {
      return this.results[feed] ?? { feed, ok: true, count: this.count(spec), skipped: 'synced recently' };
    }
    this.lastSync[feed] = Date.now();
    try {
      const text = await fetchText(this.url(feed), {
        fetcher: this.options.fetcher,
        timeoutMs: this.options.timeoutMs,
        headers: feed === 'abuseipdb' ? { Key: this.abuseKey!, Accept: 'text/plain' } : undefined,
      });
      const result = this.apply(feed, text, 'network', Date.now());
      if (result.ok) writeCache(this.options.cacheDir, feed, text);
      return result;
    } catch (error) {
      this.logger.warn('Feed sync failed; keeping previous entries', { feed, error: (error as Error).message });
      return this.record({ feed, ok: false, count: this.count(spec), error: (error as Error).message });
    }
  }

  /** Sync now and then every `intervalMs`. Returns the first sync. */
  public start(): Promise<FeedResult[]> {
    if (!this.timer) {
      this.timer = setInterval(() => { void this.syncAll(); }, this.options.intervalMs ?? 6 * 60 * 60_000);
      this.timer.unref?.();
    }
    return this.syncAll(true);
  }

  public stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  public status(): FeedResult[] {
    return this.feeds.map(feed => this.results[feed] ?? { feed, ok: false, count: 0, skipped: 'not synced yet' });
  }

  private apply(feed: FeedName, text: string, from: 'network' | 'cache', updatedAt: number): FeedResult {
    const spec = FEEDS[feed];
    const parsed = spec.parse(text);
    if (parsed.entries.length === 0) {
      // An empty or HTML error page must not wipe a good list
      return this.record({ feed, ok: false, count: this.count(spec), error: 'feed contained no usable entries' });
    }
    const count = this.db.replaceSource(spec.source, parsed.entries.map(identifier => ({
      identifier,
      type: identifier.includes('/') ? 'cidr' as const : 'ip' as const,
      severity: spec.severity,
      reason: spec.reason,
      expiresAt: 0,
      metadata: { feed },
    })));
    this.logger.info('Feed loaded', { feed, count, droppedSpecial: parsed.droppedSpecial, from });
    return this.record({ feed, ok: true, count, droppedSpecial: parsed.droppedSpecial, from, updatedAt });
  }

  private url(feed: FeedName): string {
    if (this.options.urls?.[feed]) return this.options.urls[feed]!;
    if (feed === 'abuseipdb') {
      return `${FEED_URLS.abuseipdb}?confidenceMinimum=${this.options.abuseIpDbMinConfidence ?? 90}&plaintext`;
    }
    return FEED_URLS[feed];
  }

  private count(spec: FeedSpec): number {
    return this.db.getAll({ source: spec.source }).length;
  }

  private record(result: FeedResult): FeedResult {
    this.results[result.feed] = result;
    return result;
  }
}

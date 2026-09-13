import { DetectionSignal, ThreatCategory } from '../../types/index.js';
import { Logger } from '../../utils/logger.js';
import * as fs from 'fs';
import * as path from 'path';

/** Threat entry in the database */
export interface ThreatEntry {
  /** Target identifier (IP, fingerprint hash, user-agent pattern) */
  identifier: string;
  /** Type of threat identifier */
  type: 'ip' | 'cidr' | 'fingerprint' | 'user-agent' | 'ja4' | 'pattern';
  /** Threat severity 0-100 */
  severity: number;
  /** OWASP OAT category */
  category?: ThreatCategory;
  /** Human-readable reason */
  reason: string;
  /** When this entry was added */
  addedAt: number;
  /** When this entry expires (0 = never) */
  expiresAt: number;
  /** Number of times this threat was matched */
  hitCount: number;
  /** Source of the intelligence */
  source: 'manual' | 'auto-detected' | 'community' | 'abuseipdb' | 'spamhaus' | 'tor-list';
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/** Database statistics */
export interface ThreatDbStats {
  totalEntries: number;
  byType: Record<string, number>;
  bySource: Record<string, number>;
  totalHits: number;
  lastUpdated: number;
}

/**
 * Comprehensive Threat Intelligence Database
 *
 * Persistent storage and fast lookup for known threats.
 * Supports IPs, CIDR ranges, fingerprints, user-agent patterns,
 * JA4 hashes, and regex patterns.
 *
 * Features:
 * - In-memory index with JSON file persistence
 * - CIDR range matching for IP blocks
 * - Regex / substring pattern matching for user-agents
 * - Automatic expiration of time-limited entries
 * - Hit counting and statistics
 * - Bulk import / export
 * - 30+ built-in bot & scanner signatures
 */
export class ThreatDatabase {
  private entries: Map<string, ThreatEntry> = new Map();
  private cidrEntries: ThreatEntry[] = [];
  private patternEntries: ThreatEntry[] = [];
  private persistPath?: string;
  private logger: Logger;
  private autoSaveInterval: ReturnType<typeof setInterval> | null = null;
  private dirty = false;

  constructor(options?: {
    persistPath?: string;
    autoSaveIntervalMs?: number;
    loadBuiltinSignatures?: boolean;
  }) {
    this.logger = new Logger('ThreatDatabase');

    this.persistPath = options?.persistPath;
    if (this.persistPath) this.loadFromDisk();

    if (options?.loadBuiltinSignatures !== false) {
      this.loadBuiltinSignatures();
    }

    if (this.persistPath && options?.autoSaveIntervalMs) {
      this.autoSaveInterval = setInterval(() => this.saveToDisk(), options.autoSaveIntervalMs);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                         */
  /* ------------------------------------------------------------------ */

  /** Add a threat entry to the database. */
  public add(entry: Omit<ThreatEntry, 'addedAt' | 'hitCount'>): void {
    const full: ThreatEntry = { ...entry, addedAt: Date.now(), hitCount: 0 };

    if (entry.type === 'cidr') {
      this.cidrEntries.push(full);
    } else if (entry.type === 'pattern') {
      this.patternEntries.push(full);
    } else {
      this.entries.set(this.key(entry.identifier, entry.type), full);
    }

    this.dirty = true;
    this.logger.debug('Threat entry added', { identifier: entry.identifier, type: entry.type });
  }

  /** Remove a threat entry by identifier. */
  public remove(identifier: string): boolean {
    let removed = false;
    for (const type of ['ip', 'fingerprint', 'user-agent', 'ja4'] as const) {
      if (this.entries.delete(this.key(identifier, type))) removed = true;
    }
    const cidrBefore = this.cidrEntries.length;
    this.cidrEntries = this.cidrEntries.filter(e => e.identifier !== identifier);
    if (this.cidrEntries.length < cidrBefore) removed = true;

    const patBefore = this.patternEntries.length;
    this.patternEntries = this.patternEntries.filter(e => e.identifier !== identifier);
    if (this.patternEntries.length < patBefore) removed = true;

    if (removed) this.dirty = true;
    return removed;
  }

  /** Check an identifier against exact, CIDR, and pattern entries. */
  public check(
    identifier: string,
    type?: ThreatEntry['type'],
  ): { matched: boolean; entries: ThreatEntry[]; signals: DetectionSignal[] } {
    if (type === 'ip') return this.checkIP(identifier);
    if (type === 'user-agent' || type === 'pattern') return this.checkUserAgent(identifier);
    if (type === 'fingerprint' || type === 'ja4') return this.checkFingerprint(identifier);

    // generic exact lookup across types
    const matched: ThreatEntry[] = [];
    for (const t of ['ip', 'fingerprint', 'user-agent', 'ja4'] as const) {
      const entry = this.entries.get(this.key(identifier, t));
      if (entry && !this.isExpired(entry)) {
        entry.hitCount++;
        matched.push(entry);
      }
    }
    return { matched: matched.length > 0, entries: matched, signals: matched.map(e => this.toSignal(e)) };
  }

  /** Check IP against exact entries AND CIDR ranges. */
  public checkIP(ip: string): { matched: boolean; entries: ThreatEntry[]; signals: DetectionSignal[] } {
    const matched: ThreatEntry[] = [];

    // Exact match
    const exact = this.entries.get(this.key(ip, 'ip'));
    if (exact && !this.isExpired(exact)) {
      exact.hitCount++;
      matched.push(exact);
    }

    // CIDR match
    for (const entry of this.cidrEntries) {
      if (this.isExpired(entry)) continue;
      if (this.ipInCidr(ip, entry.identifier)) {
        entry.hitCount++;
        matched.push(entry);
      }
    }

    return { matched: matched.length > 0, entries: matched, signals: matched.map(e => this.toSignal(e)) };
  }

  /** Check user-agent against pattern entries (case-insensitive substring). */
  public checkUserAgent(ua: string): { matched: boolean; entries: ThreatEntry[]; signals: DetectionSignal[] } {
    const lower = ua.toLowerCase();
    const matched: ThreatEntry[] = [];

    for (const entry of this.patternEntries) {
      if (this.isExpired(entry)) continue;
      if (lower.includes(entry.identifier.toLowerCase())) {
        entry.hitCount++;
        matched.push(entry);
      }
    }

    return { matched: matched.length > 0, entries: matched, signals: matched.map(e => this.toSignal(e)) };
  }

  /** Check JA4 / device fingerprint (exact). */
  public checkFingerprint(fingerprint: string): { matched: boolean; entries: ThreatEntry[]; signals: DetectionSignal[] } {
    const matched: ThreatEntry[] = [];

    for (const type of ['fingerprint', 'ja4'] as const) {
      const entry = this.entries.get(this.key(fingerprint, type));
      if (entry && !this.isExpired(entry)) {
        entry.hitCount++;
        matched.push(entry);
      }
    }

    return { matched: matched.length > 0, entries: matched, signals: matched.map(e => this.toSignal(e)) };
  }

  /** Bulk add entries. Returns count of entries added. */
  public bulkAdd(entries: Array<Omit<ThreatEntry, 'addedAt' | 'hitCount'>>): number {
    let count = 0;
    for (const e of entries) {
      this.add(e);
      count++;
    }
    return count;
  }

  /** Get all entries, optionally filtered. */
  public getAll(filter?: { type?: string; source?: string }): ThreatEntry[] {
    const all = [
      ...Array.from(this.entries.values()),
      ...this.cidrEntries,
      ...this.patternEntries,
    ];

    if (!filter) return all;
    return all.filter(e => {
      if (filter.type && e.type !== filter.type) return false;
      if (filter.source && e.source !== filter.source) return false;
      return true;
    });
  }

  /** Get database statistics. */
  public getStats(): ThreatDbStats {
    const all = this.getAll();
    const byType: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    let totalHits = 0;

    for (const e of all) {
      byType[e.type] = (byType[e.type] || 0) + 1;
      bySource[e.source] = (bySource[e.source] || 0) + 1;
      totalHits += e.hitCount;
    }

    return { totalEntries: all.length, byType, bySource, totalHits, lastUpdated: Date.now() };
  }

  /** Remove expired entries. Returns count removed. */
  public pruneExpired(): number {
    let count = 0;
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt > 0 && entry.expiresAt < now) {
        this.entries.delete(key);
        count++;
      }
    }
    const cb = this.cidrEntries.length;
    this.cidrEntries = this.cidrEntries.filter(e => !(e.expiresAt > 0 && e.expiresAt < now));
    count += cb - this.cidrEntries.length;

    const pb = this.patternEntries.length;
    this.patternEntries = this.patternEntries.filter(e => !(e.expiresAt > 0 && e.expiresAt < now));
    count += pb - this.patternEntries.length;

    if (count > 0) this.dirty = true;
    return count;
  }

  /** Export full database as JSON string. */
  public exportToJson(): string {
    return JSON.stringify(this.getAll(), null, 2);
  }

  /** Import entries from JSON string. Returns count imported. */
  public importFromJson(json: string): number {
    const data: ThreatEntry[] = JSON.parse(json);
    return this.bulkAdd(data);
  }

  /** Clean up resources. */
  public destroy(): void {
    if (this.autoSaveInterval) clearInterval(this.autoSaveInterval);
    if (this.dirty) this.saveToDisk();
  }

  /* ------------------------------------------------------------------ */
  /*  Private helpers                                                    */
  /* ------------------------------------------------------------------ */

  private key(identifier: string, type: string): string {
    return `${type}::${identifier}`;
  }

  private isExpired(entry: ThreatEntry): boolean {
    return entry.expiresAt > 0 && entry.expiresAt < Date.now();
  }

  private toSignal(entry: ThreatEntry): DetectionSignal {
    return {
      category: 'reputation',
      type: `threat.${entry.type}`,
      value: entry.severity,
      confidence: entry.source === 'manual' ? 0.95 : 0.8,
      description: `${entry.reason} [source: ${entry.source}]`,
      weight: entry.severity >= 80 ? 1.5 : 1.0,
    };
  }

  /** Check whether an IPv4 address falls within a CIDR block. */
  private ipInCidr(ip: string, cidr: string): boolean {
    try {
      const [rangeIp, prefixStr] = cidr.split('/');
      const prefix = parseInt(prefixStr, 10);
      const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
      return (this.ipToNumber(ip) & mask) === (this.ipToNumber(rangeIp) & mask);
    } catch {
      return false;
    }
  }

  /** Convert dotted-quad IPv4 to a 32-bit unsigned integer. */
  private ipToNumber(ip: string): number {
    const parts = ip.split('.').map(Number);
    return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  }

  /* ------------------------------------------------------------------ */
  /*  Persistence                                                       */
  /* ------------------------------------------------------------------ */

  private saveToDisk(): void {
    if (!this.persistPath || !this.dirty) return;
    try {
      const dir = path.dirname(this.persistPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.persistPath, this.exportToJson(), 'utf-8');
      this.dirty = false;
      this.logger.debug('Threat database saved to disk');
    } catch (err) {
      this.logger.error('Failed to save threat database', err as Error);
    }
  }

  private loadFromDisk(): void {
    if (!this.persistPath || !fs.existsSync(this.persistPath)) return;
    try {
      const json = fs.readFileSync(this.persistPath, 'utf-8');
      this.importFromJson(json);
      this.logger.info('Threat database loaded from disk', { entries: this.getAll().length });
    } catch (err) {
      this.logger.error('Failed to load threat database', err as Error);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Built-in signatures                                               */
  /* ------------------------------------------------------------------ */

  private loadBuiltinSignatures(): void {
    const builtins: Array<Omit<ThreatEntry, 'addedAt' | 'hitCount'>> = [
      // --- Automation frameworks ---
      { identifier: 'HeadlessChrome', type: 'pattern', severity: 70, reason: 'Headless Chrome detected', source: 'manual', expiresAt: 0 },
      { identifier: 'PhantomJS', type: 'pattern', severity: 85, reason: 'PhantomJS headless browser', source: 'manual', expiresAt: 0 },
      { identifier: 'Selenium', type: 'pattern', severity: 80, reason: 'Selenium automation', source: 'manual', expiresAt: 0 },
      { identifier: 'webdriver', type: 'pattern', severity: 80, reason: 'WebDriver automation', source: 'manual', expiresAt: 0 },
      { identifier: 'Puppeteer', type: 'pattern', severity: 75, reason: 'Puppeteer automation', source: 'manual', expiresAt: 0 },
      { identifier: 'Playwright', type: 'pattern', severity: 75, reason: 'Playwright automation', source: 'manual', expiresAt: 0 },
      // --- HTTP libraries ---
      { identifier: 'python-requests', type: 'pattern', severity: 40, reason: 'Python requests library', source: 'manual', expiresAt: 0 },
      { identifier: 'python-urllib', type: 'pattern', severity: 45, reason: 'Python urllib', source: 'manual', expiresAt: 0 },
      { identifier: 'Go-http-client', type: 'pattern', severity: 50, reason: 'Go HTTP client', source: 'manual', expiresAt: 0 },
      { identifier: 'java/', type: 'pattern', severity: 40, reason: 'Java HTTP client', source: 'manual', expiresAt: 0 },
      { identifier: 'libwww-perl', type: 'pattern', severity: 60, reason: 'Perl LWP library', source: 'manual', expiresAt: 0 },
      { identifier: 'Wget/', type: 'pattern', severity: 55, reason: 'Wget downloader', source: 'manual', expiresAt: 0 },
      { identifier: 'curl/', type: 'pattern', severity: 35, reason: 'curl client', source: 'manual', expiresAt: 0 },
      { identifier: 'scrapy', type: 'pattern', severity: 75, reason: 'Scrapy web scraper', source: 'manual', expiresAt: 0 },
      { identifier: 'node-fetch', type: 'pattern', severity: 30, reason: 'Node.js fetch', source: 'manual', expiresAt: 0 },
      { identifier: 'axios/', type: 'pattern', severity: 25, reason: 'Axios HTTP client', source: 'manual', expiresAt: 0 },
      { identifier: 'httpclient', type: 'pattern', severity: 45, reason: 'Generic HTTP client', source: 'manual', expiresAt: 0 },
      // --- Vulnerability scanners ---
      { identifier: 'sqlmap', type: 'pattern', severity: 95, reason: 'SQLMap injection tool', source: 'manual', expiresAt: 0 },
      { identifier: 'nikto', type: 'pattern', severity: 90, reason: 'Nikto vulnerability scanner', source: 'manual', expiresAt: 0 },
      { identifier: 'nmap', type: 'pattern', severity: 85, reason: 'Nmap port scanner', source: 'manual', expiresAt: 0 },
      { identifier: 'masscan', type: 'pattern', severity: 90, reason: 'Masscan scanner', source: 'manual', expiresAt: 0 },
      { identifier: 'ZmEu', type: 'pattern', severity: 95, reason: 'ZmEu exploit scanner', source: 'manual', expiresAt: 0 },
      { identifier: 'Acunetix', type: 'pattern', severity: 90, reason: 'Acunetix scanner', source: 'manual', expiresAt: 0 },
      { identifier: 'DirBuster', type: 'pattern', severity: 85, reason: 'DirBuster directory scanner', source: 'manual', expiresAt: 0 },
      { identifier: 'Nessus', type: 'pattern', severity: 88, reason: 'Nessus vulnerability scanner', source: 'manual', expiresAt: 0 },
      // --- SEO / scraping bots ---
      { identifier: 'SemrushBot', type: 'pattern', severity: 30, reason: 'SEMrush crawler', source: 'manual', expiresAt: 0 },
      { identifier: 'AhrefsBot', type: 'pattern', severity: 30, reason: 'Ahrefs crawler', source: 'manual', expiresAt: 0 },
      { identifier: 'MJ12bot', type: 'pattern', severity: 35, reason: 'Majestic crawler', source: 'manual', expiresAt: 0 },
      { identifier: 'DotBot', type: 'pattern', severity: 30, reason: 'Moz crawler', source: 'manual', expiresAt: 0 },
      // --- Known good bots (low severity, tag only) ---
      { identifier: 'Googlebot', type: 'pattern', severity: 5, reason: 'Google search crawler', source: 'manual', expiresAt: 0 },
      { identifier: 'Bingbot', type: 'pattern', severity: 5, reason: 'Bing search crawler', source: 'manual', expiresAt: 0 },
      { identifier: 'Slurp', type: 'pattern', severity: 5, reason: 'Yahoo crawler', source: 'manual', expiresAt: 0 },
      { identifier: 'facebookexternalhit', type: 'pattern', severity: 5, reason: 'Facebook crawler', source: 'manual', expiresAt: 0 },
      { identifier: 'Twitterbot', type: 'pattern', severity: 5, reason: 'Twitter crawler', source: 'manual', expiresAt: 0 },
    ];
    this.bulkAdd(builtins);
    this.logger.debug('Built-in signatures loaded', { count: builtins.length });
  }
}

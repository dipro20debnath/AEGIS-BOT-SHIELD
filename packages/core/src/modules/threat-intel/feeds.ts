/**
 * Parsers and download helpers for public IP reputation feeds.
 *
 * Every parser drops special-purpose IPv4 ranges (RFC 6890: private, loopback,
 * CGNAT, documentation, multicast, reserved). FireHOL level1 includes
 * "fullbogons", i.e. 10.0.0.0/8, 127.0.0.0/8, 192.168.0.0/16 and 100.64.0.0/10.
 * Imported as-is these would block localhost, every request behind a reverse
 * proxy and carrier-grade NAT users; bogons are already flagged by IPAnalyzer.
 */
import { isIPv4 } from 'net';
import * as fs from 'fs';
import * as path from 'path';

export const FEED_URLS = {
  tor: 'https://check.torproject.org/torbulkexitlist',
  firehol_level1: 'https://raw.githubusercontent.com/firehol/blocklist-ipsets/master/firehol_level1.netset',
  spamhaus_drop: 'https://www.spamhaus.org/drop/drop_v4.json',
  abuseipdb: 'https://api.abuseipdb.com/api/v2/blacklist',
} as const;

/** Minimal fetch signature, so tests (and proxies) can inject their own. */
export type Fetcher = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** RFC 6890 special-purpose IPv4 blocks (plus 0/8, multicast and 240/4). */
const SPECIAL_PURPOSE: Array<[number, number]> = [
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12',
  '192.0.0.0/24', '192.0.2.0/24', '192.88.99.0/24', '192.168.0.0/16', '198.18.0.0/15',
  '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4',
].map(c => cidrRange(c)!);

export function ipv4ToNumber(ip: string): number {
  const p = ip.split('.').map(Number);
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}

/** [first, last] address of an IPv4 CIDR (or single IP) as unsigned ints; null if invalid. */
export function cidrRange(cidr: string): [number, number] | null {
  const [ip, prefixStr] = cidr.trim().split('/');
  if (!isIPv4(ip)) return null;
  const prefix = prefixStr === undefined ? 32 : Number(prefixStr);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  const first = (ipv4ToNumber(ip) & mask) >>> 0;
  return [first, (first | (~mask >>> 0)) >>> 0];
}

/** True if the CIDR/IP overlaps any special-purpose block. */
export function isSpecialPurpose(cidr: string): boolean {
  const r = cidrRange(cidr);
  if (!r) return false;
  return SPECIAL_PURPOSE.some(([a, b]) => r[0] <= b && a <= r[1]);
}

export interface ParsedFeed {
  /** Valid public IPv4 addresses and CIDRs */
  entries: string[];
  /** Lines dropped: special-purpose ranges */
  droppedSpecial: number;
  /** Lines dropped: not an IPv4 address/CIDR */
  droppedInvalid: number;
}

function collect(candidates: Iterable<string>): ParsedFeed {
  const entries: string[] = [];
  let droppedSpecial = 0;
  let droppedInvalid = 0;
  for (const raw of candidates) {
    const value = raw.trim();
    if (!value) continue;
    if (!cidrRange(value)) { droppedInvalid++; continue; }
    if (isSpecialPurpose(value)) { droppedSpecial++; continue; }
    entries.push(value.endsWith('/32') ? value.slice(0, -3) : value);
  }
  return { entries, droppedSpecial, droppedInvalid };
}

/**
 * Plain lists: one IP or CIDR per line, "#" or ";" comments
 * (Tor bulk exit list, FireHOL .netset/.ipset, AbuseIPDB plaintext, legacy Spamhaus drop.txt).
 */
export function parsePlainList(text: string): ParsedFeed {
  return collect(text.split(/\r?\n/).map(line => line.split(/[#;]/)[0]).filter(l => l.trim()));
}

/**
 * Spamhaus DROP v4 JSON: newline-delimited JSON objects {"cidr": "...", "sblid": "...", "rir": "..."}
 * with a final {"type": "metadata", ...} line.
 */
export function parseSpamhausDrop(text: string): ParsedFeed {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('{')) return parsePlainList(text); // legacy drop.txt
  const cidrs: string[] = [];
  let invalid = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line) as { cidr?: string; type?: string };
      if (obj.cidr) cidrs.push(obj.cidr);
    } catch {
      invalid++;
    }
  }
  const parsed = collect(cidrs);
  return { ...parsed, droppedInvalid: parsed.droppedInvalid + invalid };
}

/** GET a URL as text with a timeout; throws on network errors and non-2xx responses. */
export async function fetchText(url: string, options: { fetcher?: Fetcher; timeoutMs?: number; headers?: Record<string, string> } = {}): Promise<string> {
  const fetcher: Fetcher = options.fetcher ?? ((u, init) => fetch(u, init));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  timer.unref?.();
  try {
    const res = await fetcher(url, { headers: { 'User-Agent': 'aegis-bot-shield-feed-sync', ...options.headers }, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Last successful download, kept on disk so a restart works offline. */
export function readCache(cacheDir: string | undefined, name: string): { text: string; fetchedAt: number } | null {
  if (!cacheDir) return null;
  const file = path.join(cacheDir, `${name}.txt`);
  try {
    return { text: fs.readFileSync(file, 'utf8'), fetchedAt: fs.statSync(file).mtimeMs };
  } catch {
    return null;
  }
}

export function writeCache(cacheDir: string | undefined, name: string, text: string): void {
  if (!cacheDir) return;
  fs.mkdirSync(cacheDir, { recursive: true });
  const file = path.join(cacheDir, `${name}.txt`);
  fs.writeFileSync(`${file}.tmp`, text, 'utf8');
  fs.renameSync(`${file}.tmp`, file);
}

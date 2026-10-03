import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parsePlainList, parseSpamhausDrop, isSpecialPurpose, Fetcher } from '../src/modules/threat-intel/feeds';
import { ThreatDatabase } from '../src/modules/threat-intel/ThreatDatabase';
import { ThreatFeedSync } from '../src/modules/threat-intel/ThreatFeedSync';
import { TorExitNodeChecker } from '../src/modules/ip-intelligence/TorExitNodeChecker';

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const FIREHOL = fixture('firehol_level1.sample.netset');
const SPAMHAUS = fixture('spamhaus_drop_v4.sample.json');
const TOR = fixture('torbulkexitlist.sample.txt');

/** Fake fetch serving fixtures by URL substring; records calls. */
function fakeFetcher(routes: Record<string, string | number>): Fetcher & { calls: Array<{ url: string; headers?: Record<string, string> }> } {
  const calls: Array<{ url: string; headers?: Record<string, string> }> = [];
  const fn = (async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url, headers: init?.headers });
    const key = Object.keys(routes).find(k => url.includes(k));
    const body = key === undefined ? 404 : routes[key];
    if (typeof body === 'number') return { ok: false, status: body, text: async () => '' };
    return { ok: true, status: 200, text: async () => body };
  }) as Fetcher & { calls: typeof calls };
  fn.calls = calls;
  return fn;
}

describe('feed parsers', () => {
  it('drops special-purpose ranges that FireHOL level1 includes', () => {
    const parsed = parsePlainList(FIREHOL);
    expect(parsed.entries).toContain('1.10.16.0/20');
    expect(parsed.entries).toContain('50.16.16.211');
    for (const special of ['10.0.0.0/8', '127.0.0.0/8', '100.64.0.0/10', '192.168.0.0/16', '198.51.100.0/24', '224.0.0.0/3', '0.0.0.0/8']) {
      expect(parsed.entries).not.toContain(special);
    }
    expect(parsed.droppedSpecial).toBe(7);
  });

  it('parses Spamhaus DROP v4 JSON lines and skips the metadata line', () => {
    const parsed = parseSpamhausDrop(SPAMHAUS);
    expect(parsed.entries).toEqual(['1.10.16.0/20', '1.19.0.0/16', '5.42.92.0/24']);
    expect(parsed.droppedSpecial).toBe(1);
    expect(parseSpamhausDrop('1.2.3.0/24 ; SBL1\n').entries).toEqual(['1.2.3.0/24']); // legacy drop.txt
  });

  it('detects overlap with special-purpose blocks', () => {
    expect(isSpecialPurpose('172.20.1.1')).toBe(true);
    expect(isSpecialPurpose('172.32.0.1')).toBe(false);
    expect(isSpecialPurpose('8.0.0.0/4')).toBe(true); // contains 10.0.0.0/8
    expect(isSpecialPurpose('103.230.104.0/24')).toBe(false);
  });
});

describe('ThreatFeedSync', () => {
  let db: ThreatDatabase;
  beforeEach(() => { db = new ThreatDatabase({ loadBuiltinSignatures: false }); });
  afterEach(() => db.destroy());

  it('loads feeds into the database and matches IPs inside listed ranges', async () => {
    const fetcher = fakeFetcher({ firehol: FIREHOL, spamhaus: SPAMHAUS });
    const sync = new ThreatFeedSync(db, { fetcher, abuseIpDbKey: '' });
    const results = await sync.syncAll();
    expect(results.find(r => r.feed === 'firehol_level1')).toMatchObject({ ok: true, droppedSpecial: 7 });
    expect(results.find(r => r.feed === 'abuseipdb')).toMatchObject({ ok: false, skipped: 'no ABUSEIPDB_API_KEY' });
    expect(fetcher.calls.some(c => c.url.includes('abuseipdb'))).toBe(false);

    const hit = db.checkIP('1.10.20.5');
    expect(hit.entries.map(e => e.source).sort()).toEqual(['firehol', 'spamhaus']);
    expect(hit.signals[0]).toMatchObject({ category: 'reputation', type: 'threat.cidr' });
    expect(db.checkIP('10.1.2.3').matched).toBe(false);
    expect(db.checkIP('127.0.0.1').matched).toBe(false);
    expect(db.checkIP('::1').matched).toBe(false);
    expect(db.checkIP('::ffff:50.16.16.211').matched).toBe(false); // exact IPs are stored as typed
    expect(db.checkIP('50.16.16.211').matched).toBe(true);
  });

  it('keeps the previous entries when a download fails or is empty, and replaces them on success', async () => {
    const routes: Record<string, string | number> = { firehol: FIREHOL };
    const sync = new ThreatFeedSync(db, { fetcher: fakeFetcher(routes), feeds: ['firehol_level1'] });
    await sync.sync('firehol_level1', true);
    const before = db.getAll({ source: 'firehol' }).length;

    routes.firehol = 503;
    expect(await sync.sync('firehol_level1', true)).toMatchObject({ ok: false, count: before });
    routes.firehol = '<html>maintenance</html>';
    expect(await sync.sync('firehol_level1', true)).toMatchObject({ ok: false, count: before });
    expect(db.checkIP('1.10.20.5').matched).toBe(true);

    routes.firehol = '203.0.114.0/24\n';
    expect(await sync.sync('firehol_level1', true)).toMatchObject({ ok: true, count: 1 });
    expect(db.checkIP('1.10.20.5').matched).toBe(false);
    expect(db.checkIP('203.0.114.9').matched).toBe(true);
  });

  it('sends the AbuseIPDB key as a header and rate-limits that feed', async () => {
    const fetcher = fakeFetcher({ abuseipdb: '45.155.205.1\n45.155.205.2\n' });
    const sync = new ThreatFeedSync(db, { fetcher, feeds: ['abuseipdb'], abuseIpDbKey: 'k-123' });
    expect(await sync.sync('abuseipdb')).toMatchObject({ ok: true, count: 2 });
    expect(fetcher.calls[0].headers).toMatchObject({ Key: 'k-123', Accept: 'text/plain' });
    expect(fetcher.calls[0].url).toContain('confidenceMinimum=90');
    await sync.sync('abuseipdb');
    expect(fetcher.calls).toHaveLength(1); // second call within 6 h is skipped
  });

  it('restores the last download from the cache directory after a restart', async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-feeds-'));
    await new ThreatFeedSync(db, { fetcher: fakeFetcher({ firehol: FIREHOL }), feeds: ['firehol_level1'], cacheDir }).syncAll();
    const fresh = new ThreatDatabase({ loadBuiltinSignatures: false });
    const offline = new ThreatFeedSync(fresh, { fetcher: fakeFetcher({}), feeds: ['firehol_level1'], cacheDir });
    expect(offline.status()[0]).toMatchObject({ ok: true, from: 'cache' });
    expect(fresh.checkIP('1.10.20.5').matched).toBe(true);
    fresh.destroy();
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it('looks up thousands of ranges quickly', () => {
    const entries = Array.from({ length: 5000 }, (_, i) => ({
      identifier: `${11 + (i % 200)}.${(i * 7) % 256}.${i % 256}.0/24`, type: 'cidr' as const,
      severity: 80, reason: 'bench', expiresAt: 0,
    }));
    db.replaceSource('firehol', entries);
    db.checkIP('8.8.8.8'); // build index
    const start = performance.now();
    for (let i = 0; i < 10_000; i++) db.checkIP(`8.8.${i % 256}.${i % 200}`);
    expect((performance.now() - start) / 10_000).toBeLessThan(0.05); // < 50 µs per lookup
  });
});

describe('TorExitNodeChecker', () => {
  it('downloads, ignores invalid and private lines, and matches IPv4-mapped addresses', async () => {
    const tor = new TorExitNodeChecker({ fetcher: fakeFetcher({ torproject: TOR }) });
    expect(await tor.refresh()).toMatchObject({ count: 3, source: 'network' });
    expect(tor.isExitNode('185.220.101.1')).toBe(true);
    expect(tor.isExitNode('::ffff:204.8.96.10')).toBe(true);
    expect(tor.isExitNode('10.0.0.5')).toBe(false);
    expect(tor.isExitNode('8.8.8.8')).toBe(false);
  });

  it('keeps the old list when the download fails or is empty', async () => {
    const routes: Record<string, string | number> = { torproject: TOR };
    const tor = new TorExitNodeChecker({ fetcher: fakeFetcher(routes) });
    await tor.refresh();
    routes.torproject = 500;
    expect(await tor.refresh()).toMatchObject({ count: 3, lastError: expect.stringContaining('500') });
    routes.torproject = '';
    expect((await tor.refresh()).count).toBe(3);
    expect(tor.isExitNode('185.220.101.2')).toBe(true);
  });

  it('shares one request between concurrent refreshes', async () => {
    const fetcher = fakeFetcher({ torproject: TOR });
    const tor = new TorExitNodeChecker({ fetcher });
    await Promise.all([tor.refresh(), tor.refresh(), tor.refresh()]);
    expect(fetcher.calls).toHaveLength(1);
  });
});

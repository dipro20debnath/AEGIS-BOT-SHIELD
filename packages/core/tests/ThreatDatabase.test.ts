import { ThreatDatabase } from '../src/modules/threat-intel/ThreatDatabase';

describe('ThreatDatabase', () => {
  let db: ThreatDatabase;
  beforeEach(() => { db = new ThreatDatabase(); });
  afterEach(() => db.destroy());

  it('matches built-in automation and scanner user agents', () => {
    expect(db.checkUserAgent('python-requests/2.31').matched).toBe(true);
    expect(db.checkUserAgent('sqlmap/1.7').signals[0].value).toBe(95);
    expect(db.checkUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36').matched).toBe(false);
  });

  it('adds, matches and removes IP entries', () => {
    db.add({ identifier: '203.0.113.9', type: 'ip', severity: 90, reason: 'test', source: 'manual', expiresAt: 0 });
    const hit = db.checkIP('203.0.113.9');
    expect(hit.matched).toBe(true);
    expect(hit.signals[0]).toMatchObject({ category: 'reputation', type: 'threat.ip', value: 90 });
    expect(db.remove('203.0.113.9')).toBe(true);
    expect(db.checkIP('203.0.113.9').matched).toBe(false);
  });

  it('matches CIDR ranges', () => {
    db.add({ identifier: '198.51.100.0/24', type: 'cidr', severity: 70, reason: 'test range', source: 'manual', expiresAt: 0 });
    expect(db.checkIP('198.51.100.77').matched).toBe(true);
    expect(db.checkIP('198.51.101.1').matched).toBe(false);
  });

  it('ignores expired entries', () => {
    db.add({ identifier: '203.0.113.10', type: 'ip', severity: 90, reason: 'old', source: 'manual', expiresAt: Date.now() - 1 });
    expect(db.checkIP('203.0.113.10').matched).toBe(false);
  });

  it('exports and imports entries', () => {
    db.add({ identifier: '203.0.113.11', type: 'ip', severity: 80, reason: 'x', source: 'manual', expiresAt: 0 });
    const other = new ThreatDatabase({ loadBuiltinSignatures: false });
    expect(other.importFromJson(db.exportToJson())).toBeGreaterThan(0);
    expect(other.checkIP('203.0.113.11').matched).toBe(true);
    other.destroy();
  });
});

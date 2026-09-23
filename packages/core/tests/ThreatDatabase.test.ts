import { ThreatDatabase } from '../src/db/ThreatDatabase';

describe('ThreatDatabase', () => {
  let db: ThreatDatabase;

  beforeEach(() => {
    db = new ThreatDatabase();
    db.init(); // Assuming sync init for testing, or await db.init()
  });

  it('should match known bot user agents', () => {
    const isBot = db.matchUserAgent('python-requests/2.25.1');
    expect(isBot).toBe(true);
  });

  it('should match CIDR range', () => {
    db.addCidrBlock('10.0.0.0/24', 'malicious_botnet');
    const matched = db.matchIp('10.0.0.55');
    expect(matched).toBe(true);
    
    const notMatched = db.matchIp('10.0.1.55');
    expect(notMatched).toBe(false);
  });

  it('should match pattern-based signatures', () => {
    db.addPattern({ id: 'sql_inject', regex: /UNION\s+SELECT/i });
    const isMatch = db.matchPattern('payload=1 UNION SELECT * FROM users');
    expect(isMatch).toBe(true);
  });

  it('should allow adding and removing custom signatures', () => {
    const ua = 'custom-bad-bot';
    expect(db.matchUserAgent(ua)).toBe(false);
    
    db.addCustomSignature('ua', ua);
    expect(db.matchUserAgent(ua)).toBe(true);
    
    db.removeCustomSignature('ua', ua);
    expect(db.matchUserAgent(ua)).toBe(false);
  });
});

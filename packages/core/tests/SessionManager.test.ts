import { SessionManager } from '../src/modules/session/SessionManager';

describe('SessionManager', () => {
  let manager: SessionManager;
  beforeEach(() => { manager = new SessionManager({ secretKey: 'session-secret' }); });
  afterEach(() => manager.destroy());

  it('requires a secret key', () => {
    expect(() => new SessionManager({ secretKey: '' })).toThrow();
  });

  it('creates a session and issues a token that validates to its id', () => {
    const { session, token, signals } = manager.processRequest({ ip: '1.2.3.4', path: '/' });
    expect(signals).toEqual([]);
    expect(session.requestCount).toBe(1);
    expect(manager.validateToken(token)).toBe(session.id);
  });

  it('rejects tampered tokens', () => {
    const { token } = manager.processRequest({ ip: '1.2.3.4', path: '/' });
    const [id] = token.split('.');
    expect(manager.validateToken(`${id}.deadbeef`)).toBeNull();
    expect(manager.validateToken('garbage')).toBeNull();
    const other = new SessionManager({ secretKey: 'other' });
    expect(other.validateToken(token)).toBeNull();
    other.destroy();
  });

  it('resumes the session for a valid token and tracks paths', () => {
    const first = manager.processRequest({ ip: '1.2.3.4', path: '/a' });
    const second = manager.processRequest({ sessionToken: first.token, ip: '1.2.3.4', path: '/b' });
    expect(second.session.id).toBe(first.session.id);
    expect(second.session.requestCount).toBe(2);
    expect([...second.session.uniquePaths]).toEqual(['/a', '/b']);
    expect(second.session.behavioralProfile.pathVariability).toBe(1);
  });

  it('flags an IP change and lowers reputation', () => {
    const first = manager.processRequest({ ip: '1.2.3.4', path: '/' });
    const second = manager.processRequest({ sessionToken: first.token, ip: '5.6.7.8', path: '/' });
    expect(second.signals.map(s => s.type)).toContain('session.ip_changed');
    expect(second.session.reputation).toBeLessThan(100);
  });

  it('flags a fingerprint change', () => {
    const first = manager.processRequest({ ip: '1.2.3.4', path: '/', deviceFingerprint: 'fp-a' });
    const second = manager.processRequest({ sessionToken: first.token, ip: '1.2.3.4', path: '/', deviceFingerprint: 'fp-b' });
    expect(second.signals.map(s => s.type)).toContain('session.fingerprint_changed');
  });

  it('flags a burst of 10+ requests within a second', () => {
    let token = manager.processRequest({ ip: '1.2.3.4', path: '/' }).token;
    let last = { signals: [] as { type: string }[] };
    for (let i = 0; i < 11; i++) {
      last = manager.processRequest({ sessionToken: token, ip: '1.2.3.4', path: `/p${i}` });
      token = (last as any).token;
    }
    expect(last.signals.map(s => s.type)).toContain('session.velocity_spike');
  });

  it('records verdict and risk history', () => {
    const { session } = manager.processRequest({ ip: '1.2.3.4', path: '/' });
    manager.addVerdict(session.id, 'challenge', 55);
    expect(session.verdictHistory).toEqual(['challenge']);
    expect(session.riskHistory).toEqual([55]);
  });
});

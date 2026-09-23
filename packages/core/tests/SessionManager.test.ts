import { SessionManager } from '../src/session/SessionManager';

describe('SessionManager', () => {
  let manager: SessionManager;
  const secret = 'test-session-secret';

  beforeEach(() => {
    manager = new SessionManager(secret);
  });

  it('should generate HMAC signed token', () => {
    const token = manager.createSession('user-1');
    expect(token).toBeDefined();
    expect(token.split('.').length).toBe(3); // JWT-like or signed payload
  });

  it('should validate valid token', () => {
    const token = manager.createSession('user-2');
    const isValid = manager.validateSession(token);
    expect(isValid).toBe(true);
  });

  it('should handle session expiry', () => {
    jest.useFakeTimers();
    const token = manager.createSession('user-3', { expiresIn: 1000 });
    
    expect(manager.validateSession(token)).toBe(true);
    
    jest.advanceTimersByTime(1001);
    
    expect(manager.validateSession(token)).toBe(false);
    jest.useRealTimers();
  });

  it('should detect anomalies (rapid behavior change)', () => {
    const token = manager.createSession('user-4');
    manager.logActivity(token, 'view_page');
    manager.logActivity(token, 'view_page');
    
    // Simulate sudden massive burst of different activity
    for(let i=0; i<50; i++) {
      manager.logActivity(token, 'submit_form');
    }
    
    const isAnomalous = manager.isAnomalous(token);
    expect(isAnomalous).toBe(true);
  });

  it('should cleanup expired sessions', () => {
    manager.createSession('user-5', { expiresIn: -1000 }); // already expired
    manager.cleanup();
    expect(manager.getActiveSessionsCount()).toBe(0);
  });
});

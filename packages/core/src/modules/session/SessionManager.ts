import { SessionInfo } from '../../types/index.js';

export class SessionManager {
  private sessions = new Map<string, SessionInfo>();

  public getOrCreateSession(id: string): SessionInfo {
    if (this.sessions.has(id)) {
      const s = this.sessions.get(id)!;
      s.requestCount++;
      return s;
    }
    const newSession = { id, createdAt: Date.now(), requestCount: 1 };
    this.sessions.set(id, newSession);
    return newSession;
  }
}

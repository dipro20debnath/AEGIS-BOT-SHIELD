/**
 * Holds the token issued by the AEGIS server. The browser never signs tokens
 * itself: it has no secret, so any client-made "signature" could be forged.
 */
export class TokenManager {
  private currentToken: string | null = null;
  private tokenExpiry = 0;

  /** Store a server token valid for `ttlMs`; it is refreshed `skewMs` before expiry. */
  public set(token: string, ttlMs: number, skewMs = 5_000): void {
    this.currentToken = token;
    this.tokenExpiry = Date.now() + Math.max(0, ttlMs - skewMs);
  }

  public get(): string | null {
    return this.currentToken && Date.now() < this.tokenExpiry ? this.currentToken : null;
  }

  public clear(): void {
    this.currentToken = null;
    this.tokenExpiry = 0;
  }
}

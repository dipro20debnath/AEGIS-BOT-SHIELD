export class TokenManager {
  private currentToken: string | null = null;
  private tokenExpiry: number = 0;
  private readonly TOKEN_LIFETIME = 5 * 60 * 1000; // 5 minutes

  public generateToken(payload: any): string {
    if (this.currentToken && Date.now() < this.tokenExpiry) {
      return this.currentToken;
    }

    try {
      const dataStr = JSON.stringify(payload);
      // Basic base64 encode for mock token representation
      const encoded = btoa(unescape(encodeURIComponent(dataStr)));
      
      // Add fake signature
      this.currentToken = `Aegis.${encoded}.SIG123`;
      this.tokenExpiry = Date.now() + this.TOKEN_LIFETIME;
      
      return this.currentToken;
    } catch (e) {
      console.error('Failed to generate token', e);
      return '';
    }
  }

  public clear(): void {
    this.currentToken = null;
    this.tokenExpiry = 0;
  }
}

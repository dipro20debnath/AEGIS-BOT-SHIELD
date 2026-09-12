import { TokenManager } from './TokenManager';

export class RequestInterceptor {
  private tokenManager: TokenManager;
  private originalFetch: typeof window.fetch;
  private originalXHR: typeof window.XMLHttpRequest.prototype.open;

  constructor(tokenManager: TokenManager) {
    this.tokenManager = tokenManager;
    this.originalFetch = window.fetch;
    this.originalXHR = window.XMLHttpRequest.prototype.open;
  }

  public enable() {
    this.interceptFetch();
    this.interceptXHR();
  }

  public disable() {
    window.fetch = this.originalFetch;
    window.XMLHttpRequest.prototype.open = this.originalXHR;
  }

  private interceptFetch() {
    window.fetch = async (...args) => {
      const token = this.tokenManager.getToken();
      if (token) {
        if (args[1]) {
          args[1].headers = { ...args[1].headers, 'X-Aegis-Token': token };
        } else {
          args[1] = { headers: { 'X-Aegis-Token': token } };
        }
      }
      return this.originalFetch(...args);
    };
  }

  private interceptXHR() {
    const self = this;
    window.XMLHttpRequest.prototype.open = function(this: XMLHttpRequest, ...args: any[]) {
      const token = self.tokenManager.getToken();
      if (token) {
        this.addEventListener('readystatechange', () => {
          if (this.readyState === 1) {
            this.setRequestHeader('X-Aegis-Token', token);
          }
        });
      }
      return self.originalXHR.apply(this, args as any);
    };
  }
}

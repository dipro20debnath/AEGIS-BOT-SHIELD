import { AegisClient } from '../AegisClient';

export class RequestInterceptor {
  private client: AegisClient;
  private extraHeaders: string[];
  private origFetch: typeof window.fetch | null = null;
  private origXhrOpen: typeof XMLHttpRequest.prototype.open | null = null;
  private enabled = false;

  constructor(client: AegisClient, extraHeaders: string[] = []) {
    this.client = client;
    this.extraHeaders = extraHeaders;
  }

  public enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.interceptFetch();
    this.interceptXhr();
  }

  public disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.origFetch) window.fetch = this.origFetch;
    if (this.origXhrOpen) XMLHttpRequest.prototype.open = this.origXhrOpen;
  }

  private interceptFetch(): void {
    this.origFetch = window.fetch;
    const self = this;
    window.fetch = async function(input: RequestInfo | URL, init?: RequestInit) {
      if (self.enabled) {
        try {
          const token = await self.client.getToken();
          const headers = new Headers(init?.headers);
          headers.set('X-Aegis-Token', token);
          self.extraHeaders.forEach(h => headers.set(h, 'true'));
          
          init = { ...init, headers };
        } catch (e) {
          console.error('Aegis fetch intercept error', e);
        }
      }
      return self.origFetch!.call(this, input, init);
    };
  }

  private interceptXhr(): void {
    this.origXhrOpen = XMLHttpRequest.prototype.open;
    const self = this;
    XMLHttpRequest.prototype.open = function(method: string, url: string | URL, async: boolean = true, user?: string | null, password?: string | null) {
      const xhr = this;
      const origSend = xhr.send;
      
      xhr.send = function(body?: Document | XMLHttpRequestBodyInit | null) {
        if (self.enabled) {
          self.client.getToken().then(token => {
            xhr.setRequestHeader('X-Aegis-Token', token);
            self.extraHeaders.forEach(h => xhr.setRequestHeader(h, 'true'));
            origSend.call(xhr, body);
          }).catch(() => {
            origSend.call(xhr, body);
          });
        } else {
          origSend.call(xhr, body);
        }
      };
      
      return self.origXhrOpen!.call(this, method, url, async, user, password);
    } as any;
  }
}

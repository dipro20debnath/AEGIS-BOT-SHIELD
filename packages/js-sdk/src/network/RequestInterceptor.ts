/**
 * Attaches the AEGIS token to the site's own fetch/XHR requests.
 *
 * Only same-origin requests (plus explicitly allowed origins) get the header:
 * sending it to third parties would leak the token and, being a custom header,
 * force a CORS preflight that breaks their APIs. Requests to the SDK's own
 * telemetry endpoint are never intercepted.
 */
export interface TokenSource {
  getToken(): Promise<string>;
}

export const TOKEN_HEADER = 'X-Aegis-Token';

export class RequestInterceptor {
  private origFetch: typeof window.fetch | null = null;
  private origXhrOpen: typeof XMLHttpRequest.prototype.open | null = null;
  private origXhrSend: typeof XMLHttpRequest.prototype.send | null = null;
  private enabled = false;

  constructor(
    private client: TokenSource,
    private options: { allowedOrigins?: string[]; excludeUrls?: string[]; extraHeaders?: string[] } = {},
  ) {}

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
    if (this.origXhrSend) XMLHttpRequest.prototype.send = this.origXhrSend;
  }

  /** Whether a request to `url` should carry the token. */
  public shouldAttach(url: string | URL): boolean {
    let target: URL;
    try {
      target = new URL(String(url), window.location.href);
    } catch {
      return false;
    }
    if ((this.options.excludeUrls ?? []).some(prefix => target.href.startsWith(new URL(prefix, window.location.href).href))) {
      return false;
    }
    return target.origin === window.location.origin
      || (this.options.allowedOrigins ?? []).includes(target.origin);
  }

  private headerValues(token: string): Array<[string, string]> {
    return [[TOKEN_HEADER, token], ...(this.options.extraHeaders ?? []).map(h => [h, 'true'] as [string, string])];
  }

  private interceptFetch(): void {
    const origFetch = window.fetch;
    this.origFetch = origFetch;
    const self = this;
    window.fetch = async function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      const url = input instanceof Request ? input.url : input;
      if (self.enabled && self.shouldAttach(url)) {
        try {
          const token = await self.client.getToken();
          if (!token) return origFetch.call(window, input, init);
          const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
          for (const [name, value] of self.headerValues(token)) headers.set(name, value);
          init = { ...init, headers };
        } catch (e) {
          console.error('Aegis fetch intercept error', e);
        }
      }
      return origFetch.call(window, input, init);
    };
  }

  private interceptXhr(): void {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    this.origXhrOpen = origOpen;
    this.origXhrSend = origSend;
    const self = this;
    const meta = new WeakMap<XMLHttpRequest, { url: string | URL; async: boolean }>();

    XMLHttpRequest.prototype.open = function (
      this: XMLHttpRequest, method: string, url: string | URL,
      async: boolean = true, user?: string | null, password?: string | null,
    ) {
      meta.set(this, { url, async });
      return origOpen.call(this, method, url, async, user, password);
    } as typeof XMLHttpRequest.prototype.open;

    XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      const info = meta.get(this);
      // Synchronous XHR cannot wait for a token, so it is sent unchanged
      if (!self.enabled || !info || !info.async || !self.shouldAttach(info.url)) {
        return origSend.call(this, body);
      }
      self.client.getToken()
        .then(token => {
          if (!token) return;
          for (const [name, value] of self.headerValues(token)) this.setRequestHeader(name, value);
        })
        .catch(() => { /* send without token; the server decides */ })
        .finally(() => origSend.call(this, body));
    };
  }
}

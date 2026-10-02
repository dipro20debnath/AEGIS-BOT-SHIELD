import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestInterceptor, TOKEN_HEADER } from '../src/network/RequestInterceptor';
import { TokenManager } from '../src/network/TokenManager';
import { AegisClient } from '../src/AegisClient';

describe('RequestInterceptor', () => {
  const origin = window.location.origin;
  let fetchMock: ReturnType<typeof vi.fn>;
  let interceptor: RequestInterceptor;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response('ok'));
    window.fetch = fetchMock as unknown as typeof fetch;
    interceptor = new RequestInterceptor({ getToken: async () => 'tok-123' }, {
      allowedOrigins: ['https://api.partner.example'],
      excludeUrls: [`${origin}/aegis/telemetry`],
    });
  });
  afterEach(() => interceptor.disable());

  it('attaches only to same-origin and allowed origins', () => {
    expect(interceptor.shouldAttach('/api/cart')).toBe(true);
    expect(interceptor.shouldAttach(`${origin}/x`)).toBe(true);
    expect(interceptor.shouldAttach('https://api.partner.example/v1')).toBe(true);
    expect(interceptor.shouldAttach('https://www.google-analytics.com/collect')).toBe(false);
    expect(interceptor.shouldAttach(`${origin}/aegis/telemetry`)).toBe(false);
  });

  it('adds the token header to same-origin fetches only', async () => {
    interceptor.enable();
    await window.fetch('/api/cart', { headers: { Accept: 'application/json' } });
    await window.fetch('https://cdn.thirdparty.example/lib.js');
    const [, sameInit] = fetchMock.mock.calls[0];
    const headers = new Headers(sameInit.headers);
    expect(headers.get(TOKEN_HEADER)).toBe('tok-123');
    expect(headers.get('Accept')).toBe('application/json');
    const [, thirdInit] = fetchMock.mock.calls[1];
    expect(thirdInit).toBeUndefined();
  });

  it('keeps headers of a Request object', async () => {
    interceptor.enable();
    await window.fetch(new Request(`${origin}/api`, { headers: { 'X-Custom': '1' } }));
    const headers = new Headers(fetchMock.mock.calls[0][1].headers);
    expect(headers.get('X-Custom')).toBe('1');
    expect(headers.get(TOKEN_HEADER)).toBe('tok-123');
  });

  it('restores the original fetch when disabled', () => {
    interceptor.enable();
    interceptor.disable();
    expect(window.fetch).toBe(fetchMock);
  });
});

describe('TokenManager', () => {
  it('expires tokens before their server lifetime ends', () => {
    vi.useFakeTimers();
    const tm = new TokenManager();
    tm.set('t', 60_000);
    expect(tm.get()).toBe('t');
    vi.advanceTimersByTime(56_000);
    expect(tm.get()).toBeNull();
    vi.useRealTimers();
  });
});

describe('AegisClient', () => {
  it('submits telemetry to the server and caches the returned token', async () => {
    const calls: Array<[string, RequestInit]> = [];
    window.fetch = vi.fn(async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return new Response(JSON.stringify({ token: 'server-token', expiresIn: 300, verdict: 'allow', score: 12 }));
    }) as unknown as typeof fetch;

    const client = new AegisClient({ siteKey: 'site-1', autoStart: false, autoIntercept: false, detectHeadless: false, fingerprint: false });
    expect(await client.getToken()).toBe('server-token');
    expect(await client.getToken()).toBe('server-token');
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(`${window.location.origin}/aegis/telemetry`);
    const body = JSON.parse(calls[0][1].body as string);
    expect(body.siteKey).toBe('site-1');
    expect(Object.keys(body.features.mouse)).toHaveLength(15);
    expect(client.getLastResponse()?.verdict).toBe('allow');
    client.stop();
  });

  it('fails open with an empty token when the server is down', async () => {
    window.fetch = vi.fn(async () => new Response('down', { status: 503 })) as unknown as typeof fetch;
    const client = new AegisClient({ siteKey: 's', autoStart: false, autoIntercept: false, detectHeadless: false, fingerprint: false });
    const errors: unknown[] = [];
    client.on('error', e => errors.push(e));
    expect(await client.getToken()).toBe('');
    expect(errors).toHaveLength(1);
    client.stop();
  });

  it('does not let an undefined endpoint override the default', () => {
    const client = new AegisClient({ siteKey: 's', endpoint: undefined, autoStart: false });
    expect(client.telemetryUrl()).toBe(`${window.location.origin}/aegis/telemetry`);
  });
});

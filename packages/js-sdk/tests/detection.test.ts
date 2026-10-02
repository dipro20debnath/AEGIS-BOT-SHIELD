import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BrowserEnvironment, evaluateAntiDetect, findOverriddenProperties, gpuVendorFamily, intlOffsetMinutes,
  osFromPlatform, osFromUserAgent,
} from '../src/detection/AntiDetectDetector';
import { WebGPUFingerprinter } from '../src/fingerprint/WebGPUFingerprinter';
import { RequestInterceptor, TOKEN_HEADER } from '../src/network/RequestInterceptor';
import { buildTelemetry } from '../src/telemetry';

const WIN_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';

/** A consistent real-world Windows/Chrome/NVIDIA desktop in Dhaka. */
const REAL_WINDOWS: BrowserEnvironment = {
  userAgent: WIN_CHROME,
  platform: 'Win32',
  uaData: { platform: 'Windows', mobile: false, brands: [{ brand: 'Google Chrome', version: '129' }, { brand: 'Chromium', version: '129' }] },
  language: 'en-US', languages: ['en-US', 'bn'],
  webglVendor: 'Google Inc. (NVIDIA)',
  webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  webgpu: { supported: true, vendor: 'nvidia', architecture: 'ampere', features: [], limits: {}, isFallbackAdapter: false },
  timeZone: 'Asia/Dhaka', dateOffsetMinutes: -360, intlOffsetMinutes: -360,
  screen: { width: 1920, height: 1080, availWidth: 1920, availHeight: 1040 },
  outerWidth: 1920, outerHeight: 1040,
  overriddenProperties: [],
};

const detected = (env: BrowserEnvironment) => evaluateAntiDetect(env).checks.filter(c => c.detected).map(c => c.name);

describe('AntiDetectDetector', () => {
  it('passes consistent real devices (Windows desktop, Mac Safari, Android phone)', () => {
    expect(detected(REAL_WINDOWS)).toEqual([]);
    expect(evaluateAntiDetect(REAL_WINDOWS)).toMatchObject({ score: 0, suspected: false });
    expect(detected({
      userAgent: MAC_SAFARI, platform: 'MacIntel', language: 'en-GB', languages: ['en-GB'],
      webglVendor: 'Apple Inc.', webglRenderer: 'Apple GPU', timeZone: 'Europe/London',
      dateOffsetMinutes: -60, intlOffsetMinutes: -60,
      screen: { width: 1512, height: 982, availWidth: 1512, availHeight: 944 }, outerWidth: 1512, outerHeight: 944,
    })).toEqual([]);
    expect(detected({
      userAgent: ANDROID, platform: 'Linux armv8l',
      uaData: { platform: 'Android', mobile: true, brands: [{ brand: 'Chromium', version: '129' }] },
      webglRenderer: 'Adreno (TM) 740', language: 'bn-BD', languages: ['bn-BD', 'en'],
    })).toEqual([]);
  });

  it('allows a hybrid-GPU laptop (WebGL on Intel, WebGPU on NVIDIA)', () => {
    expect(detected({
      ...REAL_WINDOWS,
      webglVendor: 'Google Inc. (Intel)', webglRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    })).toEqual([]);
  });

  it('flags a Windows profile running on a Mac (typical anti-detect leak)', () => {
    const env: BrowserEnvironment = {
      ...REAL_WINDOWS,
      platform: 'MacIntel',
      uaData: { platform: 'macOS', mobile: false, brands: [{ brand: 'Chromium', version: '127' }] },
      webglRenderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)',
      webgpu: { ...REAL_WINDOWS.webgpu!, vendor: 'apple', architecture: 'metal-3' },
    };
    expect(detected(env)).toEqual(expect.arrayContaining(['uaPlatformMismatch', 'clientHintsMismatch', 'gpuOsMismatch']));
    expect(evaluateAntiDetect(env).suspected).toBe(true);
  });

  it('flags a spoofed WebGL vendor that WebGPU contradicts', () => {
    expect(detected({ ...REAL_WINDOWS, webgpu: { ...REAL_WINDOWS.webgpu!, vendor: 'apple' } })).toEqual(['webglWebgpuMismatch']);
    // AMD iGPU + NVIDIA dGPU (Ryzen laptops) is a real combination, not a spoof
    expect(detected({ ...REAL_WINDOWS, webgpu: { ...REAL_WINDOWS.webgpu!, vendor: 'amd' } })).toEqual([]);
  });

  it('flags a timezone patched in only one API, language mismatch, impossible screens and redefined properties', () => {
    expect(detected({ ...REAL_WINDOWS, timeZone: 'America/New_York', intlOffsetMinutes: 240 })).toEqual(['timezoneMismatch']);
    expect(detected({ ...REAL_WINDOWS, language: 'en-US', languages: ['ru-RU', 'en'] })).toEqual(['languageMismatch']);
    expect(detected({ ...REAL_WINDOWS, screen: { width: 1366, height: 768, availWidth: 1366, availHeight: 728 } })).toEqual(['screenInconsistent']);
    const stealth = evaluateAntiDetect({ ...REAL_WINDOWS, overriddenProperties: ['webdriver', 'plugins'] });
    expect(stealth.checks.find(c => c.name === 'nativeOverride')).toMatchObject({ detected: true, details: 'redefined: webdriver, plugins' });
    expect(stealth.suspected).toBe(true);
  });

  it('parses OS and GPU families', () => {
    expect([osFromUserAgent(WIN_CHROME), osFromUserAgent(MAC_SAFARI), osFromUserAgent(ANDROID)]).toEqual(['windows', 'mac', 'android']);
    expect([osFromPlatform('Win32'), osFromPlatform('Linux x86_64'), osFromPlatform('iPhone')]).toEqual(['windows', 'linux', 'ios']);
    expect([gpuVendorFamily('ANGLE (AMD, Radeon RX 6600)'), gpuVendorFamily('Mali-G78'), gpuVendorFamily('llvmpipe')]).toEqual(['amd', 'arm', '']);
  });

  it('computes timezone offsets through Intl like Date does', () => {
    const at = new Date('2026-07-01T12:00:00Z');
    expect(intlOffsetMinutes('Asia/Dhaka', at)).toBe(-360);
    expect(intlOffsetMinutes('America/New_York', at)).toBe(240); // EDT
    expect(intlOffsetMinutes('UTC', at)).toBe(0);
    expect(intlOffsetMinutes('Not/AZone', at)).toBeUndefined();
  });

  it('finds navigator properties redefined by script', () => {
    // A native getter (as browsers have) on the prototype, standing in for Navigator.prototype
    const nativeGetter = Object.getOwnPropertyDescriptor(Map.prototype, 'size')!.get!;
    const proto = {};
    for (const prop of ['userAgent', 'platform', 'languages']) Object.defineProperty(proto, prop, { get: nativeGetter });
    Object.defineProperty(proto, 'hardwareConcurrency', { get: () => 8 }); // patched on the prototype
    const fakeNav = Object.create(proto);
    Object.defineProperty(fakeNav, 'webdriver', { get: () => false }); // patched on the instance (stealth plugins)
    expect(findOverriddenProperties(fakeNav).sort()).toEqual(['hardwareConcurrency', 'webdriver']);
  });

  it('is reported in telemetry outside the ML feature contract', () => {
    const payload = buildTelemetry({ device: { hasWebGL: true, hasCanvas: true, pluginCount: 5 },
      antiDetect: evaluateAntiDetect({ ...REAL_WINDOWS, language: 'en', languages: ['ru'] }) }, { siteKey: 's', streamId: 'x', now: 1 });
    expect(payload.antiDetect).toEqual({ score: 0.6, checks: ['languageMismatch'] });
    expect(Object.keys(payload.features.fingerprint)).toEqual(['has_webgl', 'has_canvas', 'plugin_count', 'is_headless', 'headless_confidence']);
  });
});

describe('WebGPUFingerprinter', () => {
  it('reports unsupported without navigator.gpu or without an adapter', async () => {
    const fp = new WebGPUFingerprinter();
    expect((await fp.collect(undefined)).supported).toBe(false);
    expect((await fp.collect({ requestAdapter: async () => null })).supported).toBe(false);
  });

  it('reads adapter info, features and limits', async () => {
    const adapter = {
      info: { vendor: 'NVIDIA', architecture: 'Ampere' },
      features: new Set(['texture-compression-bc', 'shader-f16']),
      limits: { maxTextureDimension2D: 16384, maxBindGroups: 4, unrelated: 1 },
    };
    expect(await new WebGPUFingerprinter().collect({ requestAdapter: async () => adapter })).toEqual({
      supported: true, vendor: 'nvidia', architecture: 'ampere', features: ['shader-f16', 'texture-compression-bc'],
      limits: { maxTextureDimension2D: 16384, maxBindGroups: 4 }, isFallbackAdapter: false,
    });
  });

  it('does not hang on a driver that never answers', async () => {
    const result = await new WebGPUFingerprinter(50).collect({ requestAdapter: () => new Promise(() => {}) });
    expect(result.supported).toBe(false);
  });
});

describe('RequestInterceptor challenge retry', () => {
  let interceptor: RequestInterceptor;
  afterEach(() => interceptor.disable());

  it('solves the challenge and retries once with the new token', async () => {
    let token = 'old';
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Headers(init?.headers).get(TOKEN_HEADER) === 'old'
        ? new Response('{}', { status: 403, headers: { 'X-Aegis-Action': 'challenge' } })
        : new Response('ok'));
    window.fetch = fetchMock as unknown as typeof fetch;
    const handleChallenge = vi.fn(async () => { token = 'pow'; return true; });
    interceptor = new RequestInterceptor({ getToken: async () => token, handleChallenge });
    interceptor.enable();
    const res = await window.fetch('/api/login', { method: 'POST', body: '{"u":"a"}' });
    expect(await res.text()).toBe('ok');
    expect(handleChallenge).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]?.body).toBe('{"u":"a"}');
  });

  it('returns the 403 unchanged for blocks, failed challenges and stream bodies', async () => {
    const blocked = vi.fn(async () => new Response('{}', { status: 403, headers: { 'X-Aegis-Action': 'block' } }));
    window.fetch = blocked as unknown as typeof fetch;
    const handleChallenge = vi.fn(async () => true);
    interceptor = new RequestInterceptor({ getToken: async () => 't', handleChallenge });
    interceptor.enable();
    expect((await window.fetch('/api/x')).status).toBe(403);
    expect(handleChallenge).not.toHaveBeenCalled();
    interceptor.disable();

    const challenged = vi.fn(async () => new Response('{}', { status: 403, headers: { 'X-Aegis-Action': 'challenge' } }));
    window.fetch = challenged as unknown as typeof fetch;
    interceptor = new RequestInterceptor({ getToken: async () => 't', handleChallenge: async () => false });
    interceptor.enable();
    expect((await window.fetch('/api/x')).status).toBe(403);
    expect(challenged).toHaveBeenCalledTimes(1);
  });
});

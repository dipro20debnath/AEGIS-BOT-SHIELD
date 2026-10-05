import { AegisClientConfig, ChallengeRequest, ChallengeResponse, HeadlessDetectionResult, TelemetryResponse } from './types';
import { HeadlessDetector } from './detection/HeadlessDetector';
import { ChallengeManager } from './challenges/ChallengeManager';
import { TokenManager } from './network/TokenManager';
import { RequestInterceptor } from './network/RequestInterceptor';
import { MouseCollector } from './collectors/MouseCollector';
import { KeyboardCollector } from './collectors/KeyboardCollector';
import { ScrollCollector } from './collectors/ScrollCollector';
import { TouchCollector } from './collectors/TouchCollector';
import { DeviceFingerprinter } from './fingerprint/DeviceFingerprinter';
import { buildTelemetry, DeviceSignals, TelemetryPayload } from './telemetry';
import { AntiDetectDetector, AntiDetectResult } from './detection/AntiDetectDetector';
import { WebGPUFingerprinter } from './fingerprint/WebGPUFingerprinter';
import { MemoryHardChallenge, solveMemoryHard } from './challenges/MemoryHardChallenge';

type Handler = (data?: unknown) => void;

/**
 * Browser client: collects behavioural telemetry, sends it to the AEGIS
 * server, and attaches the server-issued token to the site's own requests.
 */
export class AegisClient {
  private config: Required<Pick<AegisClientConfig, 'siteKey' | 'endpoint' | 'telemetryPath' | 'challengePath'>> & AegisClientConfig;
  private headlessDetector = new HeadlessDetector();
  private challengeManager = new ChallengeManager();
  private tokenManager = new TokenManager();
  private requestInterceptor: RequestInterceptor;
  private mouse = new MouseCollector();
  private keyboard = new KeyboardCollector();
  private scroll = new ScrollCollector();
  private touch = new TouchCollector();
  private initialized = false;
  private eventHandlers: Map<string, Handler[]> = new Map();
  private detectionResult: HeadlessDetectionResult | null = null;
  private antiDetectResult: AntiDetectResult | null = null;
  private challengeInFlight: Promise<boolean> | null = null;
  private device: DeviceSignals = { hasWebGL: false, hasCanvas: false, pluginCount: 0 };
  private streamId: string;
  private inFlight: Promise<string> | null = null;
  private lastResponse: TelemetryResponse | null = null;
  /** fetch as it was before the interceptor wrapped it */
  private nativeFetch: typeof fetch;
  private onPageHide = () => this.sendBeacon();

  constructor(config: AegisClientConfig) {
    this.config = {
      autoStart: true,
      autoIntercept: true,
      collectMouse: true,
      collectKeyboard: true,
      collectScroll: true,
      collectTouch: true,
      fingerprint: true,
      detectHeadless: true,
      detectAntiDetect: true,
      autoChallenge: true,
      beaconOnExit: false,
      ...config,
      // explicit undefined in config must not override these defaults
      endpoint: config.endpoint ?? window.location.origin,
      telemetryPath: config.telemetryPath ?? '/aegis/telemetry',
      challengePath: config.challengePath ?? '/aegis/challenge',
    };
    this.streamId = config.streamId || randomId();
    this.nativeFetch = window.fetch.bind(window);
    this.requestInterceptor = new RequestInterceptor(this, {
      allowedOrigins: this.config.allowedOrigins,
      excludeUrls: [this.telemetryUrl(), this.challengeUrl()],
      extraHeaders: this.config.interceptHeaders,
    });
    if (this.config.autoStart) {
      void this.start();
    }
  }

  public telemetryUrl(): string {
    return new URL(this.config.telemetryPath, this.config.endpoint).href;
  }

  public challengeUrl(): string {
    return new URL(this.config.challengePath, this.config.endpoint).href;
  }

  public async start(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    try {
      if (this.config.collectMouse) this.mouse.start();
      if (this.config.collectKeyboard) this.keyboard.start();
      if (this.config.collectScroll) this.scroll.start();
      if (this.config.collectTouch) this.touch.start();
      if (this.config.autoIntercept) this.requestInterceptor.enable();
      if (this.config.beaconOnExit) window.addEventListener('pagehide', this.onPageHide);

      const [headless, device, antiDetect] = await Promise.all([
        this.config.detectHeadless ? this.headlessDetector.detect() : Promise.resolve(null),
        this.config.fingerprint ? collectDeviceSignals() : Promise.resolve(this.device),
        this.config.detectAntiDetect ? detectAntiDetect() : Promise.resolve(null),
      ]);
      this.detectionResult = headless;
      this.device = device;
      this.antiDetectResult = antiDetect;
      this.emit('ready', { success: true });
    } catch (e) {
      this.emit('error', e);
    }
  }

  public stop(): void {
    if (!this.initialized) return;
    this.mouse.stop();
    this.keyboard.stop();
    this.scroll.stop();
    this.touch.stop();
    this.requestInterceptor.disable();
    window.removeEventListener('pagehide', this.onPageHide);
    this.initialized = false;
    this.emit('stopped');
  }

  /** Current telemetry snapshot (also useful for debugging and research logging). */
  public collect(): TelemetryPayload {
    return buildTelemetry({
      mouse: this.mouse.getData(),
      keyboard: this.keyboard.getData(),
      scroll: this.scroll.getData(),
      touch: this.touch.getData(),
      headless: this.detectionResult,
      antiDetect: this.antiDetectResult,
      device: this.device,
    }, { siteKey: this.config.siteKey, streamId: this.streamId });
  }

  /** Send telemetry now and store the token the server returns. */
  public async submit(): Promise<TelemetryResponse> {
    const response = await this.nativeFetch(this.telemetryUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(this.collect()),
    });
    if (!response.ok) {
      throw new Error(`AEGIS telemetry rejected: HTTP ${response.status}`);
    }
    const result = await response.json() as TelemetryResponse;
    this.tokenManager.set(result.token, result.expiresIn * 1000);
    this.lastResponse = result;
    this.emit('token', result);
    return result;
  }

  /**
   * A valid server token, submitting fresh telemetry when needed.
   * Resolves to '' if the server is unreachable (the server then decides).
   */
  public async getToken(): Promise<string> {
    if (!this.initialized) await this.start();
    const cached = this.tokenManager.get();
    if (cached) return cached;
    if (!this.inFlight) {
      this.inFlight = this.submit()
        .then(r => r.token)
        .catch(e => { this.emit('error', e); return ''; })
        .finally(() => { this.inFlight = null; });
    }
    return this.inFlight;
  }

  public getLastResponse(): TelemetryResponse | null {
    return this.lastResponse;
  }

  /** Best-effort final report when the page is being unloaded. */
  public sendBeacon(): boolean {
    if (!navigator.sendBeacon) return false;
    const blob = new Blob([JSON.stringify(this.collect())], { type: 'application/json' });
    return navigator.sendBeacon(this.telemetryUrl(), blob);
  }

  /**
   * Fetch a memory-hard challenge from the server, solve it (WebAssembly
   * scrypt) and store the token the server returns. Concurrent calls share one solve.
   */
  public passChallenge(): Promise<boolean> {
    this.challengeInFlight ??= (async () => {
      const issued = await this.nativeFetch(this.challengeUrl(), { credentials: 'include' });
      if (!issued.ok) throw new Error(`AEGIS challenge unavailable: HTTP ${issued.status}`);
      const challenge = await issued.json() as MemoryHardChallenge;
      const solution = await solveMemoryHard(challenge);
      const verified = await this.nativeFetch(this.challengeUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ challenge: challenge.challenge, nonce: solution.nonce }),
      });
      if (!verified.ok) return false;
      const result = await verified.json() as TelemetryResponse;
      this.tokenManager.set(result.token, result.expiresIn * 1000);
      this.emit('challenge', solution);
      return true;
    })()
      .catch(e => { this.emit('error', e); return false; })
      .finally(() => { this.challengeInFlight = null; });
    return this.challengeInFlight;
  }

  /** Called by the request interceptor after a 403 "challenge" response. */
  public handleChallenge(): Promise<boolean> {
    return this.config.autoChallenge ? this.passChallenge() : Promise.resolve(false);
  }

  public getAntiDetectResult(): AntiDetectResult | null {
    return this.antiDetectResult;
  }

  public async solveChallenge(challenge: ChallengeRequest): Promise<ChallengeResponse> {
    return this.challengeManager.solve(challenge);
  }

  public reset(): void {
    this.detectionResult = null;
    this.tokenManager.clear();
    this.mouse.reset();
    this.keyboard.reset();
    this.scroll.reset();
    this.touch.reset();
    this.streamId = randomId();
  }

  public on(event: string, handler: Handler): void {
    const handlers = this.eventHandlers.get(event) ?? [];
    handlers.push(handler);
    this.eventHandlers.set(event, handlers);
  }

  public off(event: string, handler: Handler): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      this.eventHandlers.set(event, handlers.filter(h => h !== handler));
    }
  }

  private emit(event: string, data?: unknown): void {
    for (const handler of this.eventHandlers.get(event) ?? []) {
      try {
        handler(data);
      } catch (e) {
        console.error(`Error in Aegis event handler for ${event}`, e);
      }
    }
    if (this.config.debug && event !== 'token') console.debug('[aegis]', event, data);
  }
}

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

async function detectAntiDetect(): Promise<AntiDetectResult | null> {
  try {
    const webgpu = await new WebGPUFingerprinter().collect();
    return new AntiDetectDetector().detect(webgpu);
  } catch {
    return null;
  }
}

async function collectDeviceSignals(): Promise<DeviceSignals> {
  const canvas = document.createElement('canvas');
  const hasCanvas = !!canvas.getContext('2d');
  const hasWebGL = !!(document.createElement('canvas').getContext('webgl')
    || document.createElement('canvas').getContext('experimental-webgl'));
  const pluginCount = navigator.plugins?.length ?? 0;

  let fingerprintHash: string | undefined;
  try {
    const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), 2000));
    const fp = await Promise.race([new DeviceFingerprinter().collect(), timeout]);
    fingerprintHash = fp?.visitorId;
  } catch {
    fingerprintHash = undefined;
  }
  return { hasWebGL, hasCanvas, pluginCount, fingerprintHash };
}

import { AegisClientConfig, HeadlessDetectionResult } from './types';
import { HeadlessDetector } from './detection/HeadlessDetector';
import { ChallengeManager } from './challenges/ChallengeManager';
import { TokenManager } from './network/TokenManager';
import { RequestInterceptor } from './network/RequestInterceptor';

export class AegisClient {
  private config: AegisClientConfig;
  private headlessDetector: HeadlessDetector;
  private challengeManager: ChallengeManager;
  private tokenManager: TokenManager;
  private requestInterceptor: RequestInterceptor;
  private initialized = false;
  private eventHandlers: Map<string, Function[]> = new Map();
  private detectionResult: HeadlessDetectionResult | null = null;

  constructor(config: AegisClientConfig) {
    this.config = {
      autoStart: true,
      autoIntercept: true,
      ...config
    };
    
    this.headlessDetector = new HeadlessDetector();
    this.challengeManager = new ChallengeManager();
    this.tokenManager = new TokenManager();
    this.requestInterceptor = new RequestInterceptor(this, this.config.interceptHeaders || []);
  }

  public async start(): Promise<void> {
    if (this.initialized) return;
    try {
      this.detectionResult = await this.headlessDetector.detect();
      if (this.config.autoIntercept) {
        this.requestInterceptor.enable();
      }
      this.initialized = true;
      this.emit('ready', { success: true });
    } catch (e) {
      this.emit('error', e);
    }
  }

  public stop(): void {
    if (!this.initialized) return;
    if (this.config.autoIntercept) {
      this.requestInterceptor.disable();
    }
    this.initialized = false;
    this.emit('stopped');
  }

  public async getToken(): Promise<string> {
    if (!this.initialized) await this.start();
    
    const payload = {
      timestamp: Date.now(),
      detection: this.detectionResult,
      siteKey: this.config.siteKey
    };
    
    return this.tokenManager.generateToken(payload);
  }

  public async solveChallenge(challenge: any): Promise<any> {
    return this.challengeManager.solve(challenge);
  }

  public reset(): void {
    this.detectionResult = null;
    this.tokenManager.clear();
  }

  public on(event: string, handler: Function): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler);
  }

  public off(event: string, handler: Function): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      this.eventHandlers.set(event, handlers.filter(h => h !== handler));
    }
  }

  private emit(event: string, data?: any): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach(h => {
        try {
          h(data);
        } catch (e) {
          console.error(`Error in Aegis event handler for ${event}`, e);
        }
      });
    }
  }
}

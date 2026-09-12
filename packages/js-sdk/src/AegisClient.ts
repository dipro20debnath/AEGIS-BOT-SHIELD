import { AegisClientConfig } from './types';
import { MouseCollector } from './collectors/MouseCollector';
import { KeyboardCollector } from './collectors/KeyboardCollector';
import { ScrollCollector } from './collectors/ScrollCollector';
import { TouchCollector } from './collectors/TouchCollector';
import { DeviceFingerprinter } from './fingerprint/DeviceFingerprinter';
import { HeadlessDetector } from './detection/HeadlessDetector';
import { TokenManager } from './transport/TokenManager';
import { RequestInterceptor } from './transport/RequestInterceptor';

export class AegisClient {
  private config: AegisClientConfig;
  private mouseCollector: MouseCollector;
  private keyboardCollector: KeyboardCollector;
  private scrollCollector: ScrollCollector;
  private touchCollector: TouchCollector;
  private tokenManager: TokenManager;
  private requestInterceptor: RequestInterceptor;

  constructor(config: AegisClientConfig) {
    this.config = config;
    this.mouseCollector = new MouseCollector();
    this.keyboardCollector = new KeyboardCollector();
    this.scrollCollector = new ScrollCollector();
    this.touchCollector = new TouchCollector();
    this.tokenManager = new TokenManager();
    this.requestInterceptor = new RequestInterceptor(this.tokenManager);
  }

  public async init() {
    if (this.config.collectors?.mouse !== false) this.mouseCollector.start();
    if (this.config.collectors?.keyboard !== false) this.keyboardCollector.start();
    if (this.config.collectors?.scroll !== false) this.scrollCollector.start();
    if (this.config.collectors?.touch !== false) this.touchCollector.start();
    
    if (this.config.autoIntercept !== false) {
      this.requestInterceptor.enable();
    }
  }

  public async protect() {
    const isHeadless = new HeadlessDetector().detect();
    let fingerprint = '';
    if (this.config.fingerprinting !== false) {
      fingerprint = await new DeviceFingerprinter().getFingerprint();
    }

    const payload = {
      isHeadless,
      fingerprint,
      mouse: this.mouseCollector.getData(),
      keyboard: this.keyboardCollector.getData(),
      scroll: this.scrollCollector.getData(),
      touch: this.touchCollector.getData(),
      timestamp: Date.now()
    };

    return this.tokenManager.generateToken(payload);
  }
}

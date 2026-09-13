import { DetectionSignal, HTTP2Info } from '../../types/index.js';
import { Logger } from '../../utils/logger.js';

export class HTTP2Fingerprinter {
  private logger: Logger;
  private knownProfiles: Map<string, { name: string; severity: number }>;

  constructor() {
    this.logger = new Logger('HTTP2Fingerprinter');
    this.knownProfiles = this.buildKnownProfiles();
  }

  public analyze(http2: HTTP2Info, userAgent: string): DetectionSignal[] {
    const signals: DetectionSignal[] = [];

    const fingerprintHash = this.hashSettings(http2.settings);
    const profile = this.knownProfiles.get(fingerprintHash);

    if (profile) {
      signals.push({
        category: 'protocol',
        type: 'http2.fingerprint_match',
        value: profile.severity,
        confidence: 0.95,
        description: `HTTP/2 Settings match known profile: ${profile.name}`,
        weight: 1.4,
      });
    }

    const consistency = this.checkSettingsUaConsistency(http2, userAgent);
    if (consistency) signals.push(consistency);

    const pseudoOrder = this.analyzePseudoHeaderOrder(http2.pseudoHeaders);
    if (pseudoOrder) signals.push(pseudoOrder);

    return signals;
  }

  private buildKnownProfiles(): Map<string, { name: string; severity: number }> {
    const profiles = new Map();
    // Simplified hashes mapping to known agents
    // e.g., '65536:1:1000:6291456:16384:262144'
    profiles.set('65536:1:1000:6291456:16384:262144', { name: 'Chrome', severity: 0 });
    profiles.set('65536:1:100:131072:16384:262144', { name: 'Firefox', severity: 0 });
    profiles.set('4096:1:100:65535:16384:262144', { name: 'curl/default', severity: 70 });
    return profiles;
  }

  private hashSettings(settings: Record<string, number>): string {
    if (!settings) return '';
    return [
      settings.HEADER_TABLE_SIZE || 4096,
      settings.ENABLE_PUSH !== undefined ? settings.ENABLE_PUSH : 1,
      settings.MAX_CONCURRENT_STREAMS || 100,
      settings.INITIAL_WINDOW_SIZE || 65535,
      settings.MAX_FRAME_SIZE || 16384,
      settings.MAX_HEADER_LIST_SIZE || 262144
    ].join(':');
  }

  private checkSettingsUaConsistency(http2: HTTP2Info, ua: string): DetectionSignal | null {
    const isChrome = ua.includes('Chrome');
    const hash = this.hashSettings(http2.settings);

    // If UA claims Chrome but Settings match curl/defaults
    if (isChrome && hash === '4096:1:100:65535:16384:262144') {
      return {
        category: 'protocol',
        type: 'http2.ua_inconsistency',
        value: 85,
        confidence: 0.9,
        description: 'HTTP/2 settings do not match claimed Chrome User-Agent',
        weight: 1.6,
      };
    }
    return null;
  }

  private analyzePseudoHeaderOrder(headers: string[]): DetectionSignal | null {
    if (!headers || headers.length === 0) return null;
    
    // Chrome uses :method, :authority, :scheme, :path
    const chromeOrder = [':method', ':authority', ':scheme', ':path'];
    let isStandardChrome = true;
    for (let i = 0; i < chromeOrder.length; i++) {
      if (headers[i] !== chromeOrder[i]) {
        isStandardChrome = false;
        break;
      }
    }

    if (!isStandardChrome) {
      return {
        category: 'protocol',
        type: 'http2.pseudo_header_anomaly',
        value: 50,
        confidence: 0.7,
        description: 'Non-standard HTTP/2 pseudo-header ordering detected',
        weight: 1.0,
      };
    }

    return null;
  }
}

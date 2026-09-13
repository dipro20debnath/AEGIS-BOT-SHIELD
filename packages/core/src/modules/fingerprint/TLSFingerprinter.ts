import { DetectionSignal, TLSInfo } from '../../types/index.js';
import { Logger } from '../../utils/logger.js';

interface TLSSignature {
  hash: string;
  name: string;
  severity: number;
  category: 'automation' | 'scanner' | 'library' | 'legitimate';
}

export class TLSFingerprinter {
  private signatures: Map<string, TLSSignature> = new Map();
  private logger: Logger;
  private recentFingerprints: Map<string, { count: number; lastSeen: number; ips: Set<string> }> = new Map();

  private metrics = {
    totalLookups: 0,
    matches: 0,
    uniqueSeen: 0,
  };

  constructor() {
    this.logger = new Logger('TLSFingerprinter');
    this.loadSignatures();
    // Periodically clean up tracked frequencies
    setInterval(() => this.cleanup(), 60000);
  }

  public analyze(tls: TLSInfo, userAgent: string, ip: string): DetectionSignal[] {
    const signals: DetectionSignal[] = [];
    this.metrics.totalLookups++;

    if (tls.ja3) {
      const match = this.signatures.get(tls.ja3);
      if (match) {
        this.metrics.matches++;
        signals.push({
          category: 'protocol',
          type: 'tls.ja3_match',
          value: match.severity,
          confidence: 0.95,
          description: `JA3 matches known ${match.category}: ${match.name}`,
          weight: 1.5,
        });
      }
    }

    if (tls.ja4) {
      const match = this.signatures.get(tls.ja4);
      if (match) {
        this.metrics.matches++;
        signals.push({
          category: 'protocol',
          type: 'tls.ja4_match',
          value: match.severity,
          confidence: 0.97,
          description: `JA4 matches known ${match.category}: ${match.name}`,
          weight: 1.6,
        });
      }
    }

    const consistency = this.checkBrowserTlsConsistency(tls, userAgent);
    if (consistency) signals.push(consistency);

    const versionSignal = this.analyzeTlsVersion(tls);
    if (versionSignal) signals.push(versionSignal);

    const cipherSignal = this.analyzeCipherSuite(tls);
    if (cipherSignal) signals.push(cipherSignal);

    const alpnSignal = this.analyzeAlpn(tls, userAgent);
    if (alpnSignal) signals.push(alpnSignal);

    if (tls.ja4l) {
      const latencySignal = this.analyzeJa4lLatency(tls.ja4l);
      if (latencySignal) signals.push(latencySignal);
    }

    const freqSignal = this.trackFingerprintFrequency(tls.ja4 || tls.ja3 || '', ip);
    if (freqSignal) signals.push(freqSignal);

    return signals;
  }

  private checkBrowserTlsConsistency(tls: TLSInfo, ua: string): DetectionSignal | null {
    const isChrome = ua.includes('Chrome');
    const isFirefox = ua.includes('Firefox');

    // Basic heuristic checks:
    // If it claims to be Chrome but the TLS client hello doesn't match standard Chrome JA3 patterns
    // This is a simplified check for demonstration
    if (isChrome && tls.ja3 && tls.ja3.startsWith('771,4865-4866')) {
      // This is expected for some non-Chrome agents
      return {
        category: 'protocol',
        type: 'tls.browser_inconsistency',
        value: 80,
        confidence: 0.85,
        description: 'TLS fingerprint does not match claimed Chrome browser',
        weight: 1.8,
      };
    }

    return null;
  }

  private analyzeTlsVersion(tls: TLSInfo): DetectionSignal | null {
    // 769 = TLS 1.0, 770 = TLS 1.1
    if (tls.version === 'TLSv1.0' || tls.version === 'TLSv1.1' || tls.ja3?.startsWith('769') || tls.ja3?.startsWith('770')) {
      return {
        category: 'protocol',
        type: 'tls.outdated_version',
        value: 70,
        confidence: 0.9,
        description: 'Outdated TLS version detected',
        weight: 1.2,
      };
    }
    return null;
  }

  private analyzeCipherSuite(tls: TLSInfo): DetectionSignal | null {
    if (!tls.ja3) return null;
    const parts = tls.ja3.split(',');
    if (parts.length > 1) {
      const ciphers = parts[1].split('-');
      // Check for lack of strong modern ciphers or presence of weak ones
      if (!ciphers.includes('4865') && !ciphers.includes('4866') && !ciphers.includes('4867')) {
        return {
          category: 'protocol',
          type: 'tls.weak_ciphers',
          value: 65,
          confidence: 0.8,
          description: 'Client does not support modern strong cipher suites expected from browsers',
          weight: 1.0,
        };
      }
    }
    return null;
  }

  private analyzeAlpn(tls: TLSInfo, ua: string): DetectionSignal | null {
    if (!tls.alpn) return null;
    const isModern = ua.includes('Chrome/') || ua.includes('Firefox/') || ua.includes('Safari/');
    if (isModern && !tls.alpn.includes('h2')) {
      return {
        category: 'protocol',
        type: 'tls.missing_alpn_h2',
        value: 75,
        confidence: 0.85,
        description: 'Modern browser lacks ALPN h2 support',
        weight: 1.2,
      };
    }
    return null;
  }

  private analyzeJa4lLatency(ja4l: string): DetectionSignal | null {
    // JA4L pattern analysis for latency anomalies indicating residential proxy routing
    if (ja4l.endsWith('_proxy')) { // Placeholder logic
      return {
        category: 'protocol',
        type: 'tls.ja4l_latency_proxy',
        value: 60,
        confidence: 0.7,
        description: 'JA4L latency indicates possible proxy routing',
        weight: 1.0,
      };
    }
    return null;
  }

  private trackFingerprintFrequency(fingerprint: string, ip: string): DetectionSignal | null {
    if (!fingerprint) return null;

    let data = this.recentFingerprints.get(fingerprint);
    if (!data) {
      data = { count: 0, lastSeen: Date.now(), ips: new Set() };
      this.recentFingerprints.set(fingerprint, data);
      this.metrics.uniqueSeen++;
    }

    data.count++;
    data.lastSeen = Date.now();
    data.ips.add(ip);

    if (data.ips.size > 10) {
      return {
        category: 'protocol',
        type: 'tls.fingerprint_botnet_heuristic',
        value: 90,
        confidence: 0.85,
        description: 'Multiple IPs sharing the same exact TLS fingerprint in a short time',
        weight: 2.0,
      };
    }

    return null;
  }

  private loadSignatures(): void {
    // Mocking a set of known bot TLS signatures
    this.signatures.set('3b5074b1b5d032e5620f69f9f700ff0e', {
      hash: '3b5074b1b5d032e5620f69f9f700ff0e',
      name: 'Python Requests',
      severity: 85,
      category: 'library',
    });
    this.signatures.set('e7d705a3286e19ea42f587b344ee6865', {
      hash: 'e7d705a3286e19ea42f587b344ee6865',
      name: 'curl',
      severity: 60,
      category: 'library',
    });
    // Add 50+ real signatures here in production
  }

  public getMetrics() {
    return this.metrics;
  }

  public cleanup(): void {
    const now = Date.now();
    for (const [fingerprint, data] of this.recentFingerprints.entries()) {
      if (now - data.lastSeen > 300000) { // 5 minutes TTL
        this.recentFingerprints.delete(fingerprint);
      }
    }
  }
}

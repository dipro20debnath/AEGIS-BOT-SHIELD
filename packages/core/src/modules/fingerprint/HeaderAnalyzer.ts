import { DetectionSignal } from '../../types/index.js';
import { Logger } from '../../utils/logger.js';

export class HeaderAnalyzer {
  private logger: Logger;

  constructor() {
    this.logger = new Logger('HeaderAnalyzer');
  }

  public analyze(headers: Record<string, string | string[] | undefined>, method: string, path: string): DetectionSignal[] {
    const signals: DetectionSignal[] = [];
    const normalizedHeaders = this.normalizeHeaders(headers);

    const missingSignal = this.checkMissingHeaders(normalizedHeaders);
    if (missingSignal) signals.push(missingSignal);

    const uaSignals = this.analyzeUserAgent(normalizedHeaders);
    signals.push(...uaSignals);

    const acceptSignal = this.analyzeAcceptHeaders(normalizedHeaders);
    if (acceptSignal) signals.push(acceptSignal);

    const orderSignal = this.analyzeHeaderOrder(Object.keys(headers));
    if (orderSignal) signals.push(orderSignal);

    const clientHintsSignals = this.validateClientHints(normalizedHeaders);
    signals.push(...clientHintsSignals);

    const connSignal = this.analyzeConnectionHeaders(normalizedHeaders);
    if (connSignal) signals.push(connSignal);

    const refSignal = this.analyzeReferer(normalizedHeaders, path);
    if (refSignal) signals.push(refSignal);

    const countSignal = this.analyzeHeaderCount(normalizedHeaders);
    if (countSignal) signals.push(countSignal);

    return signals;
  }

  private normalizeHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined) {
        normalized[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
      }
    }
    return normalized;
  }

  private checkMissingHeaders(headers: Record<string, string>): DetectionSignal | null {
    const required = ['host', 'user-agent', 'accept', 'accept-language'];
    const missing = required.filter((h) => !headers[h]);

    if (missing.length > 0) {
      return {
        category: 'headers',
        type: 'headers.missing_essential',
        value: 80 + missing.length * 5,
        confidence: 0.95,
        description: `Missing essential browser headers: ${missing.join(', ')}`,
        weight: 1.5,
      };
    }
    return null;
  }

  private analyzeUserAgent(headers: Record<string, string>): DetectionSignal[] {
    const signals: DetectionSignal[] = [];
    const ua = headers['user-agent'] || '';

    if (!ua || ua.trim() === '') {
      signals.push({
        category: 'headers',
        type: 'headers.ua_empty',
        value: 100,
        confidence: 1.0,
        description: 'User-Agent header is empty or missing',
        weight: 2.0,
      });
      return signals;
    }

    const botKeywords = ['bot', 'crawler', 'spider', 'headless', 'phantom', 'puppeteer'];
    if (botKeywords.some(keyword => ua.toLowerCase().includes(keyword))) {
      signals.push({
        category: 'headers',
        type: 'headers.ua_known_bot',
        value: 100,
        confidence: 1.0,
        description: 'User-Agent explicitly declares bot/scraper identity',
        weight: 2.0,
      });
    }

    // Chrome version check (simple heuristic for 2026)
    const chromeMatch = ua.match(/Chrome\/(\d+)/);
    if (chromeMatch && parseInt(chromeMatch[1], 10) < 90) {
      signals.push({
        category: 'headers',
        type: 'headers.ua_outdated',
        value: 70,
        confidence: 0.8,
        description: 'Extremely outdated Chrome version detected',
        weight: 1.2,
      });
    }

    return signals;
  }

  private analyzeAcceptHeaders(headers: Record<string, string>): DetectionSignal | null {
    const accept = headers['accept'] || '';
    if (accept === '*/*') {
      return {
        category: 'headers',
        type: 'headers.accept_generic',
        value: 60,
        confidence: 0.7,
        description: 'Accept header is highly generic (*/*), typical of scripts/bots',
        weight: 1.0,
      };
    }
    return null;
  }

  private analyzeHeaderOrder(headerKeys: string[]): DetectionSignal | null {
    // Basic heuristic: Browsers generally put Host first.
    if (headerKeys.length > 0 && headerKeys[0].toLowerCase() !== 'host') {
      return {
        category: 'headers',
        type: 'headers.order_anomaly',
        value: 60,
        confidence: 0.8,
        description: 'Header order anomaly: Host is not the first header',
        weight: 1.1,
      };
    }
    return null;
  }

  private validateClientHints(headers: Record<string, string>): DetectionSignal[] {
    const signals: DetectionSignal[] = [];
    const ua = headers['user-agent'] || '';
    const isChromeModern = ua.includes('Chrome/') && parseInt(ua.split('Chrome/')[1] || '0', 10) >= 110;

    if (isChromeModern && !headers['sec-ch-ua']) {
      signals.push({
        category: 'headers',
        type: 'headers.missing_client_hints',
        value: 85,
        confidence: 0.9,
        description: 'Modern Chrome UA but missing Sec-CH-UA client hints',
        weight: 1.5,
      });
    }
    return signals;
  }

  private analyzeConnectionHeaders(headers: Record<string, string>): DetectionSignal | null {
    const conn = headers['connection'] || '';
    if (conn.toLowerCase() === 'close') {
      return {
        category: 'headers',
        type: 'headers.connection_close',
        value: 40,
        confidence: 0.6,
        description: 'Connection: close used, less common for standard browser behavior',
        weight: 0.8,
      };
    }
    return null;
  }

  private analyzeReferer(headers: Record<string, string>, path: string): DetectionSignal | null {
    const referer = headers['referer'];
    if (!referer && path.includes('/api/v1/secure')) {
      return {
        category: 'headers',
        type: 'headers.missing_referer_on_api',
        value: 75,
        confidence: 0.85,
        description: 'Direct access to deep API endpoint without a Referer header',
        weight: 1.3,
      };
    }
    return null;
  }

  private analyzeHeaderCount(headers: Record<string, string>): DetectionSignal | null {
    const count = Object.keys(headers).length;
    if (count < 5) {
      return {
        category: 'headers',
        type: 'headers.count_too_low',
        value: 80,
        confidence: 0.9,
        description: `Header count (${count}) is too low for a standard modern browser`,
        weight: 1.2,
      };
    }
    if (count > 30) {
      return {
        category: 'headers',
        type: 'headers.count_too_high',
        value: 70,
        confidence: 0.85,
        description: `Header count (${count}) is suspiciously high`,
        weight: 1.1,
      };
    }
    return null;
  }
}

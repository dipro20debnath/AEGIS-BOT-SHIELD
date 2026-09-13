/**
 * Keyboard Dynamics Collector
 *
 * Captures keystroke timing patterns for bot detection.
 * Humans have consistent but variable typing rhythms.
 * Bots type with perfectly uniform timing or impossible speeds.
 *
 * Key metrics:
 * - Dwell Time: how long each key is held (keydown→keyup)
 * - Flight Time: gap between releasing one key and pressing the next
 * - Typing Speed: characters per minute
 * - Cadence Entropy: Shannon entropy of inter-key timing distribution
 *   (higher = more variable = more human-like)
 * - Paste Detection: Ctrl+V / rapid text insertion
 * - Correction Ratio: backspace/delete count vs total keys
 * - Bigram Timing: timing patterns for common letter pairs
 */
export interface KeyboardAnalysis {
  eventCount: number;
  avgDwellTime: number;
  dwellTimeStd: number;
  avgFlightTime: number;
  flightTimeStd: number;
  typingSpeed: number;
  pasteCount: number;
  correctionRatio: number;
  cadenceEntropy: number;
  totalDuration: number;
}

export class KeyboardCollector {
  private keyEvents: Array<{ key: string; type: 'down' | 'up'; t: number }> = [];
  private pasteCount = 0;
  private isCollecting = false;
  private maxEvents: number;
  private onKeyDownHandler: ((e: KeyboardEvent) => void) | null = null;
  private onKeyUpHandler: ((e: KeyboardEvent) => void) | null = null;
  private onPasteHandler: ((e: ClipboardEvent) => void) | null = null;

  constructor(options?: { maxEvents?: number }) {
    this.maxEvents = options?.maxEvents || 2000;
  }

  public start(): void {
    if (this.isCollecting) return;
    this.isCollecting = true;
    this.onKeyDownHandler = (e: KeyboardEvent) => this.recordKeyDown(e);
    this.onKeyUpHandler = (e: KeyboardEvent) => this.recordKeyUp(e);
    this.onPasteHandler = (e: ClipboardEvent) => this.recordPaste(e);
    
    document.addEventListener('keydown', this.onKeyDownHandler, { passive: true });
    document.addEventListener('keyup', this.onKeyUpHandler, { passive: true });
    document.addEventListener('paste', this.onPasteHandler, { passive: true });
  }

  public stop(): void {
    this.isCollecting = false;
    if (this.onKeyDownHandler) document.removeEventListener('keydown', this.onKeyDownHandler);
    if (this.onKeyUpHandler) document.removeEventListener('keyup', this.onKeyUpHandler);
    if (this.onPasteHandler) document.removeEventListener('paste', this.onPasteHandler);
  }

  private recordKeyDown(e: KeyboardEvent): void {
    const isCorrection = e.key === 'Backspace' || e.key === 'Delete';
    const keyCategory = isCorrection ? 'Correction' : 'Char';
    
    this.keyEvents.push({ key: keyCategory, type: 'down', t: Date.now() });
    if (this.keyEvents.length > this.maxEvents) this.keyEvents.shift();
  }

  private recordKeyUp(e: KeyboardEvent): void {
    const isCorrection = e.key === 'Backspace' || e.key === 'Delete';
    const keyCategory = isCorrection ? 'Correction' : 'Char';

    this.keyEvents.push({ key: keyCategory, type: 'up', t: Date.now() });
    if (this.keyEvents.length > this.maxEvents) this.keyEvents.shift();
  }

  private recordPaste(e: ClipboardEvent): void {
    this.pasteCount++;
  }

  public getData(): KeyboardAnalysis {
    const downEvents = this.keyEvents.filter(e => e.type === 'down');
    const upEvents = this.keyEvents.filter(e => e.type === 'up');
    
    const dwellTimes: number[] = [];
    const flightTimes: number[] = [];
    
    for (let i = 0; i < Math.min(downEvents.length, upEvents.length); i++) {
      const dt = upEvents[i].t - downEvents[i].t;
      if (dt >= 0 && dt < 5000) dwellTimes.push(dt);
    }

    for (let i = 1; i < downEvents.length; i++) {
      const ft = downEvents[i].t - upEvents[i - 1]?.t;
      if (ft >= -1000 && ft < 5000) flightTimes.push(ft);
    }

    const avgDwellTime = this.avg(dwellTimes);
    const avgFlightTime = this.avg(flightTimes);

    let totalDuration = 0;
    let typingSpeed = 0;
    if (downEvents.length > 1) {
      totalDuration = downEvents[downEvents.length - 1].t - downEvents[0].t;
      typingSpeed = totalDuration > 0 ? (downEvents.length / (totalDuration / 60000)) : 0;
    }

    const corrections = downEvents.filter(e => e.key === 'Correction').length;
    const correctionRatio = downEvents.length > 0 ? corrections / downEvents.length : 0;

    return {
      eventCount: this.keyEvents.length,
      avgDwellTime,
      dwellTimeStd: this.std(dwellTimes, avgDwellTime),
      avgFlightTime,
      flightTimeStd: this.std(flightTimes, avgFlightTime),
      typingSpeed,
      pasteCount: this.pasteCount,
      correctionRatio,
      cadenceEntropy: this.calculateCadenceEntropy(flightTimes),
      totalDuration
    };
  }

  private calculateCadenceEntropy(flightTimes: number[]): number {
    if (flightTimes.length === 0) return 0;
    const bins: Record<number, number> = {};
    for (const t of flightTimes) {
      const bin = Math.floor(t / 10) * 10;
      bins[bin] = (bins[bin] || 0) + 1;
    }
    
    let entropy = 0;
    const total = flightTimes.length;
    for (const key in bins) {
      const p = bins[key] / total;
      entropy -= p * Math.log2(p);
    }
    return entropy;
  }

  public reset(): void {
    this.keyEvents = [];
    this.pasteCount = 0;
  }

  public getEventCount(): number {
    return this.keyEvents.length;
  }

  private avg(arr: number[]): number {
    return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  }

  private std(arr: number[], mean: number): number {
    if (arr.length === 0) return 0;
    const variance = arr.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / arr.length;
    return Math.sqrt(variance);
  }
}

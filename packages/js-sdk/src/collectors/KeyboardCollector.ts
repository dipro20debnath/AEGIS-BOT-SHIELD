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
 * - Typing Speed: words per minute (5 keystrokes = 1 word)
 * - Cadence Entropy: Shannon entropy of inter-key timing distribution
 *   (higher = more variable = more human-like)
 * - Paste Detection: Ctrl+V / rapid text insertion
 * - Correction Ratio: backspace/delete count vs total keys
 *
 * Privacy: only timings and a Char/Correction category are kept. The key
 * code is held just until its keyup (to pair it with its keydown) and is
 * never stored or sent.
 */
import { binnedEntropy, mean, std } from './stats';

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
  private dwellTimes: number[] = [];
  private flightTimes: number[] = [];
  /** keydown time per physical key, only while the key is held */
  private pressed: Map<string, number> = new Map();
  private lastKeyUp: number | null = null;
  private firstKeyDown: number | null = null;
  private lastKeyDown: number | null = null;
  private keyDownCount = 0;
  private correctionCount = 0;
  private eventCount = 0;
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
    this.onKeyDownHandler = (e: KeyboardEvent) => {
      if (!e.repeat) this.keyDown(e.code || e.key, isCorrectionKey(e.key), e.timeStamp);
    };
    this.onKeyUpHandler = (e: KeyboardEvent) => this.keyUp(e.code || e.key, e.timeStamp);
    this.onPasteHandler = () => this.paste();

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

  /** Record a key press (t in ms). Public so sessions can be replayed and tested. */
  public keyDown(keyId: string, isCorrection: boolean, t: number): void {
    if (this.pressed.has(keyId)) return; // auto-repeat
    this.pressed.set(keyId, t);
    this.eventCount++;
    this.keyDownCount++;
    if (isCorrection) this.correctionCount++;
    if (this.firstKeyDown === null) this.firstKeyDown = t;
    this.lastKeyDown = t;

    if (this.lastKeyUp !== null) {
      const flight = t - this.lastKeyUp; // negative when keys overlap (rollover)
      if (flight > -1000 && flight < 5000) push(this.flightTimes, flight, this.maxEvents);
    }
  }

  public keyUp(keyId: string, t: number): void {
    const down = this.pressed.get(keyId);
    if (down === undefined) return;
    this.pressed.delete(keyId);
    this.eventCount++;
    const dwell = t - down;
    if (dwell >= 0 && dwell < 5000) push(this.dwellTimes, dwell, this.maxEvents);
    this.lastKeyUp = t;
  }

  public paste(): void {
    this.pasteCount++;
  }

  public getData(): KeyboardAnalysis {
    const avgDwellTime = mean(this.dwellTimes);
    const avgFlightTime = mean(this.flightTimes);

    const totalDuration = this.firstKeyDown !== null && this.lastKeyDown !== null
      ? this.lastKeyDown - this.firstKeyDown
      : 0;
    const keysPerMinute = totalDuration > 0 ? (this.keyDownCount - 1) / (totalDuration / 60000) : 0;

    return {
      eventCount: this.eventCount,
      avgDwellTime,
      dwellTimeStd: std(this.dwellTimes, avgDwellTime),
      avgFlightTime,
      flightTimeStd: std(this.flightTimes, avgFlightTime),
      typingSpeed: keysPerMinute / 5,
      pasteCount: this.pasteCount,
      correctionRatio: this.keyDownCount > 0 ? this.correctionCount / this.keyDownCount : 0,
      cadenceEntropy: binnedEntropy(this.flightTimes, 10),
      totalDuration
    };
  }

  public reset(): void {
    this.dwellTimes = [];
    this.flightTimes = [];
    this.pressed.clear();
    this.lastKeyUp = null;
    this.firstKeyDown = null;
    this.lastKeyDown = null;
    this.keyDownCount = 0;
    this.correctionCount = 0;
    this.eventCount = 0;
    this.pasteCount = 0;
  }
}

function isCorrectionKey(key: string): boolean {
  return key === 'Backspace' || key === 'Delete';
}

function push(values: number[], value: number, max: number): void {
  values.push(value);
  if (values.length > max) values.shift();
}

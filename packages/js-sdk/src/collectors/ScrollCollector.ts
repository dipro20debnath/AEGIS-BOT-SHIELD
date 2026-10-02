/**
 * Scroll Dynamics Collector
 *
 * Captures scroll behavior metrics.
 * Humans scroll with varying speeds, read pauses, and momentum.
 * Bots often scroll instantaneously, constantly, or not at all.
 *
 * - maxScrollDepth: deepest point reached as a fraction of the scrollable height (0-1)
 * - avgScrollSpeed: px/s between consecutive scroll events
 * - momentumScrolls: events inside an inertial run (speed decaying for >= 3 steps),
 *   typical of touchpads and touch screens, rare for programmatic scrolling
 */
import { mean } from './stats';

export interface ScrollAnalysis {
  eventCount: number;
  maxScrollDepth: number;
  avgScrollSpeed: number;
  directionChanges: number;
  momentumScrolls: number;
  totalDuration: number;
}

export class ScrollCollector {
  private events: Array<{ y: number; t: number }> = [];
  private isCollecting = false;
  private maxEvents: number;
  private onScrollHandler: ((e: Event) => void) | null = null;
  private maxDepth = 0;

  constructor(options?: { maxEvents?: number }) {
    this.maxEvents = options?.maxEvents || 1000;
  }

  public start(): void {
    if (this.isCollecting) return;
    this.isCollecting = true;
    this.onScrollHandler = (e: Event) => this.addPosition(currentScrollY(), scrollableHeight(), e.timeStamp);
    document.addEventListener('scroll', this.onScrollHandler, { passive: true });
  }

  public stop(): void {
    this.isCollecting = false;
    if (this.onScrollHandler) document.removeEventListener('scroll', this.onScrollHandler);
  }

  /** Record a scroll position y (px) of a page with `scrollable` px of scroll range, at t ms. */
  public addPosition(y: number, scrollable: number, t: number): void {
    const prev = this.events[this.events.length - 1];
    if (prev && t <= prev.t) return;
    if (scrollable > 0) this.maxDepth = Math.max(this.maxDepth, Math.min(1, y / scrollable));
    this.events.push({ y, t });
    if (this.events.length > this.maxEvents) this.events.shift();
  }

  public getData(): ScrollAnalysis {
    const speeds: number[] = [];
    let directionChanges = 0;
    let prevDirection = 0;

    for (let i = 1; i < this.events.length; i++) {
      const dy = this.events[i].y - this.events[i - 1].y;
      const dt = (this.events[i].t - this.events[i - 1].t) / 1000;
      speeds.push(dt > 0 ? Math.abs(dy) / dt : 0);
      if (dy !== 0) {
        const dir = Math.sign(dy);
        if (prevDirection !== 0 && dir !== prevDirection) directionChanges++;
        prevDirection = dir;
      }
    }

    // Count events in runs where speed decreases for at least 3 consecutive steps
    let momentumScrolls = 0;
    let run = 0;
    for (let i = 1; i < speeds.length; i++) {
      if (speeds[i] > 0 && speeds[i] < speeds[i - 1]) {
        run++;
        if (run === 3) momentumScrolls += 3;
        else if (run > 3) momentumScrolls++;
      } else {
        run = 0;
      }
    }

    const first = this.events[0];
    const last = this.events[this.events.length - 1];
    return {
      eventCount: this.events.length,
      maxScrollDepth: this.maxDepth,
      avgScrollSpeed: mean(speeds),
      directionChanges,
      momentumScrolls,
      totalDuration: first && last ? last.t - first.t : 0
    };
  }

  public reset(): void {
    this.events = [];
    this.maxDepth = 0;
  }
}

function currentScrollY(): number {
  return window.scrollY || document.documentElement.scrollTop || 0;
}

function scrollableHeight(): number {
  const doc = document.documentElement;
  return Math.max(0, Math.max(doc.scrollHeight, document.body?.scrollHeight ?? 0) - window.innerHeight);
}

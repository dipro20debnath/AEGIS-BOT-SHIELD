/**
 * Scroll Dynamics Collector
 *
 * Captures scroll behavior metrics.
 * Humans scroll with varying speeds, read pauses, and momentum.
 * Bots often scroll instantaneously, constantly, or not at all.
 */
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
    this.onScrollHandler = () => this.recordScroll();
    document.addEventListener('scroll', this.onScrollHandler, { passive: true });
    // Initial position
    this.recordScroll();
  }

  public stop(): void {
    this.isCollecting = false;
    if (this.onScrollHandler) document.removeEventListener('scroll', this.onScrollHandler);
  }

  private recordScroll(): void {
    const y = window.scrollY || document.documentElement.scrollTop;
    if (y > this.maxDepth) this.maxDepth = y;
    
    this.events.push({ y, t: Date.now() });
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }
  }

  public getData(): ScrollAnalysis {
    let directionChanges = 0;
    let momentumScrolls = 0;
    let totalSpeed = 0;
    let speedCount = 0;

    let prevDirection = 0;

    for (let i = 1; i < this.events.length; i++) {
      const dy = this.events[i].y - this.events[i - 1].y;
      const dt = this.events[i].t - this.events[i - 1].t;

      if (dt > 0) {
        const speed = Math.abs(dy / dt);
        totalSpeed += speed;
        speedCount++;

        // Basic momentum heuristic: very high speed but smooth deceleration
        if (speed > 5) {
          momentumScrolls++;
        }
      }

      if (dy !== 0) {
        const dir = Math.sign(dy);
        if (prevDirection !== 0 && dir !== prevDirection) {
          directionChanges++;
        }
        prevDirection = dir;
      }
    }

    const first = this.events[0];
    const last = this.events[this.events.length - 1];
    const totalDuration = (last && first) ? last.t - first.t : 0;

    return {
      eventCount: this.events.length,
      maxScrollDepth: this.maxDepth,
      avgScrollSpeed: speedCount > 0 ? totalSpeed / speedCount : 0,
      directionChanges,
      momentumScrolls,
      totalDuration
    };
  }

  public reset(): void {
    this.events = [];
    this.maxDepth = 0;
  }
}

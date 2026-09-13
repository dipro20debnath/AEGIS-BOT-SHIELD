/**
 * Touch Events Collector
 *
 * Captures mobile touch dynamics for bot detection.
 * Metrics include pressure, touch radius, multi-touch counts, swipe velocities.
 */
export interface TouchAnalysis {
  eventCount: number;
  avgPressure: number;
  avgRadius: number;
  multiTouchCount: number;
  swipeCount: number;
  avgSwipeVelocity: number;
  tapCount: number;
  totalDuration: number;
}

export class TouchCollector {
  private events: Array<{ x: number; y: number; t: number; type: string; pressure: number; radius: number; touches: number }> = [];
  private isCollecting = false;
  private maxEvents: number;

  private onTouchStartHandler: ((e: TouchEvent) => void) | null = null;
  private onTouchMoveHandler: ((e: TouchEvent) => void) | null = null;
  private onTouchEndHandler: ((e: TouchEvent) => void) | null = null;

  constructor(options?: { maxEvents?: number }) {
    this.maxEvents = options?.maxEvents || 1000;
  }

  public start(): void {
    if (this.isCollecting) return;
    this.isCollecting = true;
    
    this.onTouchStartHandler = (e: TouchEvent) => this.recordTouch(e, 'start');
    this.onTouchMoveHandler = (e: TouchEvent) => this.recordTouch(e, 'move');
    this.onTouchEndHandler = (e: TouchEvent) => this.recordTouch(e, 'end');
    
    document.addEventListener('touchstart', this.onTouchStartHandler, { passive: true });
    document.addEventListener('touchmove', this.onTouchMoveHandler, { passive: true });
    document.addEventListener('touchend', this.onTouchEndHandler, { passive: true });
  }

  public stop(): void {
    this.isCollecting = false;
    if (this.onTouchStartHandler) document.removeEventListener('touchstart', this.onTouchStartHandler);
    if (this.onTouchMoveHandler) document.removeEventListener('touchmove', this.onTouchMoveHandler);
    if (this.onTouchEndHandler) document.removeEventListener('touchend', this.onTouchEndHandler);
  }

  private recordTouch(e: TouchEvent, type: string): void {
    if (e.touches.length > 0) {
      const touch = e.touches[0];
      this.events.push({
        x: touch.clientX,
        y: touch.clientY,
        t: Date.now(),
        type,
        pressure: touch.force || 0,
        radius: (touch.radiusX || 0 + (touch.radiusY || 0)) / 2,
        touches: e.touches.length
      });
    } else if (type === 'end' && e.changedTouches.length > 0) {
      const touch = e.changedTouches[0];
      this.events.push({
        x: touch.clientX,
        y: touch.clientY,
        t: Date.now(),
        type,
        pressure: touch.force || 0,
        radius: (touch.radiusX || 0 + (touch.radiusY || 0)) / 2,
        touches: 0
      });
    }

    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }
  }

  public getData(): TouchAnalysis {
    let pressureSum = 0;
    let radiusSum = 0;
    let validPressureCount = 0;
    let validRadiusCount = 0;
    let multiTouchCount = 0;
    
    let swipeCount = 0;
    let tapCount = 0;
    let totalSwipeVelocity = 0;

    let currentSwipeStart: { x: number; y: number; t: number } | null = null;

    for (let i = 0; i < this.events.length; i++) {
      const ev = this.events[i];
      if (ev.pressure > 0) { pressureSum += ev.pressure; validPressureCount++; }
      if (ev.radius > 0) { radiusSum += ev.radius; validRadiusCount++; }
      if (ev.touches > 1) multiTouchCount++;

      if (ev.type === 'start') {
        currentSwipeStart = { x: ev.x, y: ev.y, t: ev.t };
      } else if (ev.type === 'end' && currentSwipeStart) {
        const dx = ev.x - currentSwipeStart.x;
        const dy = ev.y - currentSwipeStart.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const dt = ev.t - currentSwipeStart.t;
        
        if (dist > 30 && dt > 0) {
          swipeCount++;
          totalSwipeVelocity += (dist / dt);
        } else if (dist < 10) {
          tapCount++;
        }
        currentSwipeStart = null;
      }
    }

    const first = this.events[0];
    const last = this.events[this.events.length - 1];

    return {
      eventCount: this.events.length,
      avgPressure: validPressureCount > 0 ? pressureSum / validPressureCount : 0,
      avgRadius: validRadiusCount > 0 ? radiusSum / validRadiusCount : 0,
      multiTouchCount,
      swipeCount,
      avgSwipeVelocity: swipeCount > 0 ? totalSwipeVelocity / swipeCount : 0,
      tapCount,
      totalDuration: (first && last) ? last.t - first.t : 0
    };
  }

  public reset(): void {
    this.events = [];
  }
}
